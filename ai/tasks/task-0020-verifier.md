# Task ID

task-0020-verifier-cli-bootstrap-queue-provisioning

# Agent

Verifier

# Current Repo Context

Task 0020 implementation is complete in `sourceplane/orun` PR #87:

- PR: `https://github.com/sourceplane/orun/pull/87`
- Title: `feat: task-0020 CLI bootstrap queue provisioning and embedded bundle refresh`
- Branch: `task-0020-cli-bootstrap-queue-provisioning`
- Head commit: `07a3c2190513e242f808ba5d13f6b359f0c55b9c`
- Base: `main`
- Current PR state when this prompt was written: open, clean merge state
- Current visible checks: `Orun Plan` pass, `Harness dry-run guard` pass, matrix jobs skipped by workflow rules

Task 0020 was selected before the V2 Postgres migration work because the
self-hosted CLI bootstrap path lagged the live Cloudflare production backend:
it lacked queue/DLQ provisioning, queue consumer attachment, cron configuration,
and migration `0006_tenant_routes.sql` in the embedded backend bundle.

The implementer report says PR #87 now:

- embeds backend migration `0006_tenant_routes.sql`
- adds Cloudflare Queue, consumer, schedule, and queue binding support
- includes plain-text Worker vars in the single multipart Worker upload to avoid
  the Task 0015 binding-clobber risk
- extends `orun backend init/status/destroy` with queue/DLQ/consumer/cron
- updates docs and fake-server tests
- did not run live Cloudflare smoke because credentials were unavailable

The next implementation task after this verifier passes should move into the
V2 backlog, starting with the `packages/db` Postgres migration harness. Do not
advance to that work until PR #87 is either verified/merged or explicitly
deferred by the user.

# Objective

Verify `sourceplane/orun` PR #87 against `ai/tasks/task-0020.md`, the Task 0020
implementer report, current code reality, and the relevant V2 provisioning
contracts. If it passes, merge PR #87 and sync local `sourceplane/orun` main. If
it fails, leave the PR open with clear blockers.

# Read First

## Orchestration And Reports

- `/Users/irinelinson/sourceplane/orun-backend/ai/tasks/task-0020.md`
- `/Users/irinelinson/sourceplane/orun-backend/ai/reports/task-0020-implementer.md`
- `/Users/irinelinson/sourceplane/orun-backend/ai/context/current.md`
- `/Users/irinelinson/sourceplane/orun-backend/ai/context/task-ledger.md`
- `/Users/irinelinson/sourceplane/orun-backend/ai/context/decisions.md`
- `/Users/irinelinson/sourceplane/orun-backend/ai/context/open-risks.md`
- `/Users/irinelinson/sourceplane/orun-backend/ai/state.json`

## V2 Specs

- `/Users/irinelinson/sourceplane/orun-backend/spec/v2/README.md`
- `/Users/irinelinson/sourceplane/orun-backend/spec/v2/00-architecture.md`
- `/Users/irinelinson/sourceplane/orun-backend/spec/v2/06-migration-from-v1.md`
- `/Users/irinelinson/sourceplane/orun-backend/spec/v2/07-provisioning-and-operations.md`

## V1 Reference Only

- `/Users/irinelinson/sourceplane/orun-backend/spec/04-worker-api.md`
- `/Users/irinelinson/sourceplane/orun-backend/spec/07-storage.md`
- `/Users/irinelinson/sourceplane/orun-backend/spec/12-catalog-index.md`
- `/Users/irinelinson/sourceplane/orun-backend/ai/proposals/task-0016-spec-update.md`

## PR And Code

Use `gh` to inspect PR #87 metadata, diff, reviews, CI runs, and logs. In
`/Users/irinelinson/sourceplane/orun`, inspect at minimum:

- `cmd/orun/command_backend.go`
- `cmd/orun/command_backend_test.go`
- `internal/backendbundle/bundle.go`
- `internal/backendbundle/bundle_test.go`
- `internal/backendbundle/embed/manifest.json`
- `internal/backendbundle/embed/migrations/`
- `internal/cliauth/types.go`
- `internal/cloudflare/client.go`
- `internal/cloudflare/client_test.go`
- `website/docs/cli/orun-backend.md`

# Required Verification

## 1. Scope And Diff Review

- Confirm PR #87 only touches the Task 0020 scope:
  self-hosted backend bootstrap, embedded backend artifacts, Cloudflare client
  support, docs, and tests.
- Confirm it does not activate `DB_CATALOG_0` or `DB_CATALOG_1` and does not
  attempt to resolve multi-shard D1 before
  `/Users/irinelinson/sourceplane/orun-backend/ai/proposals/task-0016-spec-update.md`.
- Confirm it does not introduce Hyperdrive/Postgres, Supabase, or V2 runtime API
  behavior. Those belong to the next V2 tasks.
- Confirm no secrets, tokens, database URLs, or live credentials are printed,
  persisted, or added to fixtures.

## 2. Task 0020 Acceptance Criteria

Validate every acceptance criterion in
`/Users/irinelinson/sourceplane/orun-backend/ai/tasks/task-0020.md`, including:

- embedded backend bundle includes all current backend migrations through
  `0006_tenant_routes.sql`
- dry-run output and JSON report 6+ migrations, queue, DLQ, consumer, and cron
  without requiring credentials
- Cloudflare fake-server tests prove queue create/reuse/delete, consumer
  attach/settings, schedule update/clear, queue binding upload metadata, and no
  binding clobbering
- non-dry-run init is idempotent by construction
- status checks queue, DLQ, consumer settings, cron, migrations, Worker, D1, R2,
  and secret names
- destroy/dry-run covers managed queue, DLQ, consumer, and cron cleanup
- docs and CLI help reflect the new resources and flags

## 3. Cloudflare API Shape Review

Verify implementation shapes against official Cloudflare docs or live API
behavior where available:

- queue create/list/delete
- queue consumer create/list/delete with DLQ and settings
- Worker schedule list/update/clear
- multipart Worker upload metadata for Durable Object, D1, R2, queue, and
  plain-text variable bindings

Pay special attention to the Task 0015 residual risk: `SetWorkerVars` PATCH
behavior was live-unverified. PR #87 should avoid binding clobbering by
including vars in the single Worker upload metadata path used by `backend init`.
If any caller still uses `SetWorkerVars`, confirm it is outside the Task 0020
critical path or safely tested.

## 4. Local Checks

From `/Users/irinelinson/sourceplane/orun`, run:

```bash
go test ./...
go test -race ./internal/cloudflare/... ./internal/backendbundle/... ./internal/cliauth/... ./cmd/orun/...
go vet ./...
```

Run dry-run smokes:

```bash
go run ./cmd/orun backend init --dry-run
go run ./cmd/orun backend init --dry-run --json
go run ./cmd/orun backend destroy --dry-run
go run ./cmd/orun backend destroy --dry-run --json
```

Inspect the output for resource coverage and secret hygiene.

## 5. PR CI And Logs

Use `gh` to inspect PR #87 checks and logs, including successful jobs, not just
the summarized check status. Confirm what actually ran. At minimum verify:

- `Orun Plan` completed successfully and ran the expected planning command
- `Harness dry-run guard` completed successfully
- skipped jobs are skipped for expected workflow reasons, not hidden failures

If CI was rerun or updated after this prompt was written, verify the latest run,
not the run IDs embedded in prior reports.

## 6. Disposable Cloudflare Live Smoke

If Cloudflare credentials and account targeting are available, run a disposable
live smoke using unique non-production names and an isolated `HOME`. Do not use
production names.

The smoke should prove:

- Worker exists
- D1 exists and has all bundled migrations
- R2 bucket exists
- catalog queue and DLQ exist
- queue has the intended Worker consumer
- consumer settings match Task 0018 defaults
- Worker metadata has the queue producer binding
- cron schedule is present
- basic unauthenticated endpoint checks return typed JSON responses

Destroy the disposable resources afterward and verify cleanup.

If credentials are unavailable, expired, scoped incorrectly, or pointed at an
unclear account, do not fake live evidence. Record the blocker and decide
whether local fake-server/API-shape coverage is sufficient for PASS. Missing
live smoke is a residual risk; it is not a license to skip code and contract
review.

## 7. Optional Fresh Local Remote-State Smoke

If a fresh interactive auth session is feasible, run a local remote-state smoke
with an isolated `HOME` to help close the Task 0012 yellow bookkeeping risk.
This is useful but not required for PR #87 PASS unless the Task 0020 changes
break auth or remote state behavior.

# Constraints

- Do not merge PR #87 with unresolved P0/P1/P2 verification blockers.
- Do not make broad product changes while verifying.
- If you add a small verifier-only fix to PR #87, keep it strictly scoped,
  commit it on the PR branch, push, and wait for CI again.
- Do not edit production Cloudflare WAF policy in this task.
- Do not activate multi-shard D1 catalog bindings.
- Do not create V2 Supabase/Postgres resources in this verifier task.
- Do not print, persist, or paste secrets into reports.

# Acceptance Criteria

PASS only if:

- PR #87 satisfies Task 0020 acceptance criteria or any deviation is clearly
  non-blocking and documented
- local Go checks and dry-run smokes pass
- CI logs were inspected and are acceptable
- Cloudflare API shapes are correct by docs, tests, or live evidence
- secret handling and binding metadata are safe
- docs match implemented behavior
- any missing live smoke or fresh auth smoke is recorded as residual risk
- PR #87 is merged and local `/Users/irinelinson/sourceplane/orun` main is
  fast-forwarded after merge

FAIL if:

- Cloudflare API request/response shapes are likely wrong
- Worker upload metadata can clobber required bindings
- init/status/destroy can delete or mutate production resources without explicit
  metadata or confirmation
- migration 0006 is missing or bundle freshness tests are weak
- queue/DLQ/consumer/cron status or destroy behavior is absent
- local checks or relevant CI fail
- the PR expands beyond Task 0020 scope in a risky way

# When Done Report

Write:

`/Users/irinelinson/sourceplane/orun-backend/ai/reports/task-0020-verifier.md`

Use this structure:

```markdown
# Task 0020 Verifier Report

## Result
PASS or FAIL

## Summary
## PR Reviewed
## Checks Run
## CI Logs Reviewed
## Cloudflare API Shape Review
## Live Cloudflare Smoke
## Fresh Local Remote-State Smoke
## Issues
## Risk Notes
## Spec Proposals
## Recommended Next Move
```

If PASS, merge PR #87, sync local `sourceplane/orun` main, and recommend Task
0021: create `packages/db` and the first V2 Supabase/Postgres migration
harness. If FAIL, leave PR #87 open and make the recommended next move a focused
remediation task.
