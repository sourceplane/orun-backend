# Task 0021 Verifier Report

## Result

**PASS**

## Summary

PR #39 (`feat/task-0021-v2-packages-db-migration-harness`, head `2bb9bd1`) creates `packages/db` as `@orun/db` — the first V2 Supabase/Postgres database foundation. The package is real, buildable, and tested. The migration harness correctly handles ordering, checksums, status, apply, and mismatch detection using a `FakeDbClient` for offline tests. `0001_core.sql` implements the full bounded 8-table core schema matching `spec/v2/01-data-model.md`. All local and CI checks pass. No V1 behavior was touched. Live database smoke was not possible (no Docker, no local Postgres); this is recorded below.

## PR Reviewed

- **PR**: `sourceplane/orun-backend#39`
- **Title**: `feat: task-0021 @orun/db — V2 Postgres migration harness and core schema`
- **Branch**: `feat/task-0021-v2-packages-db-migration-harness`
- **Head commit**: `2bb9bd1c8a91dee0eeb581deca522c0455183127`
- **Base**: `main`
- **State**: Open, clean merge state
- **Additions**: 2817 lines added, 47 deleted (lockfile update)

## DB Foundation Verification

All foundation criteria verified:

| Check | Result |
|---|---|
| `packages/db` exists in workspace (`packages/*`) | ✅ |
| Named `@orun/db` in `package.json` | ✅ |
| Module entrypoint: `./dist/index.js` / `./src/index.ts` | ✅ |
| Scripts: `build`, `typecheck`, `test`, `lint` | ✅ |
| `component.yaml` type `turbo-package`, name `orun-db` | ✅ |
| `README.md` explains migration usage, `DATABASE_URL`, scope, V1 D1 separate | ✅ |
| `src/index.ts` exports harness, loader, client, ID helpers, domain types | ✅ |
| `ids.ts`: `isValidSlug`, `isUuid` helpers | ✅ |
| No dist/, .turbo, node_modules tracked (git ls-files verified) | ✅ |

`git ls-files packages/db` returns exactly the 16 source files: `package.json`, `tsconfig.json`, `vitest.config.ts`, `component.yaml`, `README.md`, `migrations/0001_core.sql`, and 10 `src/` files. No generated artifacts.

## Schema Review

`packages/db/migrations/0001_core.sql` reviewed against `spec/v2/01-data-model.md`.

### Tables present (all 8 required)

| Table | UUID PK | org_id FK | Notes |
|---|---|---|---|
| `users` | caller-supplied (no default) | — | Matches Supabase Auth UUID contract |
| `user_identities` | `gen_random_uuid()` | — | `unique (provider, provider_user_id)`, `unique (user_id, provider)` |
| `organizations` | `gen_random_uuid()` | — | `unique slug`; `provisioning_mode` and `lifecycle_status` check constraints; `deleted_at` soft-delete |
| `organization_members` | `(organization_id, user_id)` composite PK | ✅ | `role` and `status` check constraints |
| `organization_invites` | `gen_random_uuid()` | ✅ | `token_hash unique`; `role` check constraint |
| `billing_accounts` | `gen_random_uuid()` | ✅ unique | `provider`, `plan`, `status` check constraints |
| `entitlements` | `(organization_id, key)` composite PK | ✅ | |
| `projects` | `gen_random_uuid()` | ✅ | `unique (organization_id, slug)`; `lifecycle_status` check constraint; `deleted_at` soft-delete |

### Constraints and indexes verified

| Requirement | Result |
|---|---|
| `CREATE EXTENSION IF NOT EXISTS "pgcrypto"` (idempotent UUID support) | ✅ |
| `users.id` UUID, no auto-default (caller-supplied Supabase Auth UUID) | ✅ |
| `organization_id` on all tenant-owned tables | ✅ |
| Role/status check constraints (owner/admin/member/viewer, active/disabled) | ✅ |
| Lifecycle check constraints (active/suspended/deleted, active/archived/deleted) | ✅ |
| Provisioning mode check (shared/dedicated_schema/dedicated_database) | ✅ |
| Billing plan/provider/status checks | ✅ |
| Unique organization slug | ✅ |
| Unique `(organization_id, slug)` for projects | ✅ |
| Unique `(provider, provider_user_id)` for identities | ✅ |
| `token_hash unique` on invites | ✅ |
| Tenant-scoped indexes starting with `organization_id` (idx_projects_org, idx_org_members_org, idx_org_invites_org) | ✅ |
| `idx_org_invites_email` on `lower(email)` | ✅ |
| `created_at`, `updated_at` on all tables | ✅ |
| `deleted_at` soft-delete on `organizations` and `projects` | ✅ |
| `orun_set_updated_at()` trigger function (generic, idempotent via `CREATE OR REPLACE`) | ✅ |
| Trigger applied to all 8 tables | ✅ |
| No checked-in secrets, database URLs, API keys, tokens, or private keys | ✅ |

### Out-of-scope tables absent

`github_installations`, `repositories`, `catalog_*`, `runs`, `jobs`, `steps`, `policies`, `audit_events`, `usage_events`, `cli_sessions` — none present. ✅

RLS policies intentionally deferred to V2 auth/authorization task. ✅

## Migration Harness Review

| Requirement | File | Result |
|---|---|---|
| `Migration`, `MigrationRecord`, `MigrationStatus`, `DbClient` types | `types.ts` | ✅ |
| File discovery, deterministic sort by filename, SQL read | `loader.ts` | ✅ |
| Duplicate version detection (throws on duplicate version number) | `loader.ts` | ✅ |
| Monotonic version ordering validation | `loader.ts` | ✅ |
| SHA-256 stable checksums | `loader.ts` → `checksumSql()` | ✅ |
| `orun_schema_migrations` table creation (`CREATE TABLE IF NOT EXISTS`) | `harness.ts` | ✅ |
| Status/list: applied vs pending | `harness.ts` → `getMigrationStatus()` | ✅ |
| Pending-only migration application | `harness.ts` → `applyMigrations()` | ✅ |
| Checksum mismatch detection before applying new migrations | `harness.ts` | ✅ |
| Transaction-wrapped migration apply | `harness.ts` + `client.ts` | ✅ |
| Narrow `DbClient` interface for unit testing without live DB | `types.ts` + `FakeDbClient` in test | ✅ |
| `NodePgClient` wrapping `pg.Pool` — does not log connection string | `client.ts` | ✅ |
| `PooledConnection` inner client for `begin`/`commit`/`rollback` | `client.ts` | ✅ |
| CLI `migrate`/`status`/`check` via `tsx src/cli.ts` | `cli.ts` | ✅ |
| CLI requires `DATABASE_URL`, fails closed, does NOT print URL | `cli.ts` → `requireDatabaseUrl()` | ✅ |
| No fake store methods returning hardcoded data | All harness files | ✅ |

**Checksum mismatch behavior**: `applyMigrations` iterates all applied records and compares against current checksums _before_ applying any pending migrations. An error is thrown immediately on first mismatch. ✅

**Transaction wrapping**: Each pending migration's DDL and insert into `orun_schema_migrations` are wrapped in a single `client.transaction()` call. The `PooledConnection` uses explicit `BEGIN`/`COMMIT`/`ROLLBACK`. ✅

## Checks Run

| Command | Result |
|---|---|
| `pnpm --filter @orun/db typecheck` | ✅ PASS |
| `pnpm --filter @orun/db test` | ✅ PASS — 57 tests, 2 files (17 harness + 40 SQL content) |
| `pnpm --filter @orun/db build` | ✅ PASS |
| `pnpm typecheck` | ✅ PASS — 7 packages, FULL TURBO |
| `pnpm test` | ✅ PASS — all packages cached |
| `pnpm build` | ✅ PASS — all packages |
| `pnpm --filter @orun/db migrate:status` (no DATABASE_URL) | ✅ Fails closed with clear error message; URL not printed |
| `kiox -- orun plan --changed` | ✅ PASS — 7 components × 3 envs = 21 jobs |
| `kiox -- orun run --changed` | ✅ PASS — 21/21 jobs succeeded |

`orun run --changed` output: all 7 components (orun-coordinator, orun-db, orun-storage, orun-client, orun-types, orun-dashboard, orun-api-worker) passed in all 3 envs. No failures from `orun-db`.

## CI Logs Reviewed

CI run: `25564795515`

| Job | Result | Duration |
|---|---|---|
| `Orun Plan` | ✅ pass | 9s |
| `orun-db · dev · Verify turbo package` | ✅ pass | 34s |
| `orun-db · staging · Verify turbo package` | ✅ pass | 27s |
| `orun-db · production · Verify turbo package` | ✅ pass | 33s |

CI correctly identified `orun-db` as changed. Package validation (typecheck + test + build) ran in all 3 environments. No skipped meaningful checks.

## Database Smoke

**Not run.** Reason: Docker daemon is not running locally and no `psql` binary is available. `supabase status` also failed with Docker unavailable. No disposable Postgres/Supabase target was accessible in this environment.

Local harness tests (57) cover all migration harness behaviors (ordering, checksum stability, apply, skip-applied, mismatch detection, status) without a live database. The `FakeDbClient` faithfully intercepts `CREATE TABLE IF NOT EXISTS orun_schema_migrations`, `SELECT FROM orun_schema_migrations`, and `INSERT INTO orun_schema_migrations` to simulate database state.

Live smoke — confirming `orun_schema_migrations` contains `0001_core.sql` and the 8 core tables exist — is deferred to the Tactonic/Supabase provisioning task, which will run `pnpm --filter @orun/db migrate` against a live database.

## Issues

None. All acceptance criteria met.

## Risk Notes

1. **Live database smoke deferred**: SQL correctness (constraint enforcement, trigger behavior, `gen_random_uuid()` availability) is verified by SQL text tests and manual inspection against `spec/v2/01-data-model.md`, but not by execution. Tactonic provisioning task must run the migration against a real Postgres instance and confirm the 8 tables and `orun_schema_migrations` exist.
2. **`users.id` has no default**: correct by spec (Supabase Auth UUID must be caller-supplied), but any caller that omits `id` on insert will get a Postgres error. Future service code must enforce this at the application layer.
3. **`orun_set_updated_at()` function is `CREATE OR REPLACE`** — idempotent across re-runs of the migration, but if the function signature ever changes, dependent triggers should be re-created. Acceptable for current scope.
4. **No RLS policies**: explicitly deferred; tables are readable by any authenticated Postgres role until the V2 auth task adds row-level security. Supabase's default `auth.users` integration will require RLS or service-role access patterns before production tenant data is exposed.

## Spec Proposals

None. The task scope was fully covered by `spec/v2/01-data-model.md` for the bounded 8-table first migration.

## Recommended Next Move

**Task 0022**: Tactonic/Supabase provisioning component and CI plan workflow.

This task should:
- Provision a Supabase project and database (via Tactonic/Terraform)
- Wire `DATABASE_URL` into the orun-backend CI environment as a CI secret
- Run `pnpm --filter @orun/db migrate` as a CI step and confirm `orun_schema_migrations` and the 8 core tables exist
- Confirm RLS is deferred (or add a stub policy task if Supabase requires it for auth to function)
- Complete the live database smoke that was not possible in this verifier run
