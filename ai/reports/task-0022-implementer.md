# Task 0022 Implementer Report

## Summary

Task-0022 adds the earliest safe V2 database provisioning and smoke-test path:

- Terraform scaffold in `infra/supabase/` modeling the V2 `orun_supabase_database`
  contract using the generic `terraform` composition (the first-class
  `supabase-postgres` type is not yet in `stack-tectonic:0.12.0`).
- A PR-safe real Postgres migration smoke workflow (`.github/workflows/v2-db-smoke.yml`)
  that spins up a disposable Postgres container and runs `pnpm --filter @orun/db migrate`
  then `pnpm --filter @orun/db smoke` without requiring Supabase credentials.
- An on-demand plan-first provisioning workflow (`.github/workflows/v2-db-provision.yml`)
  using `SUPABASE_API_KEY`, with `apply` gated on explicit input and GitHub
  environment protections for staging/prod.
- A `smoke.ts` script in `packages/db/src/` that verifies `orun_schema_migrations`,
  `0001_core.sql`, all 8 core tables, `idx_projects_org`, and the
  `lifecycle_status` check constraint on `organizations`.

Live Supabase provisioning was **not applied**. Supabase account ID, region,
and environment targeting were not confirmed as part of this task. The
plan-first workflow is ready; apply requires operator confirmation of those
values and GitHub environment protection setup.

## Files Changed

| File | Action |
|---|---|
| `infra/supabase/versions.tf` | New — Terraform version constraint and provider |
| `infra/supabase/variables.tf` | New — V2 contract input variables |
| `infra/supabase/main.tf` | New — Supabase project resource and provider config |
| `infra/supabase/outputs.tf` | New — V2 contract outputs |
| `infra/supabase/component.yaml` | New — Tactonic component descriptor (generic terraform) |
| `infra/supabase/.gitignore` | New — Excludes Terraform state, plan files, tfvars |
| `infra/supabase/README.md` | New — Full provisioning documentation |
| `packages/db/src/smoke.ts` | New — Post-migration verification script |
| `packages/db/package.json` | Updated — Added `smoke` script |
| `packages/db/README.md` | Updated — Added CI smoke and smoke script docs |
| `.github/workflows/v2-db-smoke.yml` | New — PR-safe Postgres migration smoke CI |
| `.github/workflows/v2-db-provision.yml` | New — On-demand plan-first provisioning |
| `.gitignore` | Updated — Added Terraform state/plan patterns |
| `ai/proposals/task-0022-supabase-postgres-component.md` | New — Spec proposal |

## Tactonic/Terraform Discovery

Inspected `.orun/compositions.lock.yaml` for `stack-tectonic:0.12.0`. Exports:

```
cloudflare-pages, cloudflare-pages-terraform, cloudflare-pages-turbo,
cloudflare-pages-turbo-terraform, cloudflare-worker, cloudflare-worker-turbo,
helm-chart, helm-values, terraform, turbo-package, workspace
```

**No `supabase-postgres` composition type is available** in `stack-tectonic:0.12.0`.

Decision: use the generic `terraform` composition for the scaffold. The
`infra/supabase/component.yaml` describes the intended component shape and
notes the blocker. A spec proposal at
`ai/proposals/task-0022-supabase-postgres-component.md` records the two
forward paths (add `supabase-postgres` to stack-tectonic, or add `infra/` to
discovery roots with the generic composition).

The `infra/` directory is NOT in `intent.yaml` discovery roots (`apps/`,
`packages/`), so the scaffold is NOT run by `orun plan --changed`. The
provisioning workflow invokes Terraform directly.

## Provisioning Scaffold

Location: `infra/supabase/`

Implements the full V2 contract from `spec/v2/07-provisioning-and-operations.md`:

**Inputs** (all V2 spec inputs plus `supabase_organization_id` which is the
Supabase-internal org ID required by the provider resource):

- `environment`, `organization_slug`, `supabase_organization_id`,
  `project_name`, `region`, `database_password_secret_ref`,
  `supabase_api_key`, `enable_branching`, `allowed_cidr_blocks`, `tags`

`SUPABASE_API_KEY` is the canonical GitHub Actions secret. The workflow passes
it as `TF_VAR_supabase_api_key`; the provider maps it to `access_token`
internally. The public secret name never changes.

**Outputs** (all V2 spec outputs):

- `supabase_project_ref`, `supabase_project_url`, `supabase_jwks_url`,
  `postgres_host`, `postgres_port`, `postgres_database`,
  `postgres_user_secret_ref`, `postgres_password_secret_ref`,
  `database_url_secret_ref`, `hyperdrive_database_url_secret_ref`

Sensitive outputs are marked `sensitive = true` so Terraform redacts them in
plan/apply logs.

Remote state is documented in `versions.tf` (commented-out backend block) and
`infra/supabase/README.md`. Local state is excluded by `.gitignore`.

## CI And Smoke Workflow

### `.github/workflows/v2-db-smoke.yml`

- Triggers on PRs touching `packages/db/**`, `infra/supabase/**`, or the
  workflow file itself, and on `workflow_dispatch`.
- Uses a `postgres:16` service container (disposable — no Supabase credentials
  needed).
- Steps: `pnpm install`, `build`, `typecheck`, `test`, `migrate`, `migrate:status`,
  then `smoke`.
- `DATABASE_URL` is set in workflow env but never printed in any step.

### `.github/workflows/v2-db-provision.yml`

- Triggers on `workflow_dispatch` only.
- Inputs: `environment` (dev/preview/staging/prod), `mode` (plan/apply,
  default plan), optional `ref`.
- `check-secret` job fails closed if `SUPABASE_API_KEY` is not present.
- `plan` job always runs; uploads sanitized plan artifact (7-day retention).
- `apply` job runs only when `mode = apply` AND the plan found changes.
  For staging/prod, GitHub environment protection gates the apply job.
- Secrets, connection strings, and sensitive output values are never echoed
  in any step.

## Database Smoke Evidence

Live Supabase provisioning was **not run**. No Supabase account ID, project,
or `DATABASE_URL` was available in the implementer environment.

Local Postgres smoke was **not run** directly (Docker unavailable, same as
Task 0021). However:

1. The `v2-db-smoke.yml` CI workflow will run automatically on every PR
   touching `packages/db/**`, providing the disposable Postgres smoke.
2. The smoke script (`packages/db/src/smoke.ts`) compiles cleanly and all
   57 `@orun/db` unit tests pass.

To run locally when Docker/Postgres is available:

```bash
docker run -d --name orun-pg \
  -e POSTGRES_USER=orun \
  -e POSTGRES_PASSWORD=orun_smoke \
  -e POSTGRES_DB=orun_smoke \
  -p 5432:5432 postgres:16

DATABASE_URL="postgresql://orun:orun_smoke@localhost:5432/orun_smoke" \
  pnpm --filter @orun/db migrate

DATABASE_URL="postgresql://orun:orun_smoke@localhost:5432/orun_smoke" \
  pnpm --filter @orun/db smoke
```

## Checks Run

```
pnpm --filter @orun/db typecheck     PASS
pnpm --filter @orun/db test          PASS  (57 tests)
pnpm --filter @orun/db build         PASS
pnpm typecheck                       PASS  (7/7 tasks)
pnpm test                            PASS  (all 11 tasks)
pnpm build                           PASS  (7/7 tasks)
kiox -- orun plan --changed          PASS  (21 jobs planned)
kiox -- orun run --changed           orun-db: 3/3 PASS (dev/staging/production)
                                     Pre-existing failure: orun-dashboard·production
                                     requires CLOUDFLARE_ACCOUNT_ID — unrelated to
                                     this task, pre-existing in main.
```

## Live Supabase Provisioning

**Not applied.** Plan-only. Blocked by:

1. Supabase account ID (`supabase_organization_id`) not confirmed.
2. Region and environment targets not verified.
3. GitHub environment protections for staging/prod not yet configured.
4. `SUPABASE_API_KEY` and `CLOUDFLARE_API_TOKEN` secrets not available in
   the implementer environment.

The `.github/workflows/v2-db-provision.yml` workflow is ready for plan-first
testing once secrets and environment targets are confirmed. Production apply
additionally requires GitHub environment protection to be enabled on the
repository's `production` environment.

## Assumptions

- The `supabase/supabase` Terraform provider (v1.x) is available from the
  Terraform Registry and its `supabase_project` resource accepts
  `organization_id`, `name`, `region`, `database_password` inputs and
  exposes `id` as the project reference.
- `DATABASE_URL` is for migration jobs only. It is not set as a Worker runtime
  secret unless a later task explicitly adds that.
- Hyperdrive creation is modeled as an output reference; actual Hyperdrive
  wiring belongs to a later Worker integration task.

## Spec Proposals

`ai/proposals/task-0022-supabase-postgres-component.md` — proposes adding a
first-class `supabase-postgres` composition type to `stack-tectonic` (Option A)
or activating `infra/` as an Orun discovery root with the generic composition
(Option B). Non-blocking for this task.

## Remaining Gaps

- Live Supabase apply not run (see above).
- Remote state backend not configured (documented in `versions.tf` and README).
- `supabase_organization_id` not sourced — must be confirmed from the Supabase
  dashboard before first apply.
- GitHub environment protections for staging/prod not yet configured.
- Cloudflare Hyperdrive wiring deferred to a later Worker integration task.
- `DATABASE_URL` output not post-apply stored in a secrets manager — this
  step is documented but requires a concrete secrets backend choice.

## Next Task Dependencies

- Task 0023 (V2 API routes) can proceed immediately — the smoke CI will verify
  any schema changes against real Postgres on every PR.
- Supabase apply requires: confirmed `supabase_organization_id`, region,
  `SUPABASE_API_KEY` secret in GitHub Actions, and GitHub environment
  protection configured for staging/prod.

## PR Number

PR #40 — https://github.com/sourceplane/orun-backend/pull/40
