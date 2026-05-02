# Task 0008 Verification

# Agent
Verifier

# Current Repo Context
Task 0008 implemented remote-state client integration in `sourceplane/orun`, using `sourceplane/orun-backend` as the coordination API.

Primary GitHub PR to verify:

- Repo: `sourceplane/orun`
- PR: #52
- URL: `https://github.com/sourceplane/orun/pull/52`
- Title: `feat: implement remote-state client for distributed GHA matrix execution`
- Branch: `feat/remote-state-client`
- Base: `main`
- State at prompt creation: open, ready for review
- Mergeability at prompt creation: `MERGEABLE`
- Head SHA at prompt creation: `ec3709bb9d8c7c7f815ce609da6f852973b04990`
- Surface CI at prompt creation: green
- CI runs to inspect:
  - `25251189426` (`CI` / `validate`)
  - `25251189429` (`Test --changed in PR context` / `test-changed-pr`)

Changed files in PR #52 at prompt creation:

- `.github/workflows/remote-state-conformance.yml`
- `assets/config/schemas/intent.schema.yaml`
- `cmd/orun/command_logs.go`
- `cmd/orun/command_run.go`
- `cmd/orun/command_status.go`
- `cmd/orun/commands_root.go`
- `examples/github-actions/remote-state-matrix.yml`
- `examples/remote-state-matrix/intent.yaml`
- `internal/model/intent.go`
- `internal/remotestate/auth.go`
- `internal/remotestate/auth_test.go`
- `internal/remotestate/client.go`
- `internal/remotestate/client_test.go`
- `internal/remotestate/convert.go`
- `internal/remotestate/runid.go`
- `internal/remotestate/runid_test.go`
- `internal/runner/runner.go`
- `internal/statebackend/backend.go`
- `internal/statebackend/file.go`
- `internal/statebackend/remote.go`
- `website/docs/cli/orun-logs.md`
- `website/docs/cli/orun-run.md`
- `website/docs/cli/orun-status.md`
- `website/docs/reference/configuration.md`
- `website/docs/reference/environment-variables.md`

Implementer-reported deliverables:

- `internal/remotestate`: HTTP client, OIDC/static token auth, run ID derivation, plan conversion, backend/local status mapping.
- `internal/statebackend`: backend interface, `FileStateBackend`, `RemoteStateBackend`.
- `internal/runner`: `RunnerHooks`, `PlanID`, `SkipLocalDepsForJob`, `ORUN_PLAN_ID`, `ORUN_JOB_ID`, `ORUN_JOB_RUN_ID`.
- `cmd/orun`: `--remote-state` and `--backend-url` on `run`, `status`, and `logs`.
- Remote claim loop with exponential backoff and heartbeat.
- Remote status/logs rendering.
- `intent.yaml` `execution.state.{mode,backendUrl}` model/schema.
- GitHub Actions matrix example and gated conformance workflow.
- Docs updates.

Implementer-reported checks:

- `go test ./...`: passed.
- `go test -race ./internal/runner ./cmd/orun ./internal/remotestate`: passed.

Backend context:

- Repo: `/Users/irinelinson/sourceplane/orun-backend`
- `main` is at `aca55c2`: `docs: add spec proposal process (#15)`.
- Task 0007 is verified and merged as PR #14.
- Worker routes required by Task 0008 exist, including deterministic `POST /v1/runs`, claim/update/heartbeat/runnable, job reads, and job-level logs.
- Current Worker mutable execution endpoints are OIDC-only.

Important local state at prompt creation:

- `/Users/irinelinson/sourceplane/orun` is on `feat/remote-state-client...origin/feat/remote-state-client`.
- `/Users/irinelinson/sourceplane/orun-backend` is on `main`.
- `/Users/irinelinson/sourceplane/orun-backend/ai/reports/task-0008-implementer.md` is untracked.
- `/Users/irinelinson/sourceplane/orun-backend/ai/tasks/task-0008.md` is untracked.
- Older unrelated untracked verifier prompts may exist in `orun-backend`:
  - `ai/tasks/task-0002-verifier.md`
  - `ai/tasks/task-0003-verifier.md`
  - `ai/tasks/task-0004-verifier.md`
  - `ai/tasks/task-0007-verifier.md`
- `ai/state.json` in `orun-backend` is currently invalid JSON due to a duplicated appended tail after the closing brace. `jq . ai/state.json` fails with a parse error. Treat this as verifier housekeeping that must be fixed before any PASS bookkeeping is committed.
- No files exist under `/Users/irinelinson/sourceplane/orun-backend/ai/proposals` at prompt creation.

# Objective
Verify Task 0008 end to end against:

- `ai/tasks/task-0008.md`
- `ai/reports/task-0008-implementer.md`
- `spec/09-cli-integration.md`
- PR #52 diff
- local checks
- GitHub Actions logs
- the actual backend contract from `sourceplane/orun-backend`

If PASS:

- Merge PR #52 in `sourceplane/orun`.
- Sync local `/Users/irinelinson/sourceplane/orun/main` safely.
- In `/Users/irinelinson/sourceplane/orun-backend`, repair `ai/state.json` so it is valid JSON.
- Write `ai/reports/task-0008-verifier.md`.
- Update `ai/state.json` for Task 0009:
  - add `8` to `completed`
  - set `current_task` to `9`
  - set `next_focus` to `task-0009-dashboard-ui`
  - record concise verification notes and accepted risks
- Preserve/commit task history as appropriate:
  - `ai/tasks/task-0008.md`
  - `ai/tasks/task-0008-verifier.md`
  - `ai/reports/task-0008-implementer.md`
  - `ai/reports/task-0008-verifier.md`
  - repaired `ai/state.json`
- Because Task 0008's implementation PR lives in a different repo, create and merge a small bookkeeping PR in `sourceplane/orun-backend` for the task/report/state files unless the user instructs otherwise.

If FAIL:

- Do not merge PR #52.
- Write `ai/reports/task-0008-verifier.md` with concrete blockers.
- Leave clear PR feedback on PR #52.
- If the failure reveals needed spec changes rather than implementation bugs, create an `/ai/proposals/task-0008-spec-update.md` proposal and note it in the report.

# Read First
Read these backend files first:

1. `/Users/irinelinson/sourceplane/orun-backend/ai/tasks/task-0008.md`
2. `/Users/irinelinson/sourceplane/orun-backend/ai/reports/task-0008-implementer.md`
3. `/Users/irinelinson/sourceplane/orun-backend/ai/reports/task-0007-verifier.md`
4. `/Users/irinelinson/sourceplane/orun-backend/agents/orchestrator.md`
5. `/Users/irinelinson/sourceplane/orun-backend/spec/04-worker-api.md`
6. `/Users/irinelinson/sourceplane/orun-backend/spec/06-auth.md`
7. `/Users/irinelinson/sourceplane/orun-backend/spec/09-cli-integration.md`
8. `/Users/irinelinson/sourceplane/orun-backend/packages/types/src/index.ts`
9. `/Users/irinelinson/sourceplane/orun-backend/apps/worker/src/router.ts`
10. `/Users/irinelinson/sourceplane/orun-backend/apps/worker/src/handlers/runs.ts`
11. `/Users/irinelinson/sourceplane/orun-backend/apps/worker/src/handlers/jobs.ts`
12. `/Users/irinelinson/sourceplane/orun-backend/apps/worker/src/handlers/logs.ts`

Read these `sourceplane/orun` files before running checks:

1. `/Users/irinelinson/sourceplane/orun/cmd/orun/commands_root.go`
2. `/Users/irinelinson/sourceplane/orun/cmd/orun/command_run.go`
3. `/Users/irinelinson/sourceplane/orun/cmd/orun/command_status.go`
4. `/Users/irinelinson/sourceplane/orun/cmd/orun/command_logs.go`
5. `/Users/irinelinson/sourceplane/orun/internal/runner/runner.go`
6. `/Users/irinelinson/sourceplane/orun/internal/remotestate/client.go`
7. `/Users/irinelinson/sourceplane/orun/internal/remotestate/auth.go`
8. `/Users/irinelinson/sourceplane/orun/internal/remotestate/convert.go`
9. `/Users/irinelinson/sourceplane/orun/internal/remotestate/runid.go`
10. `/Users/irinelinson/sourceplane/orun/internal/statebackend/backend.go`
11. `/Users/irinelinson/sourceplane/orun/internal/statebackend/file.go`
12. `/Users/irinelinson/sourceplane/orun/internal/statebackend/remote.go`
13. `/Users/irinelinson/sourceplane/orun/internal/model/intent.go`
14. `/Users/irinelinson/sourceplane/orun/assets/config/schemas/intent.schema.yaml`
15. `/Users/irinelinson/sourceplane/orun/examples/github-actions/remote-state-matrix.yml`
16. `/Users/irinelinson/sourceplane/orun/.github/workflows/remote-state-conformance.yml`
17. All new and changed tests in `internal/remotestate`, `internal/runner`, and `cmd/orun`.

Inspect PR #52 metadata and diff:

```bash
gh pr view 52 --repo sourceplane/orun --json number,title,url,state,isDraft,headRefName,baseRefName,mergeable,body,commits,files,reviews,statusCheckRollup,headRefOid
gh pr diff 52 --repo sourceplane/orun --name-only
gh pr diff 52 --repo sourceplane/orun --patch --color=never
```

# Required Verification Work
Verify every Task 0008 acceptance criterion:

1. `orun run` without `--remote-state` remains local-state compatible.
2. Positional `orun run [component|planhash]` still works.
3. Existing `--plan`, `--job`, `--env`, `--component`, `--gha`, `--exec-id`, `--retry`, `status`, `logs`, and local resume/log behavior are not broken.
4. `--remote-state` and `--backend-url` exist on `run`, `status`, and `logs`.
5. Remote activation precedence is correct: flag, `ORUN_REMOTE_STATE=true`, intent config, then local default.
6. Backend URL precedence is correct: flag, `ORUN_BACKEND_URL`, intent config.
7. Remote mode fails clearly when no backend URL is available.
8. Remote mode fails clearly when no token source is available.
9. GitHub Actions OIDC token acquisition uses `ACTIONS_ID_TOKEN_REQUEST_URL` and `ACTIONS_ID_TOKEN_REQUEST_TOKEN`.
10. OIDC audience defaults to `orun`.
11. `ORUN_TOKEN` is used as bearer-token fallback outside GitHub Actions.
12. No token is printed, logged, written to state, or included in docs examples.
13. HTTP client sends `Authorization: Bearer <token>` and `User-Agent: orun-cli/<version>`.
14. HTTP client parses backend `{ error, code }` envelopes.
15. HTTP client has bounded connect/read/log-upload timeouts.
16. Retry behavior is safe: idempotent reads/create may retry `5xx`; non-idempotent claim/update/heartbeat/log mutations should not retry unexpectedly.
17. Run ID derivation handles explicit ID, `ORUN_EXEC_ID`, GitHub Actions run ID/attempt, and local fallback with plan ID.
18. Step env includes `ORUN_PLAN_ID`, `ORUN_EXEC_ID`, `ORUN_JOB_ID`, and `ORUN_JOB_RUN_ID`.
19. CLI plan conversion matches backend `@orun/types` contract without mutating the local plan.
20. Backend/local status mappings are correct, especially backend `success` to local `completed`.
21. Remote `orun run <planID> --remote-state` initializes or joins backend run with deterministic `runId`.
22. Remote `orun run <planID> --job <jobID> --remote-state` coordinates through backend claim/update/heartbeat/log APIs.
23. Remote `--job` waits for backend dependency completion instead of failing because local state is empty.
24. Duplicate claim/already-complete behavior exits cleanly with exit code 0.
25. Backend `depsBlocked` or failed upstream exits non-zero with a clear message.
26. Backend `currentStatus: running` waits/polls sensibly.
27. `/v1/runs/{runID}/runnable` response shape matches the Worker contract.
28. Heartbeats stop when jobs reach terminal state and do not continue forever during a long multi-job process.
29. Terminal update is attempted on both success and failure.
30. Remote logs upload useful job-level content without losing step context.
31. `orun status --remote-state` loads run and jobs from backend and supports `--json`.
32. `orun status --remote-state --watch` polls until terminal state.
33. `orun logs --remote-state --job <jobID>` fetches backend job log text.
34. `intent.yaml` `execution.state.mode` accepts `local|remote` and rejects unsupported values.
35. Docs explain local default, remote state config, `id-token: write`, backend URL, token behavior, and no committed secrets.
36. GitHub Actions example demonstrates plan artifact, matrix children, duplicate claim, dependency waits, env fanout, status/log verification.
37. Conformance workflow is gated and does not call a real backend by default.
38. No backend auth expansion or schema changes were made without tests/proposals.
39. Unit tests are meaningful and do not only assert flags exist.
40. `go test ./...` and focused race tests pass locally.
41. CI logs prove expected tests and smoke checks actually ran.
42. Orchestrator state/report files are repaired and valid before PASS bookkeeping.

# Critical Probes
Pay special attention to these implementation details observed during prompt creation:

- `internal/remotestate/client.go` defines `RunnableResponse` as `jobIds`, but the backend type/spec uses `jobs: string[]` for runnable jobs. Verify the real Worker response and fix if needed.
- `cmd/orun/command_run.go` has a `waitForJobRunnable` helper that appears to sleep rather than call `/runnable`. Verify remote dependency waits are genuinely backend-driven, not only time-based retry loops.
- `performRemoteJobClaim` returns `jobAlreadyCompleteError` to signal exit 0, but `setupRemoteStateHooks`/`runPlan` may treat it as an error. Verify already-complete duplicate claims exit successfully.
- `runHeartbeat` uses `context.Background()` from setup and may not be cancelled per job. Verify heartbeats stop on terminal job completion, especially for multi-job remote runs.
- Explicit `--job` starts heartbeat before the runner executes and uses `SkipLocalDepsForJob`. Verify no heartbeat is sent for a job that was already complete or failed before execution.
- `AfterStepLog` ignores upload errors. Decide whether best-effort logs are acceptable or whether remote explicit mode should surface upload failures before terminal update.
- `AfterJobTerminal` ignores terminal update errors. Decide whether this is acceptable for remote explicit mode; a job that succeeded locally but failed to update backend can leave distributed state stuck.
- `FileStateBackend` mutation methods are no-ops. Verify this does not hide test gaps or make the backend abstraction misleading.
- `go test ./...` should cover local run/status/log compatibility; add manual or focused tests if not.
- `ai/state.json` in `orun-backend` is invalid JSON at handoff. Repair it before writing PASS state.

# Local Commands To Run
Start with both repos:

```bash
cd /Users/irinelinson/sourceplane/orun
git fetch origin main feat/remote-state-client
git switch feat/remote-state-client
git status --short --branch

cd /Users/irinelinson/sourceplane/orun-backend
git fetch origin main
git switch main
git status --short --branch
jq . ai/state.json
```

Run `sourceplane/orun` checks:

```bash
cd /Users/irinelinson/sourceplane/orun
go test ./...
go test -race ./internal/runner ./cmd/orun ./internal/remotestate
go test ./scripts/releaser/...
go vet ./...
```

Run focused searches:

```bash
cd /Users/irinelinson/sourceplane/orun
rg -n "remote-state|backend-url|ORUN_REMOTE_STATE|ORUN_BACKEND_URL|ORUN_TOKEN|ACTIONS_ID_TOKEN|ORUN_PLAN_ID|ORUN_JOB_ID|ORUN_JOB_RUN_ID" cmd internal website examples .github assets
rg -n "jobIds|JobIDs|runnable|depsWaiting|depsBlocked|alreadyComplete|jobAlreadyComplete|Heartbeat|context.Background|UploadLog|UpdateJob" cmd/orun internal/remotestate internal/statebackend internal/runner
rg -n "fmt\\.Print|log\\.Print|token|Authorization|Bearer|ACTIONS_ID_TOKEN_REQUEST_TOKEN" cmd internal --glob '!**/*_test.go'
rg -n "TODO|FIXME|panic\\(|time.Sleep\\(|math/rand" cmd internal examples .github website
git diff --check main...HEAD
```

Run minimal manual CLI smoke checks without a live backend:

```bash
cd /Users/irinelinson/sourceplane/orun
go run ./cmd/orun run --help | rg -- "--remote-state|--backend-url"
go run ./cmd/orun status --help | rg -- "--remote-state|--backend-url"
go run ./cmd/orun logs --help | rg -- "--remote-state|--backend-url"
go run ./cmd/orun validate --intent examples/remote-state-matrix/intent.yaml
go run ./cmd/orun plan --intent examples/remote-state-matrix/intent.yaml --output /tmp/orun-remote-state-plan.json
test -s /tmp/orun-remote-state-plan.json
```

Run backend checks only if backend files are touched during verification:

```bash
cd /Users/irinelinson/sourceplane/orun-backend
pnpm --filter @orun/worker test
pnpm --filter @orun/worker typecheck
pnpm --filter @orun/worker build
pnpm exec turbo run test typecheck build
/Users/irinelinson/.local/bin/kiox -- orun plan --changed
/Users/irinelinson/.local/bin/kiox -- orun run --changed
```

# CI Log Verification
Do not trust green checks by status alone. Inspect logs.

```bash
gh pr checks 52 --repo sourceplane/orun --watch
gh run view 25251189426 --repo sourceplane/orun --json databaseId,status,conclusion,headBranch,headSha,jobs
gh run view 25251189426 --repo sourceplane/orun --log
gh run view 25251189429 --repo sourceplane/orun --json databaseId,status,conclusion,headBranch,headSha,jobs
gh run view 25251189429 --repo sourceplane/orun --log
```

Confirm:

- CI ran on PR #52 head SHA `ec3709bb9d8c7c7f815ce609da6f852973b04990`, or a newer verifier SHA if you push fixes.
- `go test ./...` ran.
- `scripts/releaser` tests ran.
- Provider packaging and kiox smoke tests ran.
- `test-changed-pr` workflow ran.
- Remote-state conformance workflow is not accidentally contacting a real backend by default.
- Any warnings are non-blocking and recorded.

# Code Review Focus

## Local Compatibility

- Existing local file state remains the default.
- Local status/logs still use `.orun/executions`.
- Existing `--background`, `--retry`, `--job`, `--env`, `--component`, and `--gha` behaviors are not broken.
- No remote code path is invoked unless remote state is explicitly active.
- Remote state does not silently fall back to local after explicit activation.

## Remote Auth and HTTP

- OIDC request URL is built safely with `audience=orun`.
- Token request headers match GitHub's documented OIDC flow.
- Token source is resolved lazily enough not to break local commands.
- Headers and timeouts are applied to every backend request.
- URL path segments are escaped.
- Error wrapping keeps backend code/message visible without leaking secrets.

## Backend Contract

- `CreateRunRequest.plan` exactly matches the Worker `Plan` shape.
- `GET /runnable` response shape is correct.
- Claim response shape includes all extended coordinator fields.
- Status/log reads can work with session/D1 read behavior if the token is accepted; mutable OIDC behavior remains explicit.
- The client does not assume per-step backend logs exist.

## Runner Hooks

- Hooks are called in serial and concurrent paths.
- Hooks cannot cause duplicate job execution after a failed claim.
- `BeforeJob` skip behavior marks summary/resume correctly enough for CLI output.
- Terminal update is not skipped on step failure or finalizer failure.
- Heartbeat lifecycle is bounded to the claimed job.
- Job log accumulation is concurrency-safe.
- Step env variables are injected after job/step env merge and cannot be accidentally overwritten in the wrong direction.

## Status and Logs

- Remote status renders the same structure as local status.
- JSON output is stable and machine-readable.
- Watch mode has a sane polling interval and stops on terminal status.
- Remote logs respect `--job`, `--failed`, and raw/compact behavior where possible.
- Missing remote logs produce a gentle no-log message.

## Examples and Docs

- The fixture DAG actually produces the required dependencies.
- Workflow examples use `permissions: id-token: write`.
- Plan artifact path matches where `orun plan` saves plans.
- Matrix run commands reuse the same `ORUN_EXEC_ID`.
- Duplicate job entry is present.
- Environment fanout uses a distinct run ID if it should not collide with per-job matrix run, or intentionally shares if the workflow expects it.
- Docs do not contain real secrets or real bearer tokens.

## Spec Proposals

Use the new proposal process in `agents/orchestrator.md`.

Create `/Users/irinelinson/sourceplane/orun-backend/ai/proposals/task-0008-spec-update.md` if verification finds that the spec should change rather than the implementation, especially for:

- backend runnable response shape
- whether terminal update/log upload errors can be best-effort
- whether non-GitHub `ORUN_TOKEN` should be allowed to mutate jobs
- whether `status/logs --remote-state` should support OIDC-only or session reads
- whether per-step remote logs should be added to the backend API

# Constraints
- Do not merge if remote `--job` dependency waiting is not actually backend-driven.
- Do not merge if duplicate/already-complete claims exit non-zero.
- Do not merge if tokens can be printed or persisted.
- Do not merge if local default behavior regresses.
- Do not merge if PR #52 only works through tests but cannot match the Worker's real JSON contract.
- Do not broaden backend authorization unless the change is explicitly tested and justified.
- Keep any verifier fixes small and directly tied to blockers.
- Never use destructive git commands to reset local work.

# Acceptance Criteria
Task 0008 can PASS only if:

- PR #52 satisfies the Task 0008 prompt and `spec/09-cli-integration.md`.
- Local CLI behavior remains compatible.
- Remote run/job/status/log flows are implemented against the real backend contract.
- Critical probes above are resolved as passing, fixed, or documented with accepted risk.
- Local Go tests, race tests, and CI logs pass.
- The remote-state examples and docs are accurate and safe.
- No live external services are called in tests.
- Any required spec changes have proposals.
- `orun-backend` `ai/state.json` is valid JSON before verifier bookkeeping.
- Verifier report and state/task history updates are completed after PASS.

# When Done Report
Write:

```text
/Users/irinelinson/sourceplane/orun-backend/ai/reports/task-0008-verifier.md
```

Use this structure:

```text
# Task 0008 Verifier Report

Result: PASS|FAIL

## Checks
- Local commands run and results
- CI run/log inspection results
- PR metadata reviewed

## Issues
- Blockers if FAIL
- Verification-only fixes if any

## Risk Notes
- Accepted limitations and tradeoffs

## Spec Proposals
- Proposal files created or "None"

## Recommended Next Move
- If PASS: merged PR #52, local `sourceplane/orun/main` synced, bookkeeping PR merged in `orun-backend`, next task is Task 0009
- If FAIL: leave PR #52 open and list required fixes
```
