# Task 0021 Implementer Report

## Summary

Created `packages/db` as `@orun/db` — the V2 Postgres migration foundation for
the Orun control plane. The package includes a production-leaning migration
harness, the first bounded core schema migration (`0001_core.sql`), typed domain
row types for all tables, ID/slug helpers, and a small CLI for running
migrations. 57 tests pass locally. All workspace checks pass. No V1 Worker
behavior was changed.

## Files Changed

### New files

```
packages/db/package.json
packages/db/tsconfig.json
packages/db/vitest.config.ts
packages/db/component.yaml
packages/db/README.md
packages/db/migrations/0001_core.sql
packages/db/src/types.ts
packages/db/src/loader.ts
packages/db/src/harness.ts
packages/db/src/client.ts
packages/db/src/ids.ts
packages/db/src/domain.ts
packages/db/src/index.ts
packages/db/src/cli.ts
packages/db/src/harness.test.ts
packages/db/src/migration-sql.test.ts
```

### Modified

```
pnpm-lock.yaml  (added pg@8.x, @types/pg@8.x, tsx@4.x)
```

No other packages modified. No V1 Worker routes changed.

## Schema Implemented

`0001_core.sql` creates 8 tables as specified in `spec/v2/01-data-model.md`:

| Table | PK | org_id | Notes |
|---|---|---|---|
| `users` | uuid (caller-supplied, matches Supabase Auth) | — | |
| `user_identities` | uuid gen_random_uuid() | — | unique (provider, provider_user_id) |
| `organizations` | uuid gen_random_uuid() | — | unique slug, lifecycle check |
| `organization_members` | (org_id, user_id) composite | ✓ | role/status check constraints |
| `organization_invites` | uuid gen_random_uuid() | ✓ | token_hash unique, lower(email) index |
| `billing_accounts` | uuid gen_random_uuid() | ✓ unique | provider/plan/status checks |
| `entitlements` | (org_id, key) composite | ✓ | |
| `projects` | uuid gen_random_uuid() | ✓ | unique (org_id, slug), lifecycle check |

Also includes:
- `create extension if not exists "pgcrypto"` (idempotent)
- Generic `orun_set_updated_at()` trigger function applied to all 8 tables
- Indexes: `idx_projects_org`, `idx_org_members_org`, `idx_org_invites_org`, `idx_org_invites_email`

Tables not included (deferred to later migrations per task constraint):
`github_installations`, `repositories`, `catalog_*`, `runs`, `jobs`, `steps`,
`policies`, `audit_events`, `usage_events`, `cli_sessions`.

RLS policies deferred to V2 auth/authorization task.

**0001_core.sql checksum:** `8d57c566770765e607302be89d176293ec96fe29b1fb78fac64c85e1bb072bfb`

## Migration Harness

**`src/types.ts`** — `Migration`, `MigrationRecord`, `MigrationStatus`, `DbClient` interface.

**`src/loader.ts`** — `loadMigrations(dir)` reads SQL files, sorts by version, validates uniqueness and monotonicity, computes SHA-256 checksums.

**`src/harness.ts`** — `applyMigrations(client, migrations)` creates the `orun_schema_migrations` table if needed, verifies checksums of already-applied migrations, applies pending migrations in order (each in a transaction), records version/name/filename/checksum. `getMigrationStatus` returns per-migration applied/pending status.

**`src/client.ts`** — `NodePgClient` wraps `pg.Pool`. Exposes `query()` and `transaction()` implementing `DbClient`. CLI uses this; tests use a `FakeDbClient`.

**`src/cli.ts`** — `migrate`, `status`, `check` commands. Reads `DATABASE_URL` from env; fails closed with a clear message if absent (does not print the URL).

Scripts:
```bash
pnpm --filter @orun/db migrate
pnpm --filter @orun/db migrate:status
pnpm --filter @orun/db migrate:check
```

## Checks Run

| Command | Result |
|---|---|
| `pnpm --filter @orun/db typecheck` | PASS |
| `pnpm --filter @orun/db test` | PASS — 57 tests, 2 test files |
| `pnpm --filter @orun/db build` | PASS |
| `pnpm typecheck` | PASS — 7 packages |
| `pnpm test` | PASS — 57 new + 420 existing = all pass |
| `pnpm build` | PASS — 7 packages |
| `kiox -- orun plan --changed` | PASS — 7 components × 3 envs = 21 jobs planned |
| `kiox -- orun run --changed` | PARTIAL — `orun-db` ✓ (3/3 envs). `orun-api-worker·production` ✗ missing `CLOUDFLARE_ACCOUNT_ID` locally. Pre-existing issue, not caused by this task. |

## Live Supabase/Postgres Smoke

**Not run.** No live Supabase project is available in this local environment.
Local harness tests cover all migration harness behaviors without a live
database. The `NodePgClient` is exercised only via the real `pg` import; actual
SQL execution against Postgres is deferred to the Tactonic provisioning task.

## Assumptions

1. `gen_random_uuid()` requires `pgcrypto` extension — added idempotently.
   Supabase enables this by default; the extension call is a no-op there.
2. `users.id` has no `default gen_random_uuid()` because it must match the
   Supabase Auth UUID supplied by the caller.
3. `tx` abbreviation used for transaction client variable inside harness
   callbacks — no naming conflict.
4. The `orun_schema_migrations` table schema is owned by the harness, not by
   any numbered migration file — consistent with the pattern used by common
   migration tools.

## Spec Proposals

None. The task scope was fully covered by `spec/v2/01-data-model.md` for the
bounded 8-table first migration.

## Remaining Gaps

- Live Postgres smoke not run (no credentials; see above).
- RLS policies deferred to V2 auth task.
- `0002_core.sql` onward (repositories, catalog, runs, policies, audit, usage,
  cli_sessions) are not in scope for this task.
- `orun-api-worker·production` deploy local validation requires `CLOUDFLARE_ACCOUNT_ID` — pre-existing gap.

## Next Task Dependencies

The next likely tasks (per task-0021 integration notes):
1. **Tactonic/Supabase provisioning** — provisions the Supabase project and
   database, then runs `pnpm --filter @orun/db migrate` against the live URL.
2. **Supabase JWT verification** — can import domain types from `@orun/db`.
3. **`/v2/me` endpoint** — imports `UserRow`, `OrganizationMemberRow` from
   `@orun/db`.

## PR Number

See PR opened after this report.
