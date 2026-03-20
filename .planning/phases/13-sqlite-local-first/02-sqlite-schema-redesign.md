# Phase 13 Design: SQLite-Compatible Prisma Schema

Updated: 2026-03-20
Owner: backend-agent

## Design Goal
Define the target Prisma schema shape that will let the repository switch from PostgreSQL-first persistence to SQLite-first persistence without losing current product features.

This document turns the WP1 audit into concrete schema decisions:
- which existing models remain structurally unchanged;
- which PostgreSQL-only fields are replaced;
- which new relation tables are introduced;
- which service-layer query patterns must change alongside the schema.

## Summary Decision
The SQLite redesign should be conservative:
- keep existing IDs, major entity names, and most relations intact;
- keep existing JSON payload columns where the app already treats them as opaque blobs;
- replace every active scalar list with an explicit child table;
- preserve current API shapes by reassembling arrays in service code where needed.

This avoids a broad product rewrite while removing the actual SQLite blockers.

## Datasource Target
Target Prisma datasource:

```prisma
datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}
```

Target default URL for local-first runtime:

```text
file:../.runtime/data/structureclaw.db
```

The exact default path wiring belongs to WP3, but WP2 assumes the schema is designed for one-file local persistence.

## Models That Can Stay Structurally Stable
These models do not need a conceptual redesign for SQLite:
- `Project`
- `ProjectMember`
- `StructuralModel`
- `Analysis`
- `Conversation`
- `Message`
- `ProjectSkill`
- `SkillReview`
- `SkillExecution`
- `Comment`
- `PostLike`

Why they can stay:
- they use normal relations, scalars, unique constraints, and JSON payloads;
- none depends on PostgreSQL array operators or custom SQL.

Notes:
- some indexes may still be worth adding later for performance, but they are not blockers for the provider switch;
- JSON payload usage must still be regression-tested, especially `Analysis.results` and conversation snapshots.

## Fields That Must Be Replaced

### 1. `User.expertise String[]`
Replace with:
- `UserExpertise`

Target design:

```prisma
model User {
  id            String          @id @default(cuid())
  email         String          @unique
  passwordHash  String
  name          String
  avatar        String?
  organization  String?
  title         String?
  bio           String?
  createdAt     DateTime        @default(now())
  updatedAt     DateTime        @updatedAt

  expertiseItems UserExpertise[]
  projects       Project[]
  conversations  Conversation[]
  skills         Skill[]
  posts          Post[]
  comments       Comment[]
  reviews        SkillReview[]
  projectMemberships ProjectMember[]

  @@map("users")
}

model UserExpertise {
  id        String   @id @default(cuid())
  userId    String
  value     String
  position  Int      @default(0)
  createdAt DateTime @default(now())

  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, value])
  @@index([userId, position])
  @@map("user_expertise")
}
```

Why:
- preserves ordered profile display if needed;
- avoids duplicates for the same user;
- keeps the public API free to still expose `expertise: string[]`.

### 2. `Skill.tags String[]`
Replace with:
- `SkillTag`

Target design:

```prisma
model Skill {
  id          String           @id @default(cuid())
  name        String
  description String
  category    String
  version     String
  author      String
  config      Json
  isPublic    Boolean          @default(false)
  rating      Float            @default(0)
  installs    Int              @default(0)
  createdAt   DateTime         @default(now())
  updatedAt   DateTime         @updatedAt

  authorId    String?
  authorUser  User?            @relation(fields: [authorId], references: [id])
  tagItems    SkillTag[]
  projects    ProjectSkill[]
  reviews     SkillReview[]
  executions  SkillExecution[]

  @@map("skills")
}

model SkillTag {
  id        String   @id @default(cuid())
  skillId    String
  value      String
  createdAt  DateTime @default(now())

  skill      Skill    @relation(fields: [skillId], references: [id], onDelete: Cascade)

  @@unique([skillId, value])
  @@index([value])
  @@map("skill_tags")
}
```

Why:
- supports filtering and tag-based search without scalar-list operators;
- keeps tag analytics cheap enough for current scale.

### 3. `Post.tags String[]`
Replace with:
- `PostTag`

### 4. `Post.attachments String[]`
Replace with:
- `PostAttachment`

Target design:

```prisma
model Post {
  id          String            @id @default(cuid())
  title       String
  content     String
  category    String
  viewCount   Int               @default(0)
  likeCount   Int               @default(0)
  isPinned    Boolean           @default(false)
  createdAt   DateTime          @default(now())
  updatedAt   DateTime          @updatedAt

  authorId    String
  author      User              @relation(fields: [authorId], references: [id])
  projectId   String?
  tagItems    PostTag[]
  attachments PostAttachment[]
  comments    Comment[]
  likes       PostLike[]

  @@map("posts")
}

model PostTag {
  id        String   @id @default(cuid())
  postId    String
  value     String
  createdAt DateTime @default(now())

  post      Post     @relation(fields: [postId], references: [id], onDelete: Cascade)

  @@unique([postId, value])
  @@index([value])
  @@map("post_tags")
}

model PostAttachment {
  id        String   @id @default(cuid())
  postId    String
  url       String
  position  Int      @default(0)
  createdAt DateTime @default(now())

  post      Post     @relation(fields: [postId], references: [id], onDelete: Cascade)

  @@index([postId, position])
  @@map("post_attachments")
}
```

Why:
- `PostTag` supports list filters and tag aggregation;
- `PostAttachment` preserves attachment order without overloading a text array.

## JSON Policy
Keep these as `Json` in Prisma for now:
- `Project.location`
- `Project.settings`
- `StructuralModel.nodes`
- `StructuralModel.elements`
- `StructuralModel.materials`
- `StructuralModel.sections`
- `Analysis.parameters`
- `Analysis.results`
- `Conversation.modelSnapshot`
- `Conversation.resultSnapshot`
- `Conversation.latestResult`
- `Message.metadata`
- `Skill.config`
- `SkillExecution.parameters`
- `SkillExecution.result`

Reason:
- current code treats these as opaque payloads rather than queryable relational structures;
- replacing them in this phase would explode the migration scope without reducing beginner setup friction.

Guardrail:
- no new deep JSON-query dependency should be introduced while SQLite becomes the default provider.

## Search and Query Semantics Redesign

### 1. Tag Filters
Current patterns:
- `tags: { has: ... }`

Replacement:
- relation filters on normalized tables

Examples:

```ts
where: {
  tagItems: {
    some: { value: normalizedTag }
  }
}
```

Applies to:
- community tag filtering
- skill tag filtering
- community search over tags

### 2. Popular Tag Aggregation
Current pattern:
- load `select: { tags: true }` then count in memory

Replacement:
- load `PostTag` rows directly and aggregate in application code, or group once a stable query path is chosen.

Recommended first step:
- keep aggregation in application code to minimize Prisma/provider surprises;
- fetch recent `PostTag` rows joined to recent posts if recency still matters.

### 3. Case-Insensitive Search
Current pattern:
- `contains(..., mode: 'insensitive')`

Decision:
- service semantics should remain case-insensitive where users expect it, but the implementation must not depend on PostgreSQL assumptions.

Recommended implementation order:
1. verify whether current Prisma SQLite provider supports these call sites adequately;
2. if support is inconsistent, normalize query input to lowercase and add mirrored normalized text columns only where needed;
3. do not block WP2 on perfect search semantics if a simpler SQLite-safe fallback exists for local-first usage.

Affected services:
- `ProjectService.listProjects`
- `CommunityService.search`
- `SkillService.listSkills`

## API Compatibility Rules
The public API should still return arrays for:
- `user.expertise`
- `skill.tags`
- `post.tags`
- `post.attachments`

But those arrays become assembled view data, not raw DB scalar lists.

This means service-layer mapping is required:
- read nested relation rows and flatten them into arrays for API responses;
- write arrays by replacing relation rows in create/update flows.

## Service-Layer Rewrite Requirements

### User service
Needed changes:
- create demo user without scalar-list writes;
- update profile by replacing `UserExpertise` rows;
- select nested expertise rows and flatten to `string[]`.

### Skill service
Needed changes:
- create skill plus `SkillTag` children;
- list/search skills through `tagItems`;
- return flattened `tags` arrays.

### Community service
Needed changes:
- create posts plus `PostTag` and `PostAttachment` children;
- list posts and searches through relation filters;
- compute popular tags from `PostTag`;
- return flattened `tags` and `attachments`.

### Tests
Needed changes:
- any test fixture or expectation that assumes raw scalar-list persistence must be updated to nested relation behavior.

## Naming Decision
Keep the new child-table names singular in Prisma model names and pluralized only in relation field names:
- model `UserExpertise`, relation `expertiseItems`
- model `SkillTag`, relation `tagItems`
- model `PostTag`, relation `tagItems`
- model `PostAttachment`, relation `attachments`

This keeps schema naming explicit and avoids confusion with the existing API field names.

## Migration Baseline Strategy
Recommended approach:
- create a clean SQLite migration baseline after the schema redesign is finalized;
- do not try to preserve the PostgreSQL migration history as-is under the SQLite provider.

Why:
- Prisma migration history is provider-specific enough that carrying the old baseline forward adds confusion;
- Phase 13 already plans a dedicated PostgreSQL-to-SQLite data migration path.

## Acceptance Decision for WP2
WP2 can be considered approved once this schema design is accepted as the target because:
- every known SQLite schema blocker now has a concrete replacement;
- service-layer implications are explicit;
- the next step is implementation, not more design discovery.
