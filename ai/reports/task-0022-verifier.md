# Task 0022 Verifier Report

## Verdict

**PASS** — two fixes applied by verifier before merge.

## Summary

PR #40 (`task-0022-v2-db-provisioning`) implements the earliest safe V2 database
provisioning and smoke path. The verifier confirmed spec/task alignment, scope
boundedness, and secret hygiene, then identified and fixed two issues before
merging:

1. **Smoke query bug**: `smoke.ts` used `information_schema.constraint_table_usage`
   to look up the `lifecycle_status` check constraint on `organizations`. This view
   only covers FK/PK/unique constraints in PostgreSQL, so the query always returned
   0 rows and the smoke always failed. Fixed by switching to
   `information_schema.table_constraints` joined with `check_constraints`.

2. **Apply path present**: `v2-db-provision.yml` had an `apply` job that could run
   `terraform apply` against `infra/supabase/main.tf`, which defines
   `resource "supabase_project" "main"` — a resource that would create a new
   Supabase project. This violates the Task 0022 requirement that no workflow or
   Terraform path may create, replace, or destroy the manually created Supabase
   database or Hyperdrive config. The entire `apply` job was removed. Apply is
   blocked until a future adoption task explicitly imports the manual resources into
   Terraform state and re-enables apply with confirmed ownership.

After the two fixes were committed and pushed, all CI checks passed:

- **Postgres Migration Smoke** (V2 DB Smoke): SUCCESS (run 25606407028, job 75168971364)
- **Orun Plan**: SUCCESS
- **orun-db · dev / staging / production · Verify turbo package**: SUCCESS

PR #40 merged as squash commit `e784ba197adb0161cdc4910f1746c6997e55f35e` on
2026-05-09.

## Spec And Task Alignment

**PASS.**

- `spec/v2/07-provisioning-and-operations.md` documents the Supabase database and
  Hyperdrive config as manually bootstrapped external resources. It explicitly states
  that Task 0022 tasks must skip database and Hyperdrive creation and that Terraform
  may only plan, document, or import/adopt existing resources.
- `ai/tasks/task-0022.md` was revised on 2026-05-09 with the manual-bootstrap update.
  It names only the non-secret Hyperdrive identifiers (`oruncloud-db`,
  `d8cada8abda7451aaa1e2ce189dc8a17`, binding `HYPERDRIVE`) and explicitly requires
  skipping DB and Hyperdrive creation.
- Neither file contains the database connection string, database password, plaintext
  provider tokens, Terraform state, or plan output.
- Both files preserve the long-term direction: `packages/db` owns application DDL;
  Terraform/Tactonic may later own platform resources after explicit import/adoption.
- `SUPABASE_API_KEY` is the canonical secret name throughout both files.

## Scope And Diff Review

**PASS.**

PR #40 is bounded to Task 0022 deliverables:

- Added: `infra/supabase/` (Terraform scaffold), `.github/workflows/v2-db-smoke.yml`,
  `.github/workflows/v2-db-provision.yml` (plan-only after verifier fix),
  `packages/db/src/smoke.ts`, `packages/db/package.json` (smoke script),
  `packages/db/README.md` (updated), `infra/supabase/README.md`, `.gitignore`
  (Terraform patterns), `ai/proposals/task-0022-supabase-postgres-component.md`.
- No `/v2` API routes, Supabase JWT verification, dashboard onboarding, organization
  APIs, or Worker runtime Hyperdrive/Postgres wiring were added.
- No existing V1 D1 migrations under `/migrations/` were altered.
- No multi-shard D1 bindings activated.
- No generated `dist/`, `.turbo`, `node_modules`, Terraform state, `.terraform/`,
  `*.tfplan`, `.env`, database URLs, passwords, API keys, JWTs, private keys, or
  local secrets committed.

## No-Create Safety Review

**PASS** (after verifier fix).

Before fix: `v2-db-provision.yml` had an explicit `apply` job that could run
`terraform apply` against `infra/supabase/main.tf`, creating a new
`supabase_project.main` resource. Even though `mode: plan` was the default and the
`apply` job required explicit `mode: apply` input, the path was reachable and
therefore violated the Task 0022 no-create requirement.

After fix: the `apply` job is removed entirely. The workflow now only exposes a
`plan` job. The workflow comment clearly states apply is blocked until a future
adoption task. No default or manual workflow path can create, replace, or destroy
the Supabase database or Hyperdrive config.

Additional safety checks:

- `infra/supabase/main.tf` defines `lifecycle { prevent_destroy = true }` on the
  Supabase project resource, protecting against accidental destruction even if apply
  is later re-enabled.
- No Cloudflare Hyperdrive resource is defined anywhere in the scaffold.
- `SUPABASE_API_KEY` is the only Supabase management secret referenced; no
  `SUPABASE_ACCESS_TOKEN` alias introduced.
- Plan output sanitizes `access_token`, `database_password` via grep filter.
- `infra/supabase/.gitignore` and root `.gitignore` exclude Terraform state, plan
  files, and `.tfvars` files.

## Disposable Postgres Smoke

**PASS** (after verifier fix).

`v2-db-smoke.yml` triggers on PRs touching `packages/db/**`, `infra/supabase/**`,
or the workflow itself, and on `workflow_dispatch`.

The workflow:
- Starts a `postgres:16` service container (no Supabase credentials required).
- Sets `DATABASE_URL` as env (masked in logs, never echoed via step command).
- Runs: `pnpm --filter @orun/db build`, `typecheck`, `test`, `migrate`,
  `migrate:status`, `smoke`.

`smoke.ts` verifies:
- `orun_schema_migrations` contains `0001_core.sql` with checksum.
- All 8 core tables exist (`users`, `user_identities`, `organizations`,
  `organization_members`, `organization_invites`, `billing_accounts`,
  `entitlements`, `projects`).
- `idx_projects_org` index exists.
- `lifecycle_status` check constraint on `organizations` exists (fixed from
  `constraint_table_usage` to `table_constraints`).

CI run 25606407028 (run on head commit `8608d88`) confirmed all smoke checks PASS.
`DATABASE_URL` was masked as `***localhost:5432/orun_smoke` in logs — never printed.

Local typecheck/test/build all pass:
- `pnpm --filter @orun/db typecheck`: PASS
- `pnpm --filter @orun/db test`: PASS (57 tests)
- `pnpm --filter @orun/db build`: PASS
- `pnpm typecheck`: PASS (7/7 tasks)
- `pnpm test`: PASS (11/11 tasks)
- `pnpm build`: PASS (7/7 tasks)
- `kiox -- orun plan --changed`: PASS (21 jobs planned)

## Manual Supabase Database Verification

**BLOCKER (expected, documented).**

No secret-sourced `DATABASE_URL` for the manually created Supabase database was
available in the verifier environment. Live migration smoke against the manually
created database was not run. Per the verifier prompt, this is the expected and
acceptable state: the disposable Postgres smoke proves the harness; live manual-DB
verification remains a future step once `DATABASE_URL` is provided to CI.

No replacement database was created to compensate.

## Manual Hyperdrive Verification

**BLOCKER (expected, documented).**

Cloudflare credentials (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`) were not
available in the verifier environment. The following commands were not run:

```bash
wrangler hyperdrive list
wrangler hyperdrive get d8cada8abda7451aaa1e2ce189dc8a17
```

The known non-secret Hyperdrive identifiers are recorded in the spec and task:
config name `oruncloud-db`, config id `d8cada8abda7451aaa1e2ce189dc8a17`, Worker
binding `HYPERDRIVE`. No replacement config was created.

## Local Checks

| Check | Result |
|---|---|
| `pnpm --filter @orun/db typecheck` | PASS |
| `pnpm --filter @orun/db test` | PASS (57 tests) |
| `pnpm --filter @orun/db build` | PASS |
| `pnpm typecheck` | PASS (7/7 tasks) |
| `pnpm test` | PASS (11/11 tasks) |
| `pnpm build` | PASS (7/7 tasks) |
| `kiox -- orun plan --changed` | PASS (21 jobs) |
| `kiox -- orun run --changed` | orun-db: 3/3 PASS; orun-dashboard·production pre-existing CLOUDFLARE_ACCOUNT_ID failure (unrelated) |

## GitHub CI And Logs

CI run 25606407028 (V2 DB Smoke) and 25606407043 (CI) on head commit `8608d88`:

| Check | Result |
|---|---|
| Postgres Migration Smoke | SUCCESS |
| Orun Plan | SUCCESS |
| orun-db · dev · Verify turbo package | SUCCESS |
| orun-db · staging · Verify turbo package | SUCCESS |
| orun-db · production · Verify turbo package | SUCCESS |

No CI log printed `DATABASE_URL` values (masked as `***localhost:5432/orun_smoke`).
No passwords, API keys, JWTs, or provider tokens appeared in logs.

PR mergeStateStatus was `CLEAN` with `mergeable: MERGEABLE` before merge.

## Secret Hygiene

**PASS.**

- No database connection strings, passwords, API keys, JWTs, or provider tokens
  committed to tracked files.
- `DATABASE_URL` in `v2-db-smoke.yml` uses a disposable local value
  (`postgresql://orun:orun_smoke@localhost:5432/orun_smoke`) — a non-production
  smoke credential that is intentional and acceptable.
- `infra/supabase/README.md` uses `<password>` and `<project-ref>` as obvious
  placeholders in example commands.
- Root `.gitignore` and `infra/supabase/.gitignore` exclude Terraform state, plan
  files, and `.tfvars`.
- Sensitive Terraform outputs marked `sensitive = true` (redacted in plan/apply
  logs).

## Fixes Applied By Verifier

### Fix 1: `packages/db/src/smoke.ts` — check constraint query

`information_schema.constraint_table_usage` is a PostgreSQL view that only covers
foreign key, primary key, and unique constraints. It does not include check
constraints. The smoke query always returned 0 rows, causing the
`lifecycle_status` check on `organizations` to always report FAIL.

Fixed by using `information_schema.table_constraints` joined with
`information_schema.check_constraints`, which correctly returns check constraints
defined on any table.

### Fix 2: `.github/workflows/v2-db-provision.yml` — remove apply job

The `apply` job was removed entirely. The workflow is now plan-only. A comment at
the bottom explains that apply is blocked for Task 0022 because the Supabase
database and Hyperdrive config were manually created; a future adoption task must
explicitly import those resources into Terraform state and re-enable apply.

Also cleaned up a minor bug in the `plan` step: the `-var="supabase_api_key=..."`
flag was referencing `$TF_VAR_SUPABASE_API_KEY` (unset shell variable) instead of
using the already-set `TF_VAR_supabase_api_key` env var. The redundant `-var` flag
was removed; the provider receives the key via the standard `TF_VAR_*` mechanism.

## Residual Risks

- Live manual Supabase database smoke not run (no `DATABASE_URL` available).
  Future tasks with DB access should run `pnpm --filter @orun/db migrate` and
  `pnpm --filter @orun/db smoke` against the shared database.
- Cloudflare Hyperdrive config not live-inspected (no credentials available).
- Remote Terraform state not configured; must be set up before any shared apply.
- `supabase_organization_id` not sourced — must be confirmed before first apply.
- GitHub environment protections for staging/prod not yet configured.
- Node.js 20 deprecation annotation in CI (affects `actions/checkout@v4` etc.);
  non-blocking until September 2026, but should be updated proactively.
- `orun-dashboard·production` pre-existing `CLOUDFLARE_ACCOUNT_ID` failure in
  `kiox -- orun run --changed` is unrelated to Task 0022.

## Merge

PR #40 merged as squash commit `e784ba197adb0161cdc4910f1746c6997e55f35e`
on 2026-05-09 at 16:48:57 UTC. Local `main` fast-forwarded to `e784ba1`.

## Next Task Recommendation

**Task 0023 — V2 API routes** can proceed immediately. Every PR touching
`packages/db/**` or `infra/supabase/**` will now run the disposable Postgres
smoke automatically, proving schema changes against real Postgres before merge.

Before any shared Supabase `apply` or future Worker Hyperdrive wiring task:
1. Confirm `SUPABASE_API_KEY` is set in GitHub Actions.
2. Source `supabase_organization_id` from the Supabase dashboard.
3. Configure GitHub environment protections for `staging` and `prod`.
4. Design and run a Terraform import task to adopt the manually created resources.
