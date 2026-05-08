# @orun/db

V2 Supabase/Postgres database foundation for the Orun control plane.

## What's here

- `migrations/` — application DDL migrations for the V2 Postgres schema
- `src/` — migration harness, typed domain row types, ID helpers, CLI, and smoke script

## Migration harness

Run migrations against a live Postgres database (requires `DATABASE_URL`):

```bash
pnpm --filter @orun/db migrate          # apply pending
pnpm --filter @orun/db migrate:status   # list applied / pending
pnpm --filter @orun/db migrate:check    # verify checksums only
```

## DB Smoke

After running migrations, verify that all 8 core tables, the migration record,
and at least one expected index/constraint exist:

```bash
DATABASE_URL="postgres://..." pnpm --filter @orun/db smoke
```

The smoke script verifies:
- `orun_schema_migrations` contains `0001_core.sql`
- All 8 core tables exist: `users`, `user_identities`, `organizations`,
  `organization_members`, `organization_invites`, `billing_accounts`,
  `entitlements`, `projects`
- Index `idx_projects_org` exists
- `lifecycle_status` check constraint on `organizations` exists

`DATABASE_URL` is consumed but never printed by the script.

## CI Smoke

The `.github/workflows/v2-db-smoke.yml` workflow runs automatically on PRs that
change `packages/db/**`, `infra/supabase/**`, or the workflow file itself. It
spins up a disposable Postgres container, runs migrations, and executes the
smoke checks — no Supabase credentials required.

## Running tests (no live database required)

```bash
pnpm --filter @orun/db test
```

## Scope

This package owns V2 application DDL. Supabase project provisioning is handled
by Tactonic/Terraform in `infra/supabase/`. RLS policies are deferred to the V2
auth/authorization task.

V1 D1 migrations remain in `/migrations/` at the repo root and are unrelated.
