# Task ID

Task 0016 - Verifier

# Agent

Verifier

# Current Repo Context

Task 0016 implementation is in PR #35:

- PR: https://github.com/sourceplane/orun-backend/pull/35
- Title: `feat: task-0016 storage router, catalog shards, and queue-backed ingestion`
- Branch: `task-0016-storage-router`
- Base: `main` at `17f4bc700c94b441a659956b10ac362d23042063`
- Head: `ca23985373d26090b19ee68fdf5df85d7dca2194`
- CI run observed by orchestrator: `25537266699`
- CI status observed by orchestrator: all listed checks green, but verify logs
  yourself before merging.

The implementer report is `ai/reports/task-0016-implementer.md`.

The implementer also wrote `ai/proposals/task-0016-spec-update.md` for a known
cross-shard JOIN limitation. That proposal is not automatically accepted. You
must decide whether the limitation is an acceptable deferred risk or a blocker
against the Task 0016 acceptance criteria.

The local worktree may contain uncommitted orchestrator/spec/context edits that
are not part of PR #35. Do not revert unrelated local changes. Verify the PR
scope with:

```bash
git diff --name-status origin/main...HEAD
```

and separately note any dirty worktree state in your report.

# Objective

Verify PR #35 against Task 0016. Confirm whether it truly introduces a safe
storage router seam, bounded catalog shard routing, and queue-backed catalog
ingestion while preserving the existing single-D1 fallback.

If it passes, merge PR #35 and sync local `main`. If it fails, leave the PR open
with precise blockers.

# Read First

- `ai/tasks/task-0016.md`
- `ai/reports/task-0016-implementer.md`
- `ai/proposals/task-0016-spec-update.md`
- `ai/context/current.md`
- `ai/context/task-ledger.md`
- `ai/context/decisions.md`
- `ai/context/open-risks.md`
- `ai/state.json`
- `spec/00-constitution.md`
- `spec/03-types-package.md`
- `spec/04-worker-api.md`
- `spec/07-storage.md`
- `spec/12-catalog-index.md`
- PR #35 diff and CI logs

# Required Verification

1. Inspect PR scope and report consistency.
   - Confirm the files changed in PR #35 match the implementer report.
   - Confirm `ai/reports/task-0016-implementer.md` names the correct PR number.
   - Confirm no unrelated product/UI/auth behavior was changed.

2. Validate storage router behavior.
   - Inspect `packages/storage/src/router.ts` and tests.
   - Confirm deterministic shard routing and single-`DB` fallback.
   - Confirm feature handlers do not choose shard bindings directly.
   - Confirm route lookup via `tenant_routes` is either implemented or honestly
     documented as deferred without making current behavior misleading.

3. Validate catalog sync behavior.
   - OIDC-only write policy remains intact.
   - Envelope shape, size, repo claim matching, schema version, and component
     path validation still happen before R2 writes, queue sends, or normalization.
   - Raw envelopes go to R2.
   - `catalog_uploads` idempotency is durable before returning `202`.
   - Duplicate `uploadId` remains idempotent and does not enqueue duplicate work.
   - Queue messages contain only route metadata and R2 refs, never full envelopes,
     component states, plans, logs, JWTs, or tokens.
   - Fallback path still schedules normalization with `ctx.waitUntil` when no
     queue binding exists.

4. Validate catalog read behavior.
   - Dashboard/session reads still exclude local namespaces.
   - Reads query only shards corresponding to visible namespaces.
   - Multi-shard reads do not scan every configured shard.
   - Pagination/ordering behavior is acceptable and clearly documented if
     approximate.

5. Treat the cross-shard JOIN proposal as a serious acceptance risk.
   - Existing `D1Index` catalog queries join `catalog_*` tables to `namespaces`.
   - In a true core/shard split, namespaces live in core while catalog rows live
     in catalog shards unless the implementation duplicates/denormalizes the
     needed namespace data.
   - Add or run a focused test with separate core and catalog D1 mocks/tables if
     the current tests do not prove this.
   - If configured shard mode cannot successfully list/read catalog rows for a
     linked canonical repo namespace, mark FAIL or require remediation.
   - If you accept the proposal as non-blocking, explain why that does not
     contradict Task 0016's bounded shard-support requirement.

6. Validate migrations and deployment shape.
   - Inspect `migrations/0006_tenant_routes.sql`.
   - Confirm migration tests cover it.
   - Confirm no Worker config binding change is required for current single-D1
     deployment.
   - If delivery wiring changed, run local kiox/orun checks and verify CI logs
     show the expected commands.

7. Validate CI and local checks.
   - Run local checks:

```bash
pnpm exec turbo run typecheck
pnpm exec turbo run test
pnpm exec turbo run build
```

   - Run targeted tests if needed:

```bash
pnpm --filter @orun/storage test
pnpm --filter @orun/worker test
```

   - Inspect GitHub Actions logs for PR #35, including successful jobs, not just
     status summaries.
   - Confirm CI run `25537266699` or the latest replacement run actually ran the
     expected Orun/tectonic plan and verify jobs.

# Acceptance Criteria

- PR #35 satisfies every acceptance criterion in `ai/tasks/task-0016.md`.
- The single-D1 fallback is behavior-compatible with current catalog sync/read
  flows.
- Optional queue mode enqueues R2-reference-only messages and does not perform
  inline component normalization.
- Optional shard mode either works for catalog reads or the PR is failed with a
  concrete remediation request.
- The cross-shard JOIN proposal is handled explicitly in the verifier report.
- All local quality gates pass.
- PR CI logs are inspected and acceptable.
- No unresolved security, persistence, namespace isolation, or deployment
  blockers remain.

# Merge Protocol

If PASS:

1. If you add a verifier report or tiny verifier-only fix, commit it to the PR
   branch and push.
2. Wait for CI to go green again if you pushed anything.
3. Merge PR #35.
4. Checkout `main`.
5. Fast-forward pull from `origin/main`.
6. Update compact AI context/state if the merge itself does not already include
   that update.

If FAIL:

1. Leave PR #35 open.
2. Write exact blockers with file/line references where possible.
3. Do not merge.

# When Done Report

Write `ai/reports/task-0016-verifier.md` with:

- `Result: PASS|FAIL`
- `Checks`
- `Issues`
- `Risk Notes`
- `Spec Proposals`
- `Recommended Next Move`
- `PR Number`
