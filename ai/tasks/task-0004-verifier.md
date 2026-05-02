# Task 0004 Verification

# Agent
Verifier

# Current Repo Context
Task 0004 implemented the `@orun/storage` package.

GitHub PR to verify:

- PR: #8
- URL: `https://github.com/sourceplane/orun-backend/pull/8`
- Title: `feat: implement storage package`
- Branch: `codex/task-0004-storage`
- Base: `main`
- State at prompt creation: open draft
- Mergeability at prompt creation: `MERGEABLE`
- Head SHA at prompt creation: `bc0ab3457e46df97b1a966a0e23652e06c7f3076`
- Surface CI at prompt creation: green
- Workflow run to inspect: `25241213120`

Changed files in PR #8 at prompt creation:

- `packages/storage/src/r2.ts`
- `packages/storage/src/d1.ts`
- `packages/storage/src/index.ts`
- `packages/storage/src/r2.test.ts`
- `packages/storage/src/d1.test.ts`
- `packages/storage/tsconfig.json`
- `packages/coordinator/tsconfig.json`
- `migrations/0001_init.sql`
- `migrations/0002_namespaces_account.sql`
- `ai/reports/task-0004-implementer.md`

Important local state:

- The current checkout may already be on `codex/task-0004-storage`.
- `ai/tasks/task-0004.md` exists locally but is not in PR #8 at prompt creation. If verification passes, include it in the PR so task history is complete.
- Older untracked files may exist from previous cycles, such as `ai/tasks/task-0002-verifier.md` and `ai/tasks/task-0003-verifier.md`. Do not include those in this PR unless you intentionally decide to backfill prior task history.
- Do not destructively reset local branches.

# Objective
Verify Task 0004 end to end against the task prompt, specs, implementation report, PR diff, local quality gates, local kiox/orun behavior, and PR CI logs.

If PASS, write the verifier report, update state for Task 0005, include the missing Task 0004 prompt file if present, push the report/state to PR #8, wait for CI, inspect logs, mark the PR ready if still draft, merge it, and sync local `main` safely.

If FAIL, do not merge. Write a verifier report with concrete blockers and leave clear PR feedback.

# Read First
Read these before running checks:

1. `ai/tasks/task-0004.md`
2. `ai/reports/task-0004-implementer.md`
3. `ai/reports/task-0003-verifier.md`
4. `agents/orchestrator.md`
5. `SCHEDULE.md`
6. `spec/00-constitution.md`
7. `spec/03-types-package.md`
8. `spec/07-storage.md`
9. `spec/08-account-repo-linking.md` schema/account table sections
10. `spec/04-worker-api.md` D1/R2/log sections
11. `packages/storage/src/r2.ts`
12. `packages/storage/src/d1.ts`
13. `packages/storage/src/r2.test.ts`
14. `packages/storage/src/d1.test.ts`
15. `migrations/0001_init.sql`
16. `migrations/0002_namespaces_account.sql`

Inspect PR #8 metadata and diff:

```bash
gh pr view 8 --repo sourceplane/orun-backend --json number,title,url,state,isDraft,headRefName,baseRefName,mergeable,body,commits,files,reviews,statusCheckRollup
gh pr diff 8 --repo sourceplane/orun-backend --stat
gh pr diff 8 --repo sourceplane/orun-backend --name-only
```

# Required Verification Work
Verify every Task 0004 acceptance criterion:

1. `R2Storage` implements all required methods.
2. `D1Index` implements all required methods.
3. `migrations/0001_init.sql` and `migrations/0002_namespaces_account.sql` exist and match the intended schema.
4. All storage operations are namespace-isolated.
5. D1 writes use prepared statements and bound parameters.
6. R2 path utilities come from `@orun/types/paths`.
7. R2 and D1 tests cover required cases.
8. Existing `@orun/types` and `@orun/coordinator` tests still pass.
9. Worker dry-run build still succeeds.
10. No Worker/auth/account/rate-limit/coordinator behavior was introduced, except the allowed coordinator tsconfig test-exclude hygiene.
11. Local kiox/orun validation is attempted and documented.
12. PR CI logs prove meaningful validation ran.

# Local Commands To Run
Start from the PR branch:

```bash
git fetch origin main codex/task-0004-storage
git switch codex/task-0004-storage
git status --short --branch
```

Run local quality gates:

```bash
pnpm install
pnpm exec turbo run typecheck
pnpm exec turbo run build
pnpm exec turbo run test
pnpm exec turbo run lint
pnpm --filter @orun/storage test
pnpm --filter @orun/types test
pnpm --filter @orun/coordinator test
cd apps/worker && pnpm exec wrangler deploy --dry-run && cd ../..
```

Run focused inspection checks:

```bash
rg -n "\\bany\\b" packages/storage/src
rg -n "RunCoordinator|COORDINATOR|auth|OAuth|OIDC|rateLimit|account|repo" packages/storage/src
find packages/storage/dist -maxdepth 3 -type f | sort
find packages/coordinator/dist -maxdepth 3 -type f | sort
```

After `pnpm exec turbo run build`, confirm `packages/storage/dist` and `packages/coordinator/dist` do not emit `*.test.js` files.

Run local kiox/orun validation:

```bash
/Users/irinelinson/.local/bin/kiox -- orun plan --changed
/Users/irinelinson/.local/bin/kiox -- orun run --changed
```

If local kiox reports `0 components` or `0 jobs`, do not accept that blindly. Determine whether changed detection is expected locally because of branch/base state, and rely on CI logs to prove PR validation ran for `orun-storage`. If CI also reports `0 jobs`, treat that as a blocker or require a workflow/config fix.

# CI Log Verification
Do not trust green checks by status alone. Inspect logs.

```bash
gh pr checks 8 --repo sourceplane/orun-backend --watch
gh run view 25241213120 --repo sourceplane/orun-backend --json databaseId,status,conclusion,headBranch,headSha,jobs
gh run view 25241213120 --repo sourceplane/orun-backend --log
```

Confirm in logs:

- `sourceplane/kiox-action@v2.1.2` initialized the workspace.
- The PR run used head SHA `bc0ab3457e46df97b1a966a0e23652e06c7f3076`, or a newer pushed verifier SHA if you add commits.
- `kiox -- orun plan --changed` ran in the Review Plan job.
- `kiox -- orun run --changed` ran in the Build & Deploy job.
- The changed component set includes `orun-storage` or otherwise proves storage package validation executed.
- Typecheck/build for `@orun/storage` ran.
- If tests are not run by the `turbo-package` component type, note that clearly as known CI limitation and rely on local test output.
- No live Cloudflare production deploy occurred unexpectedly.
- No warnings invalidate the result.

# Code Review Focus
Review the actual implementation, not just tests.

## R2Storage

- Uses `runLogPath` and `planPath` from `@orun/types/paths`.
- `writeLog` writes to the exact log path and returns it.
- `writeLog` accepts both string and `ReadableStream`.
- `writeLog` sets `Content-Type: text/plain; charset=utf-8`.
- `writeLog` sets `customMetadata["expires-at"]` when provided and formats `Date` values as ISO strings.
- `readLog` fetches only the exact namespace/run/job log key and returns `null` when missing.
- `savePlan` writes JSON to the exact plan path with JSON content type.
- `getPlan` returns `null` when missing and parses stored JSON into a `Plan`.
- `listRunLogs` lists only `${namespaceId}/runs/${runId}/logs/`, handles pagination, and does not cross namespace/run boundaries.
- `deleteRun` deletes only `${namespaceId}/runs/${runId}/`, handles pagination, and does not delete plan snapshots or other runs/namespaces unless intentionally documented.
- The R2 mock is faithful enough to catch accidental prefix mistakes. Watch for tests that assert only calls but do not prove deletion effects.

## D1 Migrations

- `0001_init.sql` exactly matches namespaces/runs/jobs schema and indexes from `spec/07-storage.md`.
- `0002_namespaces_account.sql` exactly matches accounts/account_repos schema and index from `spec/07-storage.md`.
- Migrations are additive and immutable.
- Account tables are only schema, not account API logic.

## D1Index

- `upsertNamespace` upserts by immutable `namespace_id` and updates mutable slug/last_seen_at.
- `createRun` upserts namespace first, then inserts/upserts run row under `(namespace_id, run_id)`.
- `updateRun` only updates allowed fields and does not build SQL from untrusted field names.
- `listRuns([])` returns `[]`.
- `listRuns(namespaceIds)` filters by namespace IDs using bound params, orders by `created_at DESC`, and handles limit/offset sanely.
- `getRun` filters by both `namespace_id` and `run_id`.
- `upsertJob` is keyed by `(namespace_id, run_id, job_id)`.
- `listJobs` filters by both namespace and run.
- `listJobs` returns derived-index placeholder fields `deps: []`, `lastError: null`, `heartbeatAt: null` and documents that lossiness.
- `deleteExpiredRuns` deletes expired runs and their jobs, leaves non-expired runs/jobs intact, and does not delete namespaces/accounts/account_repos.

Important risk to probe:

`deleteExpiredRuns` currently appears to delete jobs with:

```sql
DELETE FROM jobs WHERE namespace_id IN (
  SELECT namespace_id FROM runs WHERE expires_at <= ?1
) AND run_id IN (
  SELECT run_id FROM runs WHERE expires_at <= ?1
)
```

This can over-delete when an expired run in namespace A has the same `run_id` as a non-expired run in namespace B, because namespace and run IDs are matched independently rather than as a `(namespace_id, run_id)` pair. Add or run a focused test for this scenario. Treat confirmed over-deletion as a blocker because it violates namespace isolation and GC correctness.

## Tests

- R2 tests should prove behavior, not just that methods were called.
- D1 tests use a deterministic fake rather than `@cloudflare/vitest-pool-workers`; verify this fake is strong enough for namespace isolation and parameter binding claims.
- If the fake mirrors the implementation bug-for-bug, require either a stronger test or a small implementation fix.
- Migration tests should inspect enough SQL to catch missing tables/indexes, not just filenames.
- Confirm no `any` in storage source/tests unless a generated or unavoidable type hole is documented.

## Package Hygiene

- `packages/storage/tsconfig.json` excludes `src/**/*.test.ts`.
- `packages/coordinator/tsconfig.json` test-exclude hygiene is present and does not alter coordinator behavior.
- `packages/storage/src/index.ts` exports `R2Storage`, `D1Index`, and `IndexedJobInput`.
- Root imports from `@orun/storage` continue to work.

# Pass / Fail Rules
PASS only if:

- R2Storage and D1Index behavior matches the task and spec.
- Migrations match the intended schema.
- Local quality gates pass.
- Local storage tests are meaningful and cover namespace isolation.
- CI logs prove `orun-storage` validation actually ran.
- No out-of-scope behavior was added.
- The `deleteExpiredRuns` cross-namespace same-run-id scenario is safe or fixed.
- Any verifier report/state update and missing task prompt file are committed to PR #8, CI reruns green, and logs are inspected again.

FAIL if:

- Any required storage method is missing or materially wrong.
- Any storage operation crosses namespace boundaries.
- `deleteExpiredRuns` can delete jobs for non-expired runs.
- D1 query construction is unsafe or field names are not constrained.
- R2 operations use hardcoded divergent path formats instead of shared utilities.
- CI is green but did not run storage package validation.
- Tests are too weak to support the namespace-isolation claims.
- Worker/auth/account/rate-limit/coordinator logic was implemented outside scope.

# When Done Report
Write:

```text
ai/reports/task-0004-verifier.md
```

Use this structure:

```markdown
# Task 0004 Verifier Report

## Result
PASS|FAIL

## Checks

## CI Logs Reviewed

## Code Review Notes

## Issues

## Risk Notes

## Recommended Next Move
```

Include exact commands run and pass/fail status. Include workflow run IDs and relevant log conclusions.

# If PASS
Complete this sequence:

1. Update `ai/state.json`:
   - `current_task`: `5`
   - `completed`: `[1, 2, 3, 4]`
   - `repo_health`: `"green"`
   - `next_focus`: `"task-0005-auth"`
   - add notes that Task 0004 verified PASS and whether any storage risks remain.
2. Commit:
   - `ai/reports/task-0004-verifier.md`
   - `ai/state.json`
   - `ai/tasks/task-0004.md` if present and still untracked
   - any small verifier-approved fix needed for PASS
3. Do not include unrelated untracked older verifier prompts unless explicitly backfilling them.
4. Push the PR branch.
5. Wait for CI on the new head SHA.
6. Inspect the new CI logs.
7. Mark PR #8 ready for review if still draft.
8. Merge PR #8.
9. Checkout/sync local `main` to the merged remote state. If local `main` is divergent, do not destroy local-only commits without explicit approval; use a fresh branch/worktree if needed for the next task.

# If FAIL
Do not merge.

Write the verifier report with `Result: FAIL`, then leave a PR comment or review with:

- Blocking issue(s)
- Exact failing command(s), file(s), SQL, or CI log lines
- Minimal required fix
- Whether Task 0005 can proceed in parallel or should wait
