# Task 0003 Verification

# Agent
Verifier

# Current Repo Context
Task 0003 implemented `packages/coordinator` as the real `RunCoordinator` Durable Object.

GitHub PR to verify:

- PR: #7
- URL: `https://github.com/sourceplane/orun-backend/pull/7`
- Title: `feat: implement run coordinator durable object`
- Branch: `codex/task-0003-coordinator`
- Base: `main`
- State at prompt creation: open draft
- Mergeability at prompt creation: `MERGEABLE`
- Head SHA at prompt creation: `0cb0433e479adce8c5faf30cea7f09174b1c5f4f`
- Surface CI at prompt creation: green
- Workflow run to inspect: `25240025318`

Changed files in PR #7 at prompt creation:

- `packages/coordinator/src/coordinator.ts`
- `packages/coordinator/src/coordinator.test.ts`
- `packages/coordinator/src/index.ts`
- `ai/reports/task-0003-implementer.md`
- `ai/state.json`
- `ai/tasks/task-0003.md`

Important local state:

- The current checkout may already be on `codex/task-0003-coordinator`.
- There is an unrelated untracked file from a prior orchestration cycle: `ai/tasks/task-0002-verifier.md`. Do not include it in this verification unless you explicitly decide it belongs.
- Local `main` has previously diverged from `origin/main`; do not destructively reset local branches.

# Objective
Verify Task 0003 end to end against the prompt, specs, implementation report, PR diff, local quality gates, local kiox/orun behavior, and PR CI logs.

If PASS, write the verifier report, update state for Task 0004, push the report/state to PR #7, wait for CI, inspect logs, mark the PR ready if still draft, merge it, and sync local `main` safely.

If FAIL, do not merge. Write a verifier report with concrete blockers and leave clear PR feedback.

# Read First
Read these before running checks:

1. `ai/tasks/task-0003.md`
2. `ai/reports/task-0003-implementer.md`
3. `ai/reports/task-0002-verifier.md`
4. `agents/orchestrator.md`
5. `SCHEDULE.md`
6. `spec/00-constitution.md`
7. `spec/03-types-package.md`
8. `spec/05-coordinator-do.md`
9. `spec/04-worker-api.md` coordinator forwarding sections
10. `packages/coordinator/src/coordinator.ts`
11. `packages/coordinator/src/coordinator.test.ts`
12. `packages/coordinator/src/index.ts`
13. `packages/coordinator/tsconfig.json`

Inspect PR #7 metadata and diff:

```bash
gh pr view 7 --repo sourceplane/orun-backend --json number,title,url,state,isDraft,headRefName,baseRefName,mergeable,body,commits,files,reviews,statusCheckRollup
gh pr diff 7 --repo sourceplane/orun-backend --stat
gh pr diff 7 --repo sourceplane/orun-backend --name-only
```

# Required Verification Work
Verify every Task 0003 acceptance criterion:

1. Placeholder coordinator implementation is replaced.
2. All required internal endpoints are implemented:
   - `POST /init`
   - `POST /jobs/:jobId/claim`
   - `POST /jobs/:jobId/update`
   - `POST /jobs/:jobId/heartbeat`
   - `GET /jobs/:jobId/status`
   - `GET /runnable`
   - `GET /state`
   - `POST /cancel`
3. State is persisted to Durable Object storage and cached in memory.
4. Dependency gating, blocked/waiting claim behavior, heartbeat freshness, takeover, update ownership, cancellation, and runnable job logic are correct.
5. Alarm cleanup is implemented and tested.
6. Coordinator tests cover the required cases from the task prompt.
7. Existing `@orun/types` tests still pass.
8. Worker dry-run build still succeeds with exported `RunCoordinator`.
9. No Worker API routing, auth, storage, D1/R2, SQL migration, account/repo, or rate-limiting logic was introduced.
10. Local kiox/orun validation is attempted and documented.
11. PR CI logs prove meaningful validation ran.

# Local Commands To Run
Start from the PR branch:

```bash
git fetch origin main codex/task-0003-coordinator
git switch codex/task-0003-coordinator
git status --short --branch
```

Run local quality gates:

```bash
pnpm install
pnpm exec turbo run typecheck
pnpm exec turbo run build
pnpm exec turbo run test
pnpm exec turbo run lint
pnpm --filter @orun/coordinator test
pnpm --filter @orun/types test
cd apps/worker && pnpm exec wrangler deploy --dry-run && cd ../..
```

Run focused inspection checks:

```bash
rg -n "\\bany\\b" packages/coordinator/src
rg -n "D1|R2|STORAGE|DB|auth|OAuth|OIDC|migration|account|repo" packages/coordinator/src
find packages/coordinator/dist -maxdepth 3 -type f | sort
```

If `packages/coordinator/dist` contains emitted test files after `pnpm exec turbo run build`, decide whether that is acceptable. Prefer production package builds not to emit `*.test.js` unless the repo has an established reason.

Run local kiox/orun validation:

```bash
/Users/irinelinson/.local/bin/kiox -- orun plan --changed
/Users/irinelinson/.local/bin/kiox -- orun run --changed
```

If local kiox reports `0 components` or `0 jobs`, do not accept that blindly. Determine whether changed detection is expected locally because of branch/base state, and rely on CI logs to prove PR validation ran for `orun-coordinator`. If CI also reports `0 jobs`, treat that as a blocker or require a workflow/config fix.

# CI Log Verification
Do not trust green checks by status alone. Inspect logs.

```bash
gh pr checks 7 --repo sourceplane/orun-backend --watch
gh run view 25240025318 --repo sourceplane/orun-backend --json databaseId,status,conclusion,headBranch,headSha,jobs
gh run view 25240025318 --repo sourceplane/orun-backend --log
```

Confirm in logs:

- `sourceplane/kiox-action@v2.1.2` initialized the workspace.
- The PR run used head SHA `0cb0433e479adce8c5faf30cea7f09174b1c5f4f`, or a newer pushed verifier SHA if you add commits.
- `kiox -- orun plan --changed` ran in the Review Plan job.
- `kiox -- orun run --changed` ran in the Build & Deploy job.
- The changed component set includes `orun-coordinator` or otherwise proves coordinator package validation executed.
- Typecheck/build/test/lint for `@orun/coordinator` ran.
- The 35 coordinator tests ran in CI, not only locally.
- No live Cloudflare production deploy occurred unexpectedly.
- No warnings invalidate the result.

# Code Review Focus
Review the state machine as code, not just by tests.

## API and Routing

- All required routes exist and methods are enforced.
- Unknown routes return 404.
- Wrong methods on known routes return deterministic 400 or 405-like errors.
- All responses are JSON.
- Error responses use `{ error, code }` and avoid stack traces.
- Invalid JSON and invalid JSON shapes return 400, not 500. Check bodies like `null`, arrays, missing `plan`, non-array `plan.jobs`, non-array `deps`, non-string `runnerId`, duplicate job IDs, and missing dependency references.

## Initialization

- `/init` is idempotent for the same `runId`.
- `/init` conflicts for a different `runId`.
- Jobs are initialized as pending with null runner/timestamps/error fields.
- `runState.status` starts as `running`.
- The plan is stored only for dependency resolution; no logs/artifacts/step outputs are stored.
- `namespaceSlug` handling is deliberate. It is accepted but not stored in `RunState`; confirm this matches the coordinator-only scope and is documented.

## Claiming and Dependencies

- Pending jobs with all deps success are claimable.
- Pending jobs with pending/running deps return `depsWaiting`.
- Pending jobs with failed deps return `depsBlocked`.
- Running jobs with fresh heartbeat are not claimable by a different runner.
- Running jobs older than 300 seconds are take-overable.
- Terminal jobs return `{ claimed: false, currentStatus }`.
- Claims after run-level `failed`, `completed`, or `cancelled` state are handled safely. The spec is not explicit here; flag any behavior that would let new work start after a terminal run state.

## Updates and Heartbeats

- Updates require `runnerId` ownership.
- Updates are rejected for non-running jobs.
- Success/failure status updates set `finishedAt` and `lastError` correctly.
- All-success jobs mark the run `completed`.
- Any failed job marks the run `failed`.
- Heartbeats from non-owners or stale owners return `{ ok: false, abort: true }`.
- Heartbeats from owners update `heartbeatAt` and persist.
- Takeover behavior makes old runner heartbeats abort.

## Cancellation and Alarm

- `/cancel` marks pending/running jobs failed with `lastError = "cancelled"`.
- `/cancel` schedules expiry.
- Terminal/successful jobs are not corrupted by cancellation unless explicitly intended.
- `scheduleExpiry()` only sets one alarm and uses 24h.
- `alarm()` deletes all DO storage and clears in-memory state.

## Persistence and Tests

- `loadState()` reads from `this.state.storage.get("runState")` only once per instance.
- Every mutation persists.
- A new coordinator instance over the same fake storage sees persisted state.
- The fake storage is not so permissive that it hides bugs. In particular, consider whether `get()` should clone values to better mimic Durable Object storage serialization.
- The concurrent claim test genuinely proves only one claim succeeds under the implementation’s sequencing.
- Test files are not emitted into package production build unless intentionally accepted.

## Type and Contract Notes

- `CoordinatorClaimResult` handles `depsBlocked` and `depsWaiting` without weakening `@orun/types`.
- `CoordinatorUpdateJobRequest` adds `runnerId` without weakening `UpdateJobRequest`.
- Future Worker API integration can import needed coordinator-local types from `@orun/coordinator`.
- No `any` is introduced.

# Pass / Fail Rules
PASS only if:

- All required endpoints and state transitions behave correctly.
- Local quality gates pass.
- Coordinator tests are meaningful and cover the required cases.
- CI logs prove `@orun/coordinator` validation actually ran.
- No out-of-scope domain logic was added.
- Runtime validation/error behavior is production-grade enough for the internal Worker-facing API.
- Any verifier report/state update is committed to PR #7, CI reruns green, and logs are inspected again.

FAIL if:

- Any required endpoint is missing or materially wrong.
- Job claiming can race or allow multiple successful claims.
- Dependency gating or takeover behavior is incorrect.
- Updates can be made by non-owners.
- New work can start after a terminal run state in a way that would violate coordinator authority.
- Alarm cleanup is missing or untested.
- CI is green but did not run coordinator package validation.
- Tests are superficial or miss required cases.
- The implementation introduces Worker/auth/storage/account/migration behavior.

# When Done Report
Write:

```text
ai/reports/task-0003-verifier.md
```

Use this structure:

```markdown
# Task 0003 Verifier Report

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
   - `current_task`: `4`
   - `completed`: `[1, 2, 3]`
   - `repo_health`: `"green"`
   - `next_focus`: `"task-0004-storage"`
   - add notes that Task 0003 verified PASS and whether any coordinator contract risks remain.
2. Commit `ai/reports/task-0003-verifier.md` and the state update to the PR branch.
3. Do not include unrelated untracked files like `ai/tasks/task-0002-verifier.md`.
4. Push the PR branch.
5. Wait for CI on the new head SHA.
6. Inspect the new CI logs.
7. Mark PR #7 ready for review if still draft.
8. Merge PR #7.
9. Checkout/sync local `main` to the merged remote state. If local `main` is divergent, do not destroy local-only commits without explicit approval; use a fresh branch/worktree if needed for the next task.

# If FAIL
Do not merge.

Write the verifier report with `Result: FAIL`, then leave a PR comment or review with:

- Blocking issue(s)
- Exact failing command(s), file(s), or CI log lines
- Minimal required fix
- Whether Task 0004 can proceed in parallel or should wait
