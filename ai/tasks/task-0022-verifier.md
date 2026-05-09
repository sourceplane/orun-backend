# Task ID

task-0022-verifier-v2-manual-db-adoption-and-smoke

# Agent

Verifier

# Current Repo Context

Task 0022 implementation is complete in `sourceplane/orun-backend` PR #40:

- PR: `https://github.com/sourceplane/orun-backend/pull/40`
- Title: `feat: task-0022 V2 database provisioning scaffold and Postgres migration smoke`
- Branch: `task-0022-v2-db-provisioning`
- Base: `main`

The task requirements changed after implementation. The user manually created
the shared Supabase database and Cloudflare Hyperdrive config, so Task 0022 must
now skip database and Hyperdrive creation and verify/adopt the existing
resources instead.

Known manual resource details:

- Hyperdrive config name: `oruncloud-db`
- Worker binding name: `HYPERDRIVE`
- Hyperdrive config id: `d8cada8abda7451aaa1e2ce189dc8a17`

Do not repeat, print, commit, or store the database connection string or
database password. If live database verification needs a URL, use a
secret-sourced `DATABASE_URL` only.

At prompt creation, PR #40 had an unstable merge/check status and the `V2 DB
Smoke` / `Postgres Migration Smoke` check was failing. Re-check current PR and
CI state rather than assuming that status is still current.

# Objective

Verify PR #40 against the updated Task 0022 prompt, the updated V2 provisioning
spec, the implementer report, and real repo/CI/cloud state.

PASS requires confirming that:

- the spec and task no longer require creating the Supabase database or
  Hyperdrive config for this phase
- no default workflow, Terraform config, or command path can create, replace, or
  destroy the manually created Supabase database or Hyperdrive config
- the disposable Postgres migration smoke is real and green
- the manually created database and Hyperdrive config are verified when
  credentials are available
- no secret or database URL is committed or printed

If PASS, merge PR #40, sync local `main`, and update compact AI context/reports.
If FAIL, leave the PR open and write a clear blocker report.

# Read First

## Orchestration And Reports

- `/Users/irinelinson/sourceplane/orun-backend/ai/tasks/task-0022.md`
- `/Users/irinelinson/sourceplane/orun-backend/ai/reports/task-0022-implementer.md`
- `/Users/irinelinson/sourceplane/orun-backend/ai/context/current.md`
- `/Users/irinelinson/sourceplane/orun-backend/ai/context/task-ledger.md`
- `/Users/irinelinson/sourceplane/orun-backend/ai/context/decisions.md`
- `/Users/irinelinson/sourceplane/orun-backend/ai/context/open-risks.md`
- `/Users/irinelinson/sourceplane/orun-backend/ai/state.json`

## V2 Specs

- `/Users/irinelinson/sourceplane/orun-backend/spec/v2/README.md`
- `/Users/irinelinson/sourceplane/orun-backend/spec/v2/00-architecture.md`
- `/Users/irinelinson/sourceplane/orun-backend/spec/v2/01-data-model.md`
- `/Users/irinelinson/sourceplane/orun-backend/spec/v2/04-storage-and-ingestion.md`
- `/Users/irinelinson/sourceplane/orun-backend/spec/v2/06-migration-from-v1.md`
- `/Users/irinelinson/sourceplane/orun-backend/spec/v2/07-provisioning-and-operations.md`

## PR And Code

Use `gh` to inspect PR #40 metadata, diff, reviews, CI runs, and logs. In the
repo, inspect at minimum:

- `.github/workflows/v2-db-smoke.yml`
- `.github/workflows/v2-db-provision.yml`
- `infra/supabase/README.md`
- `infra/supabase/component.yaml`
- `infra/supabase/main.tf`
- `infra/supabase/variables.tf`
- `infra/supabase/outputs.tf`
- `infra/supabase/versions.tf`
- `packages/db/package.json`
- `packages/db/README.md`
- `packages/db/src/smoke.ts`
- `.gitignore`
- `ai/proposals/task-0022-supabase-postgres-component.md`

# Required Verification

## 1. Updated Spec And Task Alignment

Confirm the source-of-truth docs were updated for the manual bootstrap:

- `spec/v2/07-provisioning-and-operations.md` says Task 0022 skips Supabase
  database/project creation and Hyperdrive creation for now.
- `ai/tasks/task-0022.md` says the same and records only non-secret manual
  resource identifiers.
- Neither file contains the database connection string, database password,
  plaintext provider tokens, Terraform state, or plan output.
- The docs still preserve the long-term direction: `packages/db` owns
  application DDL, while Terraform/Tactonic may later own platform resources
  after explicit import/adoption.

## 2. Scope And Diff Review

Confirm PR #40 is bounded to Task 0022:

- It adds or revises DB smoke, Supabase/Tactonic/Terraform adoption scaffold,
  docs, and package scripts only.
- It does not add `/v2` API routes, Supabase JWT verification, dashboard
  onboarding, organization APIs, or Worker runtime Hyperdrive/Postgres wiring.
- It does not alter existing V1 D1 migrations under `/migrations/`.
- It does not activate multi-shard D1 bindings.
- It does not change existing V1 Worker/D1/R2/Durable Object/Queue behavior.
- It does not commit generated `dist/`, `.turbo`, `node_modules`, Terraform
  state, `.terraform/`, `*.tfplan`, `.env`, database URLs, passwords, API keys,
  JWTs, private keys, or local secrets.

Run a secret hygiene scan without printing matches. Search for generic URL and
secret patterns and summarize only whether tracked files are clean. If a match
is found, inspect carefully and redact any sensitive value in the report.

## 3. No Database Or Hyperdrive Creation By Default

Inspect Terraform and workflow behavior very carefully.

PASS requires:

- no default workflow path creates, replaces, or destroys a Supabase
  project/database
- no default workflow path creates, replaces, or destroys a Cloudflare
  Hyperdrive config
- any Terraform resource that would create a Supabase project/database is
  disabled, future-only, import/adoption-only, or unreachable from default
  workflow inputs
- any `apply` mode is removed, blocked, or limited to explicit future adoption
  behavior with no resource creation/replacement for the manual bootstrap
- plan output is sanitized and must not expose connection strings or sensitive
  outputs
- `SUPABASE_API_KEY` remains the canonical Supabase management secret name

FAIL if `.github/workflows/v2-db-provision.yml` can still run `terraform apply`
against a resource definition that creates a new Supabase project/database or
Hyperdrive config as part of Task 0022.

## 4. Disposable Postgres Migration Smoke

Confirm the PR-safe smoke is real, not a placeholder:

- `v2-db-smoke.yml` runs on PRs touching `packages/db/**`, `infra/supabase/**`,
  or the smoke workflow itself.
- It starts a disposable Postgres service/container and does not require
  Supabase credentials.
- It runs `pnpm --filter @orun/db migrate`.
- It runs a verification step/script that checks `orun_schema_migrations`,
  `0001_core.sql`, all 8 core tables, and at least one expected index or
  constraint.
- It never prints `DATABASE_URL`.

Run or verify from CI:

```bash
pnpm --filter @orun/db typecheck
pnpm --filter @orun/db test
pnpm --filter @orun/db build
```

If Docker/Postgres is available locally, also run the migration smoke locally
against a disposable database. If not available, PR CI must prove the smoke.

## 5. Manual Supabase Database Verification

When a secret-sourced `DATABASE_URL` for the manually created database is
available, run:

```bash
pnpm --filter @orun/db migrate
pnpm --filter @orun/db smoke
```

Requirements:

- do not echo or print `DATABASE_URL`
- confirm `orun_schema_migrations` exists
- confirm `0001_core.sql` is recorded with a checksum
- confirm all 8 core tables exist:
  - `users`
  - `user_identities`
  - `organizations`
  - `organization_members`
  - `organization_invites`
  - `billing_accounts`
  - `entitlements`
  - `projects`
- confirm at least one expected index exists, such as `idx_projects_org`
- confirm at least one expected constraint exists, such as a lifecycle/status
  check

If `DATABASE_URL` is unavailable, do not create a new database to compensate.
Record this as a live manual-DB verification blocker. Disposable Postgres smoke
can prove the harness, but it does not prove the manually created database.

## 6. Manual Hyperdrive Verification

When Cloudflare credentials are available, verify the existing Hyperdrive config
without printing the underlying connection string:

```bash
wrangler hyperdrive list
wrangler hyperdrive get d8cada8abda7451aaa1e2ce189dc8a17
```

Confirm:

- config id is `d8cada8abda7451aaa1e2ce189dc8a17`
- config name is `oruncloud-db`
- Worker binding name expected by docs/spec/task is `HYPERDRIVE`
- no workflow attempts to create a replacement Hyperdrive config for Task 0022

If Cloudflare credentials are unavailable, record the blocker and do not create
a replacement config.

## 7. Local Repo Checks

From `/Users/irinelinson/sourceplane/orun-backend`, run:

```bash
pnpm --filter @orun/db typecheck
pnpm --filter @orun/db test
pnpm --filter @orun/db build
pnpm typecheck
pnpm test
pnpm build
/Users/irinelinson/.local/bin/kiox -- orun plan --changed
/Users/irinelinson/.local/bin/kiox -- orun run --changed
```

If `kiox -- orun run --changed` reaches unrelated Cloudflare deploy credentials
and fails for missing `CLOUDFLARE_ACCOUNT_ID`, classify whether the failure is
pre-existing and outside `orun-db`/Task 0022. It should not fail Task 0022 if
the DB package/workflow checks and PR CI pass.

## 8. GitHub PR And CI Verification

Use `gh` to inspect:

- PR #40 diff against `main`
- latest checks and check logs
- latest workflow runs for `V2 DB Smoke`, `Orun Plan`, and any package
  validation jobs

PASS requires:

- `V2 DB Smoke` / `Postgres Migration Smoke` is green on the PR head
- Orun planning/package checks are green or any unrelated failure is clearly
  pre-existing and not caused by Task 0022
- no CI log prints database URLs, passwords, API keys, JWTs, or provider tokens
- PR branch is mergeable or can be updated cleanly

# PASS / FAIL Guidance

PASS only if:

- updated spec/task skip DB and Hyperdrive creation for this phase
- no default workflow/Terraform path can create, replace, or destroy the manual
  Supabase database or Hyperdrive config
- disposable Postgres migration smoke passes locally or in PR CI
- manual database migration smoke passes when `DATABASE_URL` is available, or
  the verifier records a clear missing-secret blocker
- Hyperdrive config is inspected when Cloudflare credentials are available, or
  the verifier records a clear missing-credential blocker
- no secrets or database URLs are tracked or printed
- V1 behavior remains untouched
- required local and CI checks are green or unrelated gaps are clearly
  classified

FAIL if:

- Task 0022 still requires DB/Hyperdrive creation
- a workflow can still apply resource creation/replacement for the manual DB or
  Hyperdrive config
- the PR-safe Postgres smoke is failing or fake
- a secret, password, connection string, Terraform state, or plan file is
  committed or exposed in logs
- the implementation changes V1 runtime behavior or wires Worker Hyperdrive
  early
- PR #40 CI remains red for Task 0022-owned jobs

# When Done Report

Write:

`/Users/irinelinson/sourceplane/orun-backend/ai/reports/task-0022-verifier.md`

Use this structure:

```markdown
# Task 0022 Verifier Report

## Verdict
## Summary
## Spec And Task Alignment
## Scope And Diff Review
## No-Create Safety Review
## Disposable Postgres Smoke
## Manual Supabase Database Verification
## Manual Hyperdrive Verification
## Local Checks
## GitHub CI And Logs
## Secret Hygiene
## Fixes Applied By Verifier
## Residual Risks
## Merge
## Next Task Recommendation
```

If PASS and merged, update:

- `/Users/irinelinson/sourceplane/orun-backend/ai/context/current.md`
- `/Users/irinelinson/sourceplane/orun-backend/ai/context/task-ledger.md`
- `/Users/irinelinson/sourceplane/orun-backend/ai/context/open-risks.md` if any
  residual risk changes
- `/Users/irinelinson/sourceplane/orun-backend/ai/state.json`

Then sync local `main` to the merge commit.
