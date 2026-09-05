# Educational System Backend MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Replace the demo-only localStorage flow with a locally runnable SQLite backend and connect the existing educational-system UI to it.

**Architecture:** A small NestJS REST API in `server/` uses Prisma with SQLite, JWT access/refresh tokens, local `storage/` files, and server-side authorization derived from the authenticated user's school. The static frontend keeps its current visual system and gains a thin `src/api.js` client; domain calculation rules remain shared and are revalidated by the API.

**Tech Stack:** Node.js 20+, NestJS, Prisma, SQLite, JWT, bcrypt, class-validator, multer, exceljs, native `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-02-educational-system-backend-design.md`

## Global Constraints

- Run without Docker; database is `data/dev.db` and uploads are in `storage/`.
- Roles are `TEACHER` and `DEPUTY`; one deputy per school; school scope always comes from JWT.
- One application per teacher and reporting period; rejected applications can be edited and resubmitted.
- Amounts, criterion fields, status transitions, upload limits, and school scope are enforced server-side.
- Preserve the current UI style and avoid broad cosmetic rewrites.
- Run tests only after each complete stage, not after every small edit.

### Task 1: Backend scaffold, Prisma schema, seed, and auth

**Files:**
- Create: `server/src/main.ts`, `server/src/app.module.ts`, `server/src/common/*`, `server/src/auth/*`, `server/src/profile/*`, `server/prisma/schema.prisma`, `server/prisma/seed.ts`, `server/package.json`, `server/tsconfig.json`, `.env.example`
- Modify: root `package.json`, `README.md`
- Test: `server/test/auth.e2e-spec.ts`

**Interfaces:**
- `POST /api/auth/register`, `/login`, `/refresh`, `/logout`
- `GET/PATCH /api/profile`
- Prisma models from the approved spec with enums for roles, statuses, field types, and criterion types.

- [x] Add NestJS/Prisma dependencies and scripts (`server:dev`, `db:migrate`, `seed`, `test:server`).
- [x] Implement Prisma schema, migration, and deterministic seed containing two schools, one deputy per school, teachers, a period, and starter criteria.
- [x] Implement bcrypt password hashing, signed access JWTs, hashed refresh tokens, logout revocation, and auth guard that attaches `{ userId, role, schoolId }`.
- [x] Implement registration validation including existing-school lookup and one-deputy constraint; never return password fields.
- [x] Implement profile read/update with school and role read-only.
- [x] Run the auth integration test against a temporary SQLite database and verify `npm test` still passes.

### Task 2: Criteria constructor and server-side calculation

**Files:**
- Create: `server/src/criteria/*`, `server/src/domain/calculation.ts`
- Modify: Prisma schema/migration and seed as needed
- Test: `server/test/criteria.e2e-spec.ts`, `server/test/calculation.test.ts`

**Interfaces:**
- `GET /api/criteria`
- `POST/PATCH/DELETE /api/criteria` (deputy only, school scoped)
- DTOs support custom fields, quality percentage bands, olympiad level/diploma amounts, max amount, and `allowEvidence`.

- [x] Add criterion, field, scale, and version persistence with transactionally created versions.
- [x] Validate non-overlapping percentage bands, non-negative amounts, field definitions, and immutable historical snapshots.
- [x] Return active criteria to teachers and full school criteria to deputies.
- [x] Add soft-delete behavior when a criterion has been used by an application.
- [x] Cover deputy-only access, school isolation, and quality/olympiad calculations with focused tests.

### Task 3: Applications and review workflow

**Files:**
- Create: `server/src/applications/*`, `server/src/reviews/*`, `server/src/notifications/*`
- Modify: Prisma schema/migration, `server/src/domain/calculation.ts`
- Test: `server/test/applications.e2e-spec.ts`

**Interfaces:**
- `GET/POST/PATCH /api/applications`, `GET /api/applications/:id`, `POST /api/applications/:id/submit`
- `GET /api/reviews`, `POST /api/reviews/:id/approve`, `POST /api/reviews/:id/reject`
- `GET /api/notifications`, `POST /api/notifications/:id/read`

- [x] Enforce `(teacherId, periodId)` uniqueness and draft/rejected edit rules.
- [x] Persist application-item snapshots and dynamic values, olympiad entries, totals, and evidence links.
- [x] Recalculate totals on every write and validate quality/olympiad/custom fields on submit.
- [x] Implement atomic approve/reject transitions scoped to deputy school; reject requires a comment and resubmission clears the old decision.
- [x] Create notifications for submit, approve, reject; add read endpoints and audit records.
- [x] Run the workflow smoke test covering cross-school denial and rejected resubmission.

### Task 4: Files and Excel reporting

**Files:**
- Create: `server/src/files/*`, `server/src/reports/*`, `server/storage/.gitkeep`, `server/test/files-reports.e2e-spec.ts`
- Modify: `server/src/app.module.ts`, `README.md`

**Interfaces:**
- `POST /api/files` multipart upload, `GET /api/files/:id` download
- `GET /api/reports/:periodId/export.xlsx`

- [x] Validate MIME/extension allowlist and size, generate UUID filenames, store metadata, and enforce application/school access on download.
- [x] Generate an `.xlsx` workbook with applications, criteria, and totals sheets; include only approved applications in the deputy's school.
- [x] Add an audit entry for uploads and exports and test unauthorized download/export paths.

### Task 5: Frontend API integration and local launch

**Files:**
- Create: `src/api.js`, `server/README.md`
- Modify: `src/app.js`, `src/styles.css`, root `package.json`, `README.md`
- Test: `tests/api-client.test.mjs`

**Interfaces:**
- API client methods for auth, profile, criteria, applications, files, reports, and notifications.
- Existing render functions consume API-loaded state while preserving current fallback demo state when API is unavailable.

- [x] Add token-aware fetch client with one refresh attempt on 401 and normalized `{ code, message, details }` errors.
- [x] Replace teacher/deputy demo mutations with API calls for auth/profile, criteria, applications, review, upload, notifications, and export.
- [x] Keep responsive layout fixes, fixed-currency rendering, and school-scoped lists intact.
- [x] Document exact no-Docker commands, default seeded accounts, ports, and migration/reset instructions.
- [x] Run one final smoke command: server starts, seeded login works, a teacher submits, deputy approves, and export returns XLSX; then run the existing frontend tests.
