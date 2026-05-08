# Task ID

task-0021-verifier-v2-packages-db-migration-harness

# Agent

Verifier

# Current Repo Context

Task 0021 implementation is complete in `sourceplane/orun-backend` PR #39:

- PR: `https://github.com/sourceplane/orun-backend/pull/39`
- Title: `feat: task-0021 @orun/db — V2 Postgres migration harness and core schema`
- Branch: `feat/task-0021-v2-packages-db-migration-harness`
- Head commit: `2bb9bd1c8a91dee0eeb581deca522c0455183127`
- Base: `main`
- Current PR state when this prompt was written: open, clean merge state
- Current visible checks: `Orun Plan` pass and `orun-db` turbo package checks
  pass for dev, staging, and production

Task 0021 is the first V2 implementation task after the V1 Cloudflare/D1/Queue
foundation and CLI self-hosted bootstrap work. V2 specs are authoritative:
Supabase Postgres becomes the primary relational system of record for SaaS
control-plane data, while existing V1 D1/R2/Durable Object/Queue behavior must
remain compatible.

The implementer report says PR #39 creates `packages/db` as `@orun/db`, adds a
Postgres migration harness, adds `packages/db/migrations/0001_core.sql`, exports
typed domain boundaries, and changes no V1 Worker behavior.

The user explicitly asked the verifier to confirm that the DB package and V2
database foundation are actually created. Treat package/foundation existence,
schema completeness, and migration harness behavior as first-class acceptance
criteria, not incidental file checks.

# Objective

Verify PR #39 against `ai/tasks/task-0021.md`, the implementer report, V2 specs,
and real repo state. Confirm that the `@orun/db` package, migration harness, and
bounded core V2 Postgres schema foundation are present, correct, tested, and
safe to merge.

If PASS, merge PR #39, sync local `main`, and update compact AI context/reports
as needed. If FAIL, leave the PR open and write a clear blocker report.

# Read First

## Orchestration And Reports

- `/Users/irinelinson/sourceplane/orun-backend/ai/tasks/task-0021.md`
- `/Users/irinelinson/sourceplane/orun-backend/ai/reports/task-0021-implementer.md`
- `/Users/irinelinson/sourceplane/orun-backend/ai/context/current.md`
- `/Users/irinelinson/sourceplane/orun-backend/ai/context/task-ledger.md`
- `/Users/irinelinson/sourceplane/orun-backend/ai/context/decisions.md`
- `/Users/irinelinson/sourceplane/orun-backend/ai/context/open-risks.md`
- `/Users/irinelinson/sourceplane/orun-backend/ai/state.json`

## V2 Specs

- `/Users/irinelinson/sourceplane/orun-backend/spec/v2/README.md`
- `/Users/irinelinson/sourceplane/orun-backend/spec/v2/00-architecture.md`
- `/Users/irinelinson/sourceplane/orun-backend/spec/v2/01-data-model.md`
- `/Users/irinelinson/sourceplane/orun-backend/spec/v2/02-auth-and-authorization.md`
- `/Users/irinelinson/sourceplane/orun-backend/spec/v2/03-worker-api.md`
- `/Users/irinelinson/sourceplane/orun-backend/spec/v2/04-storage-and-ingestion.md`
- `/Users/irinelinson/sourceplane/orun-backend/spec/v2/06-migration-from-v1.md`
- `/Users/irinelinson/sourceplane/orun-backend/spec/v2/07-provisioning-and-operations.md`

## PR And Code

Use `gh` to inspect PR #39 metadata, diff, reviews, CI runs, and logs. In the
repo, inspect at minimum:

- `packages/db/package.json`
- `packages/db/component.yaml`
- `packages/db/README.md`
- `packages/db/migrations/0001_core.sql`
- `packages/db/src/cli.ts`
- `packages/db/src/client.ts`
- `packages/db/src/domain.ts`
- `packages/db/src/harness.ts`
- `packages/db/src/loader.ts`
- `packages/db/src/types.ts`
- `packages/db/src/harness.test.ts`
- `packages/db/src/migration-sql.test.ts`
- `packages/db/src/index.ts`
- `packages/db/tsconfig.json`
- `packages/db/vitest.config.ts`
- `pnpm-lock.yaml`

# Required Verification

## 1. Scope And Diff Review

Confirm PR #39 is bounded to Task 0021:

- It creates `packages/db` and related lockfile/package metadata only.
- It does not change V1 Worker handlers, V1 storage behavior, Cloudflare
  bindings, D1 migrations under `/migrations/`, dashboard runtime behavior, or
  `sourceplane/orun`.
- It does not add `/v2` routes, Supabase JWT verification, Hyperdrive bindings,
  Terraform/Tactonic provisioning, or live Supabase resources.
- It does not activate `DB_CATALOG_0`/`DB_CATALOG_1`.
- It does not commit generated `dist/`, `.turbo`, `node_modules`, secrets, or
  local environment files. Ignored generated files may exist locally; verify
  they are not tracked with `git ls-files packages/db`.

## 2. DB Package Foundation Exists

Explicitly verify the foundation requested by the user:

- `packages/db` exists and is included by the root workspace pattern
  `packages/*`.
- `packages/db/package.json` names the package `@orun/db`, exposes a sensible
  module entrypoint, and has `build`, `typecheck`, `test`, and `lint` scripts.
- `packages/db/component.yaml` follows repo `turbo-package` conventions and
  identifies the component as `orun-db`.
- `packages/db/README.md` explains migration usage, `DATABASE_URL`, scope, and
  that V1 D1 migrations remain separate.
- `packages/db/src/index.ts` exports the harness, loader, client, ID helpers,
  and domain types expected by follow-up V2 tasks.

PASS requires the package to be real and buildable, not just a directory with a
placeholder migration.

## 3. Core Schema Migration Review

Inspect `packages/db/migrations/0001_core.sql` against
`spec/v2/01-data-model.md`.

Confirm it creates only the bounded Task 0021 first-core tables:

- `users`
- `user_identities`
- `organizations`
- `organization_members`
- `organization_invites`
- `billing_accounts`
- `entitlements`
- `projects`

Confirm the schema includes:

- idempotent UUID support appropriate for Supabase/Postgres
- `users.id` compatible with Supabase Auth user UUIDs
- `organization_id` on tenant-owned tables
- no project-owned table missing `project_id` where project ownership exists
  in this bounded migration
- role/status/lifecycle/provisioning check constraints
- unique organization slug
- unique `(organization_id, slug)` for projects
- unique provider identity constraints
- tenant-scoped indexes beginning with `organization_id`
- invite email lookup index on `lower(email)`
- timestamps and soft-delete fields where the V2 spec requires them
- no checked-in secrets, database URLs, API keys, tokens, or private keys

Also confirm it does **not** add deferred tables outside Task 0021 scope:
GitHub installations, repositories, catalog tables, runs/jobs/steps, policies,
audit events, usage events, or CLI sessions.

If the migration adds triggers/functions such as an `updated_at` helper, verify
they are generic, idempotent, and covered by tests or direct SQL inspection.

## 4. Migration Harness Review

Inspect `packages/db/src/harness.ts`, `loader.ts`, `client.ts`, `cli.ts`, and
tests. Confirm the harness provides:

- migration metadata and record types
- deterministic migration filename parsing and ordering
- duplicate migration identity detection
- stable SHA-256 checksums
- `orun_schema_migrations` table creation
- status/list behavior for applied vs pending migrations
- pending-only migration application
- checksum mismatch detection before applying new migrations
- transaction-wrapped migration application where appropriate
- a narrow database client abstraction that lets unit tests run without live
  Supabase/Postgres
- `NodePgClient` or equivalent live Postgres adapter that does not print
  connection strings
- CLI commands that require `DATABASE_URL`, fail closed when absent, and do not
  echo the URL

Be alert for fake behavior: store/service methods must not pretend to query a
database while returning hardcoded data. Interfaces and types are fine.

## 5. Local Checks

From `/Users/irinelinson/sourceplane/orun-backend`, run:

```bash
pnpm --filter @orun/db typecheck
pnpm --filter @orun/db test
pnpm --filter @orun/db build
pnpm typecheck
pnpm test
pnpm build
```

Also run one no-credentials CLI safety check. For example:

```bash
pnpm --filter @orun/db migrate:status
```

With no `DATABASE_URL`, this should fail clearly and must not print a database
URL or secret. Treat this expected non-zero result as a safety check, not a
failing test.

If available, run local Orun validation:

```bash
/Users/irinelinson/.local/bin/kiox -- orun plan --changed
/Users/irinelinson/.local/bin/kiox -- orun run --changed
```

If `orun run --changed` reaches unrelated Cloudflare deploy credentials and
fails for missing `CLOUDFLARE_ACCOUNT_ID`, record that as a residual/pre-existing
local validation gap. It should not fail Task 0021 unless `orun-db` itself
fails.

## 6. Actual Database Smoke

The user asked to verify the DB/foundation, so attempt a real migration smoke
when safely possible:

- Prefer a disposable local Postgres database, a local Supabase database, or a
  clearly disposable Supabase/Postgres URL.
- Do not use production or shared customer databases.
- Do not print `DATABASE_URL`.
- Run the package migration command against the disposable database.
- Confirm `orun_schema_migrations` contains `0001_core.sql`.
- Confirm the eight expected core tables exist.
- Confirm at least one constraint or index from the migration exists.
- Drop or destroy disposable resources afterward if you created them.

If no disposable Postgres/Supabase target is available, do not fake it. Record
the blocker and rely on local harness/unit/SQL checks for PASS if all other
criteria are met.

# CI Verification

Use `gh` to inspect PR #39 CI status and logs, including successful jobs. Confirm
what actually ran. At minimum verify:

- `Orun Plan` completed successfully and planned the expected changed component.
- `orun-db · dev · Verify turbo package` completed successfully.
- `orun-db · staging · Verify turbo package` completed successfully.
- `orun-db · production · Verify turbo package` completed successfully.
- CI did not skip meaningful package validation due to an empty plan.

If CI was rerun after this prompt was written, verify the latest run, not the
status embedded above.

# Acceptance Criteria

PASS only if:

- `packages/db` exists as a real workspace package named `@orun/db`.
- The DB foundation is present: package metadata, component metadata, migration
  harness, first migration, exports, docs, and tests.
- `0001_core.sql` matches the bounded V2 core schema for Task 0021.
- The migration harness handles ordering, checksum, status, apply, and mismatch
  behavior correctly.
- Local package and workspace checks pass.
- PR CI logs are inspected and acceptable.
- No generated artifacts, secrets, database URLs, or runtime credentials are
  tracked.
- V1 Worker/API behavior is untouched.
- Any missing live/local database smoke is explicitly recorded with the reason.
- PR #39 is merged and local `main` is fast-forwarded after PASS.

FAIL if:

- `packages/db` is incomplete or only superficially scaffolded.
- The core migration omits required Task 0021 tables or tenant constraints.
- The migration adds out-of-scope product tables or behavior.
- The harness cannot safely detect checksum mismatches or duplicate migrations.
- Default tests require live credentials.
- The CLI prints or persists database URLs/secrets.
- V1 Worker behavior, D1 migrations, `/v2` routes, Supabase auth, Hyperdrive, or
  provisioning are modified in this PR.
- Local checks or meaningful CI checks fail.

# When Done Report

Write:

`/Users/irinelinson/sourceplane/orun-backend/ai/reports/task-0021-verifier.md`

Use this structure:

```markdown
# Task 0021 Verifier Report

## Result
PASS or FAIL

## Summary
## PR Reviewed
## DB Foundation Verification
## Schema Review
## Migration Harness Review
## Checks Run
## CI Logs Reviewed
## Database Smoke
## Issues
## Risk Notes
## Spec Proposals
## Recommended Next Move
```

If PASS, merge PR #39, sync local `main`, update compact AI context and
`ai/state.json`, and recommend Task 0022: Tactonic/Supabase provisioning
component plus CI plan workflow, unless new verification findings suggest a
different next move.
