# @orun/db

V2 Supabase/Postgres database foundation for the Orun control plane.

## What's here

- `migrations/` — application DDL migrations for the V2 Postgres schema
- `src/` — migration harness, typed domain row types, ID helpers, and CLI

## Migration harness

Run migrations against a live Postgres database (requires `DATABASE_URL`):

```bash
pnpm --filter @orun/db migrate          # apply pending
pnpm --filter @orun/db migrate:status   # list applied / pending
pnpm --filter @orun/db migrate:check    # verify checksums only
```

Tests run without a live database:

```bash
pnpm --filter @orun/db test
```

## Scope

This package owns V2 application DDL. Supabase project provisioning is handled
by Tactonic/Terraform in a separate task. RLS policies are deferred to the V2
auth/authorization task.

V1 D1 migrations remain in `/migrations/` at the repo root and are unrelated.
