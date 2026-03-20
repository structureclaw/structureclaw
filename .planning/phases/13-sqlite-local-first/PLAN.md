# Phase 13: SQLite Local-First Database Migration

## Goal
Replace the current PostgreSQL-first persistent database setup with a SQLite-first setup so that new users can run StructureClaw locally with far less infrastructure friction.

The target outcome is:
- local development works with one SQLite database file by default;
- Docker startup for beginners no longer requires a dedicated PostgreSQL or pgAdmin container;
- Prisma runtime, migrations, scripts, and docs all treat SQLite as the default persistent database;
- existing persisted data can be migrated from PostgreSQL into SQLite when needed;
- no-skill, chat, SkillHub metadata, community data, and project/model persistence continue to work without behavior regressions.

## Why This Phase Exists
Current setup friction is still too high for new users:
- Prisma schema is hard-wired to `postgresql`;
- backend config defaults to a PostgreSQL connection string;
- local and Docker startup flows assume `postgres` and `pgadmin`;
- the console database page is written entirely around pgAdmin;
- backend regression helpers and startup scripts still export PostgreSQL defaults.

That means the current local-first story still asks users to bring up extra infra before they can even try the product.

## Current-State Constraints
Phase 13 starts from these concrete constraints in the current repo:
- [schema.prisma](/data1/openclaw/workspace/projects/10structureclaw/dev/structureclaw/backend/prisma/schema.prisma) uses `provider = "postgresql"`.
- [index.ts](/data1/openclaw/workspace/projects/10structureclaw/dev/structureclaw/backend/src/config/index.ts) defaults `DATABASE_URL` to `postgresql://postgres:postgres@localhost:5432/structureclaw`.
- [docker-compose.yml](/data1/openclaw/workspace/projects/10structureclaw/dev/structureclaw/docker-compose.yml) boots `postgres` and `pgadmin`, and backend startup waits on `prisma migrate deploy`.
- [admin-database.ts](/data1/openclaw/workspace/projects/10structureclaw/dev/structureclaw/backend/src/api/admin-database.ts) exposes pgAdmin-specific metadata.
- [page.tsx](/data1/openclaw/workspace/projects/10structureclaw/dev/structureclaw/frontend/src/app/(console)/console/database/page.tsx) is a pgAdmin landing page.

There are also schema-level incompatibilities that must be handled explicitly for SQLite:
- `User.expertise String[]`
- `Skill.tags String[]`
- `Post.tags String[]`
- `Post.attachments String[]`

Prisma scalar lists are not a safe SQLite target, so these fields must be redesigned rather than carried over unchanged.

## Product Direction
The right product direction is not "support SQLite somewhere in addition to PostgreSQL."

The right direction is:
- SQLite becomes the default persistent database for local and beginner Docker usage;
- PostgreSQL becomes optional legacy or advanced deployment scope, not the default path;
- repository scripts, docs, and starter env files should guide users into SQLite first;
- database admin UX should become provider-neutral or SQLite-oriented, not pgAdmin-oriented.

## Non-Negotiable Rules
- Fresh local startup must work without a separately managed PostgreSQL instance.
- Existing user-visible behavior must remain bilingual where new copy is introduced.
- No existing persistent feature may silently stop persisting data after the migration.
- SQLite file placement, backup, reset, and upgrade behavior must be explicit in docs and scripts.
- Migration from an existing PostgreSQL database must be supported before PostgreSQL is fully demoted.
- Docker and local startup commands must remain beginner-friendly.
- If Redis remains in the stack, it must not be described as the primary persistence layer.

## Scope

### In Scope
- Prisma datasource migration from PostgreSQL to SQLite default operation.
- Schema redesign for PostgreSQL-only features, especially scalar list fields.
- New default `DATABASE_URL`, SQLite file location, and directory lifecycle.
- Local scripts, Docker compose, Make targets, and startup checks that currently assume PostgreSQL or pgAdmin.
- Backend admin metadata and frontend database admin page changes required by the provider switch.
- Data export/import tooling for PostgreSQL-to-SQLite migration.
- Regression coverage for persistence-critical flows under SQLite.
- README, README_CN, `.env.example`, and operator docs updates.

### Out of Scope
- Replacing Redis with SQLite.
- Multi-node or high-concurrency deployment tuning beyond what SQLite needs for single-node app usage.
- Designing a full in-app SQLite table browser unless required for minimum usability.
- Cloud/production deployment guidance for every possible hosting topology in the first iteration.

## Core Decisions To Make Early

### 1. Default SQLite File Layout
Recommended default:
- repo local dev: `.runtime/data/structureclaw.db`
- Docker volume mount: `/app/.runtime/data/structureclaw.db`

Why:
- keeps the database near other runtime artifacts;
- avoids accidental source control inclusion;
- gives scripts one predictable path for backup/reset/inspection.

### 2. Scalar List Migration Strategy
Recommended direction:
- normalize list fields into dedicated child tables instead of serializing arrays into text blobs.

Initial mapping:
- `User.expertise String[]` -> `UserExpertise`
- `Skill.tags String[]` -> `SkillTag`
- `Post.tags String[]` -> `PostTag`
- `Post.attachments String[]` -> `PostAttachment`

Reason:
- keeps filtering and integrity explicit;
- avoids provider-specific JSON/text hacks;
- makes SQLite and future providers easier to support consistently.

### 3. JSON Field Policy
Current JSON-heavy models such as model snapshots, analysis parameters, and result payloads may remain JSON-backed if Prisma SQLite support is sufficient for the current access patterns.

But this must be audited:
- writes and reads are fine;
- any provider-specific JSON query assumptions must be removed;
- large payload retention must be tested for chat snapshots and analysis results.

### 4. Database Admin UX
Recommended direction:
- replace the current pgAdmin page with a lightweight "database status" page;
- show provider, file path, file size, writable status, backup/reset hints, and troubleshooting;
- do not promise a browser-based admin UI in the first migration slice.

## Migration Strategy

### WP1: Audit the Real Persistence Surface
Scope:
- inventory every Prisma model actually used by backend routes, chat persistence, project persistence, community features, and SkillHub metadata;
- identify PostgreSQL-only assumptions in schema, code, tests, docs, scripts, and Docker.

Deliverables:
- a compatibility matrix covering models, field types, indexes, and operational assumptions;
- a field-by-field migration decision for scalar lists, JSON payloads, and defaults.

Acceptance:
- no PostgreSQL-only field or script dependency remains unidentified.

### WP2: Redesign the Prisma Schema for SQLite
Scope:
- switch datasource provider to `sqlite`;
- redesign scalar list fields into normalized child tables;
- re-check relation deletes, uniqueness, timestamps, and JSON usage under SQLite.

Likely file targets:
- `backend/prisma/schema.prisma`
- new Prisma migration set or fresh SQLite baseline

Acceptance:
- Prisma client can be generated cleanly for SQLite;
- schema expresses all current persistence features without PostgreSQL-only field types.

### WP3: Define Runtime Database Defaults and File Lifecycle
Scope:
- change backend config default `DATABASE_URL` to SQLite;
- define runtime creation rules for the SQLite directory and file;
- define WAL/journal policy if needed;
- ensure backup/reset scripts know the file path.

Likely file targets:
- `backend/src/config/index.ts`
- `backend/src/utils/database.ts`
- `.env.example`
- `backend/.env.example`
- startup scripts under `scripts/`

Acceptance:
- a fresh clone with no database running can still boot the backend into a usable state.

### WP4: Migrate Tooling, Scripts, and Docker Away From PostgreSQL-First Assumptions
Scope:
- remove PostgreSQL and pgAdmin from the default beginner path;
- update `docker-compose.yml`, `Makefile`, `scripts/dev-up.sh`, `scripts/dev-down.sh`, `scripts/check-startup.sh`, and regression helpers;
- keep an opt-in advanced path only if PostgreSQL compatibility is intentionally retained.

Acceptance:
- `make start`, `make doctor`, and `make docker-up` work in the default SQLite path without `postgres` or `pgadmin`.

### WP5: Replace pgAdmin-Centric Admin UX
Scope:
- change backend admin database metadata from pgAdmin-specific to provider-neutral;
- replace the current frontend database page with SQLite-aware status/help content;
- keep both `en` and `zh` copy complete.

Acceptance:
- console database page accurately reflects SQLite state and no longer points beginners at pgAdmin by default.

### WP6: Add PostgreSQL-to-SQLite Migration Utilities
Scope:
- provide a one-shot export/import or direct copy path from existing PostgreSQL data into the new SQLite schema;
- support at least the active tables used by current product flows;
- define what happens to unsupported or legacy rows.

Recommended deliverables:
- migration script under `scripts/`
- operator guide covering backup, migration, verification, and rollback

Acceptance:
- an existing PostgreSQL-backed developer can move into SQLite without manual table-by-table rewriting.

### WP7: Rebuild the Regression Matrix Under SQLite
Scope:
- re-run backend tests, chat/agent contract scripts, startup checks, and persistence-critical flows against SQLite;
- add targeted tests for normalized list tables and SQLite-backed persistence behavior.

Minimum validation:
- `npm run build --prefix backend`
- `npm test --prefix backend -- --runInBand`
- `./scripts/check-backend-regression.sh`
- `./scripts/validate-chat-stream-contract.sh`
- `./scripts/validate-agent-orchestration.sh`
- `./scripts/validate-agent-no-skill-fallback.sh`
- `make doctor`

Acceptance:
- SQLite becomes a tested first-class runtime, not just a schema compile target.

### WP8: Docs, Release, and Default-Path Cleanup
Scope:
- update `README.md`, `README_CN.md`, startup docs, Docker docs, and troubleshooting text;
- remove stale pgAdmin/PostgreSQL-first wording from user-facing flows;
- define upgrade notes for existing developers.

Acceptance:
- repo docs consistently tell new users to start with SQLite.

## Detailed Execution Order
1. Complete the persistence and script audit so the migration surface is explicit.
2. Redesign the Prisma schema for SQLite, including normalized replacements for scalar list fields.
3. Regenerate Prisma client and establish a fresh SQLite migration baseline.
4. Move config defaults and runtime file lifecycle to SQLite.
5. Update startup scripts, Make targets, and Docker compose to remove PostgreSQL from the default path.
6. Replace pgAdmin-oriented admin APIs and frontend copy with provider-neutral SQLite-aware status UX.
7. Ship PostgreSQL-to-SQLite migration tooling for existing local users.
8. Re-run and extend regressions until SQLite is the tested default.
9. Update docs and onboarding text last, once the real commands are stable.

## Risk Register

### Risk 1: Scalar List Breakage
Problem:
- Prisma scalar lists do not map cleanly onto SQLite.

Mitigation:
- normalize these fields into dedicated tables early in the phase, not late.

### Risk 2: Hidden PostgreSQL Assumptions in Scripts
Problem:
- startup and regression scripts currently reference `postgres`, `pgadmin`, or port `5432`.

Mitigation:
- audit every script before switching defaults;
- add provider-neutral helpers instead of one-off string swaps.

### Risk 3: SQLite Locking Under Concurrent Writes
Problem:
- chat saves, message appends, and background persistence could reveal locking issues.

Mitigation:
- test realistic chat and conversation update patterns;
- enable WAL if needed;
- keep the single-node local-first scope explicit.

### Risk 4: Existing Users Need Migration, Not Just Reinstall
Problem:
- current developers may already have PostgreSQL data they care about.

Mitigation:
- require export/import tooling before fully declaring PostgreSQL optional.

### Risk 5: Admin UX Regresses
Problem:
- removing pgAdmin without replacement can leave users with no visibility into database state.

Mitigation:
- replace it with a simpler SQLite status/operations page rather than deleting the page outright.

## Files Expected To Change
- `backend/prisma/schema.prisma`
- `backend/prisma/migrations/*`
- `backend/src/config/index.ts`
- `backend/src/utils/database.ts`
- `backend/src/api/admin-database.ts`
- `frontend/src/app/(console)/console/database/page.tsx`
- `frontend/src/lib/i18n.ts`
- `docker-compose.yml`
- `Makefile`
- `.env.example`
- `backend/.env.example`
- `scripts/dev-up.sh`
- `scripts/dev-down.sh`
- `scripts/check-startup.sh`
- `scripts/check-backend-regression.sh`
- new migration/backup helpers under `scripts/`
- `README.md`
- `README_CN.md`

## Suggested Commit Slices
1. `docs(planning): add phase 13 sqlite local-first migration plan`
2. `refactor(prisma): redesign schema for sqlite compatibility`
3. `refactor(backend): switch runtime database defaults to sqlite`
4. `refactor(ops): remove postgres-first startup assumptions`
5. `feat(scripts): add postgres-to-sqlite migration utilities`
6. `refactor(frontend): replace pgadmin database console with sqlite status view`
7. `docs: update sqlite-first setup and migration guidance`

## Validation Exit Criteria
- fresh local startup works with SQLite and no PostgreSQL service;
- default Docker startup works with SQLite and no pgAdmin dependency;
- all active persistent product flows still function;
- PostgreSQL data migration tooling exists and is documented;
- docs consistently present SQLite as the default path;
- no-skill, chat, and project persistence remain regression-covered.
