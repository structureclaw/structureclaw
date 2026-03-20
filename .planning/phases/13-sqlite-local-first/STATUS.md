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
- [ ] Persistence surface audit completed
- [ ] PostgreSQL-only schema features inventory completed
- [ ] SQLite schema redesign approved
- [ ] SQLite datasource and migration baseline implemented
- [ ] Runtime defaults switched from PostgreSQL to SQLite
- [ ] Scripts and Docker default path switched to SQLite
- [ ] pgAdmin-specific admin UX removed or replaced
- [ ] PostgreSQL-to-SQLite migration tooling implemented
- [ ] SQLite regression matrix added
- [ ] Docs updated for SQLite-first onboarding

## Work Package Status
- [ ] WP1 Audit the Real Persistence Surface
- [ ] WP2 Redesign the Prisma Schema for SQLite
- [ ] WP3 Define Runtime Database Defaults and File Lifecycle
- [ ] WP4 Migrate Tooling, Scripts, and Docker Away From PostgreSQL-First Assumptions
- [ ] WP5 Replace pgAdmin-Centric Admin UX
- [ ] WP6 Add PostgreSQL-to-SQLite Migration Utilities
- [ ] WP7 Rebuild the Regression Matrix Under SQLite
- [ ] WP8 Docs, Release, and Default-Path Cleanup

## Known Migration Constraints
- `backend/prisma/schema.prisma` still targets PostgreSQL.
- Scalar list fields currently exist in `User`, `Skill`, and `Post` models.
- Backend config still defaults `DATABASE_URL` to PostgreSQL.
- Docker compose still starts `postgres` and `pgadmin`.
- Startup and regression scripts still assume PostgreSQL in multiple places.
- The frontend database page is currently a pgAdmin launcher, not a provider-neutral database status page.

## Immediate Next Actions
1. Produce a persistence audit covering models, routes, scripts, and operator docs that still assume PostgreSQL.
2. Decide the exact SQLite replacements for scalar list fields before touching the datasource provider.
3. Define the default SQLite file path and whether WAL mode is enabled in local runtime.
4. Split operator requirements into two paths: fresh SQLite-first setup and existing PostgreSQL-to-SQLite migration.

## Exit Gate
All items below must be true:
- [ ] fresh local startup works without PostgreSQL
- [ ] default Docker startup works without PostgreSQL and pgAdmin
- [ ] Prisma schema and migrations are SQLite-compatible
- [ ] data migration path from PostgreSQL exists
- [ ] persistence-critical regressions pass under SQLite
- [ ] onboarding docs present SQLite as the default path

Gate status: not started.
