# Repository Concern Log

Last refreshed: 2026-03-12
Scope: full repository (`backend/`, `core/`, `frontend/`, `scripts/`, root ops files)

## Highest-Risk Concerns

### 1. Authentication is effectively stubbed, while privileged flows behave as if auth exists
- Evidence:
  - `backend/src/index.ts` registers CORS and Swagger only; there is no JWT plugin, auth hook, or request decoration setup beyond type metadata.
  - `backend/src/types/fastify.d.ts:3` declares `request.user`, but repository search shows no `jwtVerify`, `authenticate`, `Authorization`, or `@fastify/jwt` usage under `backend/src/`.
  - Multiple routes read `request.user?.id` as if it is present, for example `backend/src/api/project.ts:33`, `backend/src/api/community.ts:41`, `backend/src/api/chat.ts:131`, and `backend/src/api/skill.ts:75`.
- Why this is risky:
  - The API surface suggests authenticated ownership and per-user data, but runtime behavior is unauthenticated.
  - This creates a false sense of access control and makes later hardening harder because many flows already assume nullable identity.

### 2. Missing auth falls through to demo-user auto-creation, causing silent privilege and data-integrity problems
- Evidence:
  - `backend/src/utils/demo-data.ts:26` returns the provided `userId` when present, but otherwise auto-creates a demo user via `ensureDemoUser()`.
  - `backend/src/services/project.ts:20`, `backend/src/services/community.ts:70`, `backend/src/services/skill.ts:239`, `backend/src/services/user.ts:75`, and `backend/src/services/analysis.ts:34` all rely on `ensureUserId()` or `ensureProjectId()`.
  - `backend/src/utils/demo-data.ts:35` will also auto-create a demo project when no project is supplied.
- Why this is risky:
  - Anonymous or partially wired requests can mutate state as a seeded pseudo-user instead of failing closed.
  - Ownership bugs will be masked in development because calls appear to succeed.
  - Production data can be polluted with fake users/projects if these helpers are left enabled.

### 3. Passwords and tokens are dev-grade, but the API exposes them as real auth
- Evidence:
  - `backend/src/services/user.ts:31` stores `hashPassword(params.password)`, and `backend/src/utils/demo-data.ts:6` implements that as unsalted SHA-256.
  - `backend/src/services/user.ts:49` and `backend/src/services/user.ts:63` return `dev-token-${user.id}` instead of a signed JWT.
  - `backend/src/config/index.ts:54` falls back to a static JWT secret, but the application does not actually verify JWTs.
  - `backend/prisma/seed.ts:250` prints demo credentials to stdout.
- Why this is risky:
  - Password storage is not suitable for real users.
  - Clients can mistake opaque dev strings for valid auth tokens.
  - Migration to real auth will be a breaking change across login, middleware, tests, and clients.

### 4. Security defaults are permissive across services and local ops
- Evidence:
  - `backend/src/config/index.ts:48` defaults `DATABASE_URL` to local superuser credentials, and `backend/src/config/index.ts:54` defaults `JWT_SECRET`.
  - `docker-compose.yml:42` and `docker-compose.yml:44` hardcode database credentials and a placeholder JWT secret in the backend container.
  - `docker-compose.yml:13` and `docker-compose.yml:27` publish PostgreSQL and Redis directly to the host.
  - `core/main.py:38` enables CORS with `allow_origins=["*"]`, `allow_methods=["*"]`, and `allow_headers=["*"]`.
- Why this is risky:
  - Local-first defaults can leak into shared or production-like environments.
  - The core service is network-open by default and has no auth layer.
  - Dockerized environments are easy to start, but easy to mis-expose.

## High Concerns

### 5. Redis failure is intentionally hidden, so health and session behavior can lie
- Evidence:
  - `backend/src/utils/redis.ts:87` returns `'PONG'` even when Redis is disabled or a `ping()` fails.
  - `backend/src/utils/redis.ts:46` and `backend/src/utils/redis.ts:58` silently fall back to an in-memory map on `get`/`setex` errors.
  - `backend/src/index.ts:56` always returns HTTP 200 from `/health`, even if `database` or `redis` checks are `false`.
  - `backend/src/services/agent.ts:2050` to `backend/src/services/agent.ts:2099` swallows session persistence/read/cleanup failures.
- Why this is risky:
  - Operators can see “healthy” while Redis-backed continuity is already degraded.
  - In multi-instance deployments, the in-memory fallback breaks cross-instance conversation state.
  - Incidents become harder to diagnose because failures are downgraded to silent behavior changes.

### 6. Authorization checks are largely absent from read/write paths
- Evidence:
  - `backend/src/services/project.ts:79`, `backend/src/services/project.ts:115`, and `backend/src/services/project.ts:122` fetch, update, and delete projects by raw ID without verifying owner/member access.
  - `backend/src/services/analysis.ts:59` returns model data by ID without project scoping, and `backend/src/services/analysis.ts:98` runs analyses by ID without ownership checks.
  - `backend/src/services/skill.ts:183` installs skills into any supplied project ID and ignores `_userId`.
  - `backend/src/services/community.ts:173` creates comments and `backend/src/services/community.ts:125` creates likes using resolved demo or caller IDs without post/project permission checks.
- Why this is risky:
  - Once real auth is added, many endpoints will still be horizontally over-permissive.
  - Current tests may miss this because the demo-user fallback hides missing principals.

### 7. `backend/src/services/agent.ts` is a monolith and a maintenance hotspot
- Evidence:
  - `backend/src/services/agent.ts` is 2,119 lines.
  - The same file owns protocol schema generation, natural-language extraction, session state, tool orchestration, streaming, reporting, LLM summaries, and Redis persistence.
  - Complex execution paths are concentrated in `backend/src/services/agent.ts:534` onward, artifact persistence in `backend/src/services/agent.ts:1532`, and session storage in `backend/src/services/agent.ts:2050`.
  - The file uses broad `catch (error: any)` patterns repeatedly, for example `backend/src/services/agent.ts:526`, `backend/src/services/agent.ts:675`, `backend/src/services/agent.ts:726`, and `backend/src/services/agent.ts:815`.
- Why this is risky:
  - A single edit can affect routing, UX copy, protocol contracts, and persistence behavior.
  - It is difficult to unit-test in isolation because concerns are tightly coupled.
  - Error handling is repetitive and easy to desynchronize across branches.

### 8. Core numerical engine is also concentrated in large procedural files
- Evidence:
  - `core/fem/static_analysis.py` is 1,408 lines and mixes assembly, solution, envelope generation, and summary formatting.
  - Representative dense output shaping happens around `core/fem/static_analysis.py:987` to `core/fem/static_analysis.py:1047`.
  - `core/main.py:223` dispatches analysis types directly into large analyzer classes instead of a thinner service boundary.
- Why this is risky:
  - Regression risk is high for solver changes because data shaping and solver math are interleaved.
  - Performance tuning and correctness auditing are harder without narrower units.

## Medium Concerns

### 9. Database schema is missing supporting indexes for current query patterns
- Evidence:
  - `backend/prisma/schema.prisma` defines many relations and unique constraints, but repository search found no `@@index` or `@index` declarations.
  - Hot query paths sort or filter by `updatedAt`, `createdAt`, `ownerId`, `authorId`, `projectId`, and `status` in files such as `backend/src/services/project.ts:35`, `backend/src/services/community.ts:31`, `backend/src/services/user.ts:129`, and `backend/src/services/chat.ts:274`.
- Why this is risky:
  - The current schema can work on small seeded datasets but will degrade as content grows.
  - Search/list endpoints are already shaped like product APIs, not admin-only tools.

### 10. Chat state is duplicated between the database and unbounded in-process memory
- Evidence:
  - `backend/src/services/chat.ts:56` keeps a `Map<string, BufferMemory>`.
  - `backend/src/services/chat.ts:282` creates per-conversation memory entries with no eviction policy.
  - Messages are also persisted to Prisma in `backend/src/services/chat.ts:99`, `backend/src/services/chat.ts:134`, `backend/src/services/chat.ts:182`, and `backend/src/services/chat.ts:215`.
- Why this is risky:
  - Long-lived processes accumulate memory indefinitely.
  - In-memory conversation context and persisted conversation history can diverge after restarts or horizontal scaling.

### 11. Search and list APIs are simple scans with shallow limits, not scalable retrieval layers
- Evidence:
  - `backend/src/services/community.ts:218` runs `contains` queries over posts and skills and returns up to 20 rows from each side.
  - `backend/src/services/community.ts:198` calculates popular tags by loading recent posts and counting tags in process memory.
  - `backend/src/services/project.ts:57` and `backend/src/services/user.ts:138` use direct `findMany` calls with eager includes and fixed `take` limits.
- Why this is risky:
  - This is fine for small datasets, but ranking quality and response time will collapse together at scale.
  - The absence of indexes compounds the problem.

### 12. Report artifact writes have no lifecycle management
- Evidence:
  - `backend/src/services/agent.ts:1537` writes reports into `config.uploadDir/reports`.
  - `backend/src/config/index.ts:77` defaults uploads to `./uploads`.
  - `.gitignore:24` ignores `uploads/*`, so artifacts accumulate outside version control unless explicitly cleaned.
- Why this is risky:
  - Storage usage grows with agent traffic.
  - There is no retention, quota, or ownership cleanup path in the backend.

## Workflow And Delivery Risks

### 13. Startup automation is convenient but destructive and environment-sensitive
- Evidence:
  - `scripts/dev-up.sh:194` to `scripts/dev-up.sh:197` deletes `frontend/.next` automatically when it detects stale build artifacts.
  - `scripts/dev-up.sh:262` to `scripts/dev-up.sh:265` deletes `core/.venv` before reinstalling dependencies.
  - `scripts/dev-up.sh:305` to `scripts/dev-up.sh:307` always runs migrations and seed unless explicitly skipped.
- Why this is risky:
  - Local “self-healing” can hide underlying dependency or cache problems.
  - Automatic seed/migration behavior changes developer state as a side effect of startup.

### 14. Verification is script-heavy, but many core risks are not directly guarded
- Evidence:
  - `Makefile:126`, `Makefile:129`, and `Makefile:132` route most verification through shell scripts.
  - `scripts/check-startup.sh:47` to `scripts/check-startup.sh:85` runs a large chain of script-driven checks.
  - The current backend tests are narrow (`backend/tests/agent.service.test.mjs`, `backend/tests/llm-error.test.mjs`) compared with the size of `backend/src/services/agent.ts`, `backend/src/services/chat.ts`, and CRUD service code.
- Why this is risky:
  - Contract scripts catch integration regressions, but they do not replace focused unit coverage around auth, authorization, persistence fallback, and orchestration branches.
  - The most fragile files are larger than the direct test surface covering them.

### 15. Repo health depends on generated/demo assumptions that may not survive production hardening
- Evidence:
  - `backend/prisma/seed.ts` seeds a full demo user/project/model/analysis/post stack.
  - `backend/src/utils/demo-data.ts` reuses the same demo identity pattern inside runtime service code, not just setup tooling.
  - `README.md` and startup scripts are optimized for local end-to-end convenience, while runtime services still expose community/project/chat operations as if they were production-ready APIs.
- Why this is risky:
  - The codebase currently blends demo scaffolding with application behavior.
  - Hardening work will need careful separation of dev-only helpers from real runtime paths.

## Suggested Stabilization Order

1. Remove demo-user fallback from request-time service paths and fail closed on missing identity.
2. Introduce real auth middleware and enforce authorization at service boundaries.
3. Make Redis and database health truthful; stop masking degraded state as healthy.
4. Split `backend/src/services/agent.ts` into orchestration, extraction, persistence, and reporting modules.
5. Add Prisma indexes for existing access patterns before data volume grows.
6. Add retention/cleanup rules for `uploads/reports`.
7. Separate local-demo bootstrap logic from production runtime code.
