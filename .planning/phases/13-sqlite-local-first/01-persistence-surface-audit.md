# Phase 13 Audit: Persistence Surface and PostgreSQL Assumptions

Updated: 2026-03-20
Owner: backend-agent

## Audit Goal
Identify the real migration surface before switching the repository from PostgreSQL-first persistence to SQLite-first persistence.

This audit covers:
- Prisma models that are actively used by backend services;
- PostgreSQL-specific schema or query assumptions that will block SQLite;
- scripts, Docker, tests, and UI flows that still assume `postgres` or `pgadmin`;
- the minimum redesign work required before the datasource provider can switch safely.

## Executive Summary
The repo is small enough to migrate to SQLite, but the work is not just a datasource flip.

The main blockers are:
1. Prisma schema still uses PostgreSQL and has scalar-list fields that do not map cleanly to SQLite.
2. Search and tag filters currently rely on PostgreSQL-friendly Prisma patterns such as scalar-list `has` and `mode: 'insensitive'`.
3. Local startup, Docker, admin APIs, frontend database UI, tests, and docs still point beginners at `postgres + pgadmin`.

The migration is still tractable because:
- active persistence is concentrated in a limited set of services;
- most large payloads are already stored as JSON blobs, which can remain JSON-backed if verified under SQLite;
- no advanced PostgreSQL-only SQL features such as custom extensions, triggers, or raw SQL migrations are present in app code.

## Active Persistence Surface

### 1. Chat and Agent Persistence
Primary files:
- [chat.ts](/data1/openclaw/workspace/projects/10structureclaw/dev/structureclaw/backend/src/services/chat.ts)
- [chat.ts](/data1/openclaw/workspace/projects/10structureclaw/dev/structureclaw/backend/src/api/chat.ts)
- [agent.ts](/data1/openclaw/workspace/projects/10structureclaw/dev/structureclaw/backend/src/services/agent.ts)

Active models:
- `Conversation`
- `Message`

Stored fields of note:
- `Conversation.modelSnapshot Json?`
- `Conversation.resultSnapshot Json?`
- `Conversation.latestResult Json?`
- `Message.metadata Json?`

Risk level:
- low-to-medium

Notes:
- these paths use ordinary `findUnique`, `findFirst`, `findMany`, `create`, `update`, `delete`, and `createMany`;
- there is no PostgreSQL-specific query shape here;
- the main SQLite concern is JSON payload size and write concurrency, not query syntax.

### 2. Project and Analysis Persistence
Primary files:
- [project.ts](/data1/openclaw/workspace/projects/10structureclaw/dev/structureclaw/backend/src/services/project.ts)
- [analysis.ts](/data1/openclaw/workspace/projects/10structureclaw/dev/structureclaw/backend/src/services/analysis.ts)
- [models.ts](/data1/openclaw/workspace/projects/10structureclaw/dev/structureclaw/backend/src/api/models.ts)

Active models:
- `Project`
- `ProjectMember`
- `StructuralModel`
- `Analysis`
- `ProjectSkill`

Stored fields of note:
- `Project.location Json?`
- `Project.settings Json?`
- `StructuralModel.nodes Json`
- `StructuralModel.elements Json`
- `StructuralModel.materials Json`
- `StructuralModel.sections Json`
- `Analysis.parameters Json`
- `Analysis.results Json?`

Risk level:
- medium

Notes:
- these models rely heavily on JSON persistence;
- this is acceptable for SQLite if reads/writes remain simple and payload size is tested;
- project search currently uses `contains(..., mode: 'insensitive')`, which must be re-verified or rewritten for SQLite.

### 3. User and Demo Data Persistence
Primary files:
- [user.ts](/data1/openclaw/workspace/projects/10structureclaw/dev/structureclaw/backend/src/services/user.ts)
- [demo-data.ts](/data1/openclaw/workspace/projects/10structureclaw/dev/structureclaw/backend/src/utils/demo-data.ts)

Active models:
- `User`

Stored fields of note:
- `User.expertise String[]`

Risk level:
- high

Notes:
- `expertise` is a direct PostgreSQL-style scalar list;
- both user profile reads and demo-user bootstrap depend on it;
- this field must be normalized before SQLite can become the default.

### 4. Skill Marketplace / SkillHub Persistence
Primary files:
- [skill.ts](/data1/openclaw/workspace/projects/10structureclaw/dev/structureclaw/backend/src/services/skill.ts)
- [user.ts](/data1/openclaw/workspace/projects/10structureclaw/dev/structureclaw/backend/src/services/user.ts)

Active models:
- `Skill`
- `ProjectSkill`
- `SkillReview`
- `SkillExecution`

Stored fields of note:
- `Skill.tags String[]`
- `Skill.config Json`
- `SkillExecution.parameters Json`
- `SkillExecution.result Json?`

Risk level:
- high

Notes:
- `Skill.tags` must be redesigned;
- search currently depends on both `tags: { has: ... }` and `contains(..., mode: 'insensitive')`;
- ratings, installs, reviews, and executions otherwise use provider-neutral Prisma operations.

### 5. Community Persistence
Primary files:
- [community.ts](/data1/openclaw/workspace/projects/10structureclaw/dev/structureclaw/backend/src/services/community.ts)

Active models:
- `Post`
- `Comment`
- `PostLike`

Stored fields of note:
- `Post.tags String[]`
- `Post.attachments String[]`
- `Post.likeCount Int`
- `Post.viewCount Int`

Risk level:
- high

Notes:
- community has the heaviest schema rewrite cost because both `tags` and `attachments` are scalar lists;
- current queries use:
  - `where.tags = { has: params.tag }`
  - `select: { tags: true }` followed by in-memory tag counting
  - `search` using `{ tags: { has: q } }`
- these queries will need to move to normalized tables such as `PostTag` and `PostAttachment`.

## Models Present but Lower Migration Risk
- `Comment` and `PostLike` use ordinary relations and unique keys.
- `ProjectMember` uses a composite unique key that SQLite can support.
- `Conversation` and `Message` have no array fields and mostly JSON blobs.
- `Analysis` and `StructuralModel` rely on JSON, but not on PostgreSQL-specific array operators.

## PostgreSQL-Specific or PostgreSQL-First Assumptions

### A. Datasource and Migration Baseline
Files:
- [schema.prisma](/data1/openclaw/workspace/projects/10structureclaw/dev/structureclaw/backend/prisma/schema.prisma)
- [migration_lock.toml](/data1/openclaw/workspace/projects/10structureclaw/dev/structureclaw/backend/prisma/migration_lock.toml)

Current assumption:
- Prisma datasource is `provider = "postgresql"`.
- Migration lock also pins PostgreSQL.

Impact:
- Phase 13 needs a new SQLite migration baseline or a schema reset sequence.

### B. Scalar Lists in Prisma Schema
Blocking fields:
- `User.expertise`
- `Skill.tags`
- `Post.tags`
- `Post.attachments`

Impact:
- these are the clearest schema-level blockers for SQLite.

Recommended fix:
- replace with normalized child tables:
  - `UserExpertise`
  - `SkillTag`
  - `PostTag`
  - `PostAttachment`

### C. Case-Insensitive Search Filters
Files:
- [project.ts](/data1/openclaw/workspace/projects/10structureclaw/dev/structureclaw/backend/src/services/project.ts)
- [community.ts](/data1/openclaw/workspace/projects/10structureclaw/dev/structureclaw/backend/src/services/community.ts)
- [skill.ts](/data1/openclaw/workspace/projects/10structureclaw/dev/structureclaw/backend/src/services/skill.ts)

Current assumption:
- code uses Prisma `contains(..., mode: 'insensitive')` in multiple service queries.

Impact:
- this must be explicitly re-verified against SQLite Prisma behavior;
- if not supported or not reliable enough, search semantics must be simplified or normalized.

### D. Tag Membership Filters
Files:
- [community.ts](/data1/openclaw/workspace/projects/10structureclaw/dev/structureclaw/backend/src/services/community.ts)
- [skill.ts](/data1/openclaw/workspace/projects/10structureclaw/dev/structureclaw/backend/src/services/skill.ts)

Current assumption:
- tag search uses scalar-list filters with `has`.

Impact:
- these queries disappear once tags move to join tables;
- service logic must be rewritten, not just schema types.

### E. Startup, Docker, and Env Defaults
Files:
- [index.ts](/data1/openclaw/workspace/projects/10structureclaw/dev/structureclaw/backend/src/config/index.ts)
- [docker-compose.yml](/data1/openclaw/workspace/projects/10structureclaw/dev/structureclaw/docker-compose.yml)
- [Makefile](/data1/openclaw/workspace/projects/10structureclaw/dev/structureclaw/Makefile)
- [dev-up.sh](/data1/openclaw/workspace/projects/10structureclaw/dev/structureclaw/scripts/dev-up.sh)
- [dev-down.sh](/data1/openclaw/workspace/projects/10structureclaw/dev/structureclaw/scripts/dev-down.sh)
- [check-backend-regression.sh](/data1/openclaw/workspace/projects/10structureclaw/dev/structureclaw/scripts/check-backend-regression.sh)
- [.env.example](/data1/openclaw/workspace/projects/10structureclaw/dev/structureclaw/.env.example)

Current assumption:
- backend defaults `DATABASE_URL` to PostgreSQL;
- Docker starts `postgres` and `pgadmin`;
- Make targets explicitly say "postgres, redis, and pgadmin";
- regression fallback also exports a PostgreSQL URL.

Impact:
- user onboarding will still feel Postgres-first until these are changed.

### F. Admin API, Frontend UI, and Tests
Files:
- [admin-database.ts](/data1/openclaw/workspace/projects/10structureclaw/dev/structureclaw/backend/src/api/admin-database.ts)
- [page.tsx](/data1/openclaw/workspace/projects/10structureclaw/dev/structureclaw/frontend/src/app/(console)/console/database/page.tsx)
- [i18n.ts](/data1/openclaw/workspace/projects/10structureclaw/dev/structureclaw/frontend/src/lib/i18n.ts)
- [admin-database.route.test.mjs](/data1/openclaw/workspace/projects/10structureclaw/dev/structureclaw/backend/tests/admin-database.route.test.mjs)
- [database-page.test.tsx](/data1/openclaw/workspace/projects/10structureclaw/dev/structureclaw/frontend/tests/integration/database-page.test.tsx)

Current assumption:
- backend returns `provider: 'pgadmin'`;
- frontend displays pgAdmin copy, URLs, and default `postgres:5432 / structureclaw` target text;
- tests assert pgAdmin-specific output.

Impact:
- these must be redesigned, not merely renamed.

## Proposed Schema Redesign Decisions

### 1. Normalize All Active String Lists
Required:
- `UserExpertise { userId, value, order? }`
- `SkillTag { skillId, value }`
- `PostTag { postId, value }`
- `PostAttachment { postId, url, order? }`

Why:
- removes SQLite blockers cleanly;
- preserves search/filtering without provider hacks;
- keeps future database-provider changes simpler.

### 2. Keep JSON Storage for Large Domain Payloads
Recommended to keep as JSON:
- project `location`
- project `settings`
- structural model arrays
- analysis parameters/results
- conversation snapshots
- message metadata
- skill config / execution payloads

Why:
- these objects are already treated as opaque payloads in app code;
- the repository does not currently depend on deep provider-specific JSON querying for them.

### 3. Replace pgAdmin UX With Provider-Neutral Status
Minimum required replacement:
- provider name
- effective database location
- writable/exists status
- backup/reset guidance
- beginner troubleshooting

## Migration Readiness Assessment

### Ready to migrate with low redesign cost
- conversations and messages
- projects, structural models, analyses
- comments, likes, memberships, reviews, executions

### Requires schema redesign before datasource switch
- user expertise
- skill tags
- post tags
- post attachments

### Requires query rewrite in addition to schema redesign
- community tag filtering and popular-tag aggregation
- skill tag filtering/search
- any search path using `mode: 'insensitive'` if SQLite support is not good enough

### Requires ops/doc rewrite
- backend default config
- docker compose
- Make targets
- dev scripts
- admin API
- frontend database page
- README, handbook, troubleshooting text

## Recommended Immediate Implementation Order
1. Finalize normalized replacements for scalar-list fields.
2. Rewrite service-level tag and expertise access patterns against those new tables.
3. Re-check all case-insensitive search paths and decide whether to keep, simplify, or emulate them.
4. Switch Prisma datasource and regenerate the migration baseline.
5. Then update startup scripts, Docker, admin UX, tests, and docs.

## WP1 Completion Decision
WP1 is considered complete after this audit because:
- active Prisma-backed product areas have been identified;
- PostgreSQL-specific schema blockers are explicit;
- startup, Docker, UI, doc, and test assumptions have been inventoried;
- the next concrete decision point is schema redesign, not more repo discovery.
