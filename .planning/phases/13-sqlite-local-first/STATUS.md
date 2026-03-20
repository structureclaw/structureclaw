# Phase 13 Status Ledger

Updated: 2026-03-20
Owner: backend-agent

## Current Execution Rule
- Treat SQLite as the new default persistence target, not a side experiment.
- Finish schema compatibility and startup simplification before polishing admin UX.
- Preserve a safe migration path for existing PostgreSQL-backed local users.

## Architectural Position
- Prisma remains the persistence boundary.
- SQLite becomes the default persistent database for local and beginner Docker usage.
- PostgreSQL-specific schema features must be removed or normalized.
- Database admin UX must become provider-neutral or SQLite-oriented.
- Redis remains separate from this migration unless it blocks the local-first startup story.

## Checklist
- [x] Phase 13 planning track created
- [x] Core migration direction documented
- [x] Persistence surface audit completed
- [x] PostgreSQL-only schema features inventory completed
- [x] SQLite schema redesign approved
- [ ] SQLite datasource and migration baseline implemented
- [ ] Runtime defaults switched from PostgreSQL to SQLite
- [ ] Scripts and Docker default path switched to SQLite
- [ ] pgAdmin-specific admin UX removed or replaced
- [ ] PostgreSQL-to-SQLite migration tooling implemented
- [ ] SQLite regression matrix added
- [ ] Docs updated for SQLite-first onboarding

## Work Package Status
- [x] WP1 Audit the Real Persistence Surface
- [x] WP2 Redesign the Prisma Schema for SQLite
- [ ] WP3 Define Runtime Database Defaults and File Lifecycle
- [ ] WP4 Migrate Tooling, Scripts, and Docker Away From PostgreSQL-First Assumptions
- [ ] WP5 Replace pgAdmin-Centric Admin UX
- [ ] WP6 Add PostgreSQL-to-SQLite Migration Utilities
- [ ] WP7 Rebuild the Regression Matrix Under SQLite
- [ ] WP8 Docs, Release, and Default-Path Cleanup

## Known Migration Constraints
- `backend/prisma/schema.prisma` still targets PostgreSQL.
- Runtime defaults still point `DATABASE_URL` at PostgreSQL even though the first scalar-list normalization slice is now implemented in schema and services.
- Backend config still defaults `DATABASE_URL` to PostgreSQL.
- Docker compose still starts `postgres` and `pgadmin`.
- Startup and regression scripts still assume PostgreSQL in multiple places.
- The frontend database page is currently a pgAdmin launcher, not a provider-neutral database status page.
- Existing Prisma migration history is still PostgreSQL-based and has not yet been replaced by a SQLite baseline.

## Completed This Iteration
- Audited every active Prisma-backed service surface and mapped the main persistence domains: chat, agent snapshots, projects, analyses, users, skills, and community content.
- Identified all active schema-level SQLite blockers: `User.expertise`, `Skill.tags`, `Post.tags`, and `Post.attachments`.
- Identified service-level query rewrites required beyond the schema flip, especially scalar-list `has` filters and case-insensitive `contains(..., mode: 'insensitive')` queries.
- Identified all beginner-path PostgreSQL assumptions in config, Docker, Make targets, scripts, admin API responses, frontend database UI, and related tests.
- Captured the audit in [01-persistence-surface-audit.md](/data1/openclaw/workspace/projects/10structureclaw/dev/structureclaw/.planning/phases/13-sqlite-local-first/01-persistence-surface-audit.md).
- Approved the SQLite target schema in [02-sqlite-schema-redesign.md](/data1/openclaw/workspace/projects/10structureclaw/dev/structureclaw/.planning/phases/13-sqlite-local-first/02-sqlite-schema-redesign.md), including normalized replacements for all active scalar lists and the required service-layer query rewrites.
- Implemented the first persistence refactor slice in code: scalar-list fields were replaced in Prisma schema with relation tables, Postgres transition migration SQL was added, and `user` / `skill` / `community` services now flatten relation rows back into the existing array-shaped API responses.
- Removed current service dependencies on scalar-list `has` filters and `mode: 'insensitive'` search options so the codebase is closer to SQLite-compatible Prisma query shapes.
- Added targeted regression coverage in [sqlite-relation-mapping.test.mjs](/data1/openclaw/workspace/projects/10structureclaw/dev/structureclaw/backend/tests/sqlite-relation-mapping.test.mjs) and verified backend build plus targeted agent/chat regressions after the refactor.

## Immediate Next Actions
1. Switch Prisma datasource and runtime defaults from PostgreSQL to SQLite once the file-path and WAL policy are finalized.
2. Replace PostgreSQL-first startup assumptions in Docker, Make targets, and scripts.
3. Rework the database admin API and frontend database page away from pgAdmin-specific messaging.
4. Add PostgreSQL-to-SQLite migration tooling and then run the broader SQLite regression matrix.

## Exit Gate
All items below must be true:
- [ ] fresh local startup works without PostgreSQL
- [ ] default Docker startup works without PostgreSQL and pgAdmin
- [ ] Prisma schema and migrations are SQLite-compatible
- [ ] data migration path from PostgreSQL exists
- [ ] persistence-critical regressions pass under SQLite
- [ ] onboarding docs present SQLite as the default path

Gate status: in progress; the first schema-and-service implementation slice is complete, and the next blocking step is switching runtime defaults and migrations from PostgreSQL to SQLite.
