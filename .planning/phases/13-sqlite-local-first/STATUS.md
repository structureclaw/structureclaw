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
- [x] SQLite datasource and migration baseline implemented
- [x] Runtime defaults switched from PostgreSQL to SQLite
- [x] Scripts and Docker default path switched to SQLite
- [x] pgAdmin-specific admin UX removed or replaced
- [x] PostgreSQL-to-SQLite migration tooling implemented
- [x] SQLite regression matrix added
- [ ] Docs updated for SQLite-first onboarding

## Work Package Status
- [x] WP1 Audit the Real Persistence Surface
- [x] WP2 Redesign the Prisma Schema for SQLite
- [x] WP3 Define Runtime Database Defaults and File Lifecycle
- [x] WP4 Migrate Tooling, Scripts, and Docker Away From PostgreSQL-First Assumptions
- [x] WP5 Replace pgAdmin-Centric Admin UX
- [x] WP6 Add PostgreSQL-to-SQLite Migration Utilities
- [ ] WP7 Rebuild the Regression Matrix Under SQLite
- [ ] WP8 Docs, Release, and Default-Path Cleanup

## Known Migration Constraints
- Existing Prisma migration history is still PostgreSQL-based; the current SQLite path uses a custom schema-sync baseline instead of an adopted migration reset.
- Some backend regression helpers still emit noisy missing-`DATABASE_URL` validation logs before their local SQLite fallback kicks in.

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
- Switched [schema.prisma](/data1/openclaw/workspace/projects/10structureclaw/dev/structureclaw/backend/prisma/schema.prisma) and [migration_lock.toml](/data1/openclaw/workspace/projects/10structureclaw/dev/structureclaw/backend/prisma/migration_lock.toml) to SQLite, and upgraded Prisma runtime tooling to a version that validates the current SQLite JSON-heavy schema.
- Added [sync-sqlite-schema.mjs](/data1/openclaw/workspace/projects/10structureclaw/dev/structureclaw/backend/scripts/sync-sqlite-schema.mjs) as the current SQLite schema baseline path, using `prisma migrate diff` plus `prisma db execute` instead of relying on unstable `prisma db push` behavior for this schema.
- Switched backend runtime defaults in [index.ts](/data1/openclaw/workspace/projects/10structureclaw/dev/structureclaw/backend/src/config/index.ts) and [database.ts](/data1/openclaw/workspace/projects/10structureclaw/dev/structureclaw/backend/src/utils/database.ts) to `.runtime/data/structureclaw.db`, including local directory creation and absolute `file:` URL normalization.
- Switched the beginner startup path in [docker-compose.yml](/data1/openclaw/workspace/projects/10structureclaw/dev/structureclaw/docker-compose.yml), [Makefile](/data1/openclaw/workspace/projects/10structureclaw/dev/structureclaw/Makefile), [dev-up.sh](/data1/openclaw/workspace/projects/10structureclaw/dev/structureclaw/scripts/dev-up.sh), [dev-down.sh](/data1/openclaw/workspace/projects/10structureclaw/dev/structureclaw/scripts/dev-down.sh), and [.env.example](/data1/openclaw/workspace/projects/10structureclaw/dev/structureclaw/.env.example) so PostgreSQL and pgAdmin are no longer part of the default local or Docker startup path.
- Verified the new SQLite path with fresh-schema sync, no-op re-sync, `db:init`, targeted backend tests, and [check-backend-regression.sh](/data1/openclaw/workspace/projects/10structureclaw/dev/structureclaw/scripts/check-backend-regression.sh).
- Replaced pgAdmin-oriented admin metadata in [admin-database.ts](/data1/openclaw/workspace/projects/10structureclaw/dev/structureclaw/backend/src/api/admin-database.ts) with a SQLite file-status response, and rebuilt the console database page in [page.tsx](/data1/openclaw/workspace/projects/10structureclaw/dev/structureclaw/frontend/src/app/(console)/console/database/page.tsx) as a bilingual read-only SQLite status view.
- Updated the related user-facing copy in [i18n.ts](/data1/openclaw/workspace/projects/10structureclaw/dev/structureclaw/frontend/src/lib/i18n.ts) and added targeted regression coverage in [admin-database.route.test.mjs](/data1/openclaw/workspace/projects/10structureclaw/dev/structureclaw/backend/tests/admin-database.route.test.mjs) and [database-page.test.tsx](/data1/openclaw/workspace/projects/10structureclaw/dev/structureclaw/frontend/tests/integration/database-page.test.tsx).
- Added PostgreSQL-to-SQLite migration tooling via [migrate-postgres-to-sqlite.sh](/data1/openclaw/workspace/projects/10structureclaw/dev/structureclaw/scripts/migrate-postgres-to-sqlite.sh), [migrate-postgres-to-sqlite.mjs](/data1/openclaw/workspace/projects/10structureclaw/dev/structureclaw/backend/scripts/migrate-postgres-to-sqlite.mjs), and [postgres-to-sqlite-lib.mjs](/data1/openclaw/workspace/projects/10structureclaw/dev/structureclaw/backend/scripts/postgres-to-sqlite-lib.mjs), including conversion of legacy PostgreSQL scalar-list arrays into the new SQLite relation tables.
- Added targeted regression coverage in [postgres-to-sqlite-migration.test.mjs](/data1/openclaw/workspace/projects/10structureclaw/dev/structureclaw/backend/tests/postgres-to-sqlite-migration.test.mjs), plus CLI usage validation for the new migration entrypoints.
- Added [auto-migrate-legacy-postgres.sh](/data1/openclaw/workspace/projects/10structureclaw/dev/structureclaw/scripts/auto-migrate-legacy-postgres.sh) and wired it into [check-startup.sh](/data1/openclaw/workspace/projects/10structureclaw/dev/structureclaw/scripts/check-startup.sh) and [dev-up.sh](/data1/openclaw/workspace/projects/10structureclaw/dev/structureclaw/scripts/dev-up.sh) so `doctor` and default startup can detect a legacy local PostgreSQL `.env`, migrate into SQLite, and rewrite `.env` to the SQLite default path automatically.
- Completed one real local rehearsal against an existing legacy PostgreSQL-backed workspace, which surfaced and then validated the remaining scalar-list sanitization needed by the migration tool.

## Immediate Next Actions
1. Remove the remaining noisy missing-`DATABASE_URL` regression-script paths so SQLite validation is clean by default.
2. Update onboarding and operator docs so SQLite is described as the first-class default path.
3. Decide whether to keep the current custom SQLite schema-sync baseline or replace it later with a formal adopted migration reset.
4. Add a small operator note explaining the new `.env.pre-sqlite-migration.*.bak` backup behavior.

## Exit Gate
All items below must be true:
- [ ] fresh local startup works without PostgreSQL
- [ ] default Docker startup works without PostgreSQL and pgAdmin
- [x] Prisma schema and migrations are SQLite-compatible
- [x] data migration path from PostgreSQL exists
- [x] persistence-critical regressions pass under SQLite
- [ ] onboarding docs present SQLite as the default path

Gate status: in progress; WP3 through WP6 are implemented and locally rehearsed, and the remaining blocking steps are quieter regression scripts plus final onboarding cleanup.
