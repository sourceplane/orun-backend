# Task 0008 Verifier Report

## Verdict: FAIL

PR #52 (`sourceplane/orun`, `feat/remote-state-client`) is **not merged**. Three hard blockers were found. The implementation is largely correct and high-quality, but the blockers will cause distributed execution to silently fail in production.

---

## Hard Blockers

### Blocker 1 — Already-complete claim exits non-zero (criterion 24)

**File:** `cmd/orun/command_run.go:452`

When `--job <jobID>` targets a job already completed by another runner, `performRemoteJobClaim` returns a typed `*jobAlreadyCompleteError`. The comment says "Signal the caller that we should exit 0" but no caller ever handles this type — it propagates through `setupRemoteStateHooks` → `runPlan()` → cobra `RunE` → `rootCmd.Execute()` → `main()` calls `os.Exit(1)`.

In a matrix run where one worker finishes a job before a duplicate worker claims it, the duplicate worker exits non-zero, causing the GitHub Actions matrix job to fail the entire workflow.

**Fix required:** Catch `*jobAlreadyCompleteError` in `runPlan()` (before returning the error) and return `nil` instead:

```go
if err := setupRemoteStateHooks(r, plan, planID, execID, backendURL); err != nil {
    var alreadyDone *jobAlreadyCompleteError
    if errors.As(err, &alreadyDone) {
        return nil  // already complete is success
    }
    return err
}
```

---

### Blocker 2 — `RunnableResponse` JSON tag mismatch (criterion 27)

**File:** `internal/remotestate/client.go:126`

```go
type RunnableResponse struct {
    JobIDs []string `json:"jobIds"`
}
```

The backend `RunnableJobsResponse` in `packages/types/src/index.ts` uses `{ jobs: string[] }` (JSON key `"jobs"`), not `"jobIds"`. The Worker handler `handleRunnable` passes the coordinator response directly with no key transformation. `GetRunnable()` always deserializes to an empty slice.

This means the `/runnable` endpoint never returns useful data. Currently harmless because `waitForJobRunnable` doesn't call `GetRunnable` at all (see Blocker 3), but represents a broken contract that must be fixed.

**Fix required:** Change `json:"jobIds"` to `json:"jobs"`.

---

### Blocker 3 — `waitForJobRunnable` never calls `/runnable` (criterion 23)

**File:** `cmd/orun/command_run.go:494-504`

```go
func waitForJobRunnable(ctx context.Context, backend statebackend.Backend, runID, jobID string, delay time.Duration, deadline time.Time) error {
    remote, ok := backend.(*statebackend.RemoteStateBackend)
    if !ok {
        return nil
    }
    _ = remote // not used directly here; we use the Backend interface
    return sleepOrDone(ctx, delay) // ONLY SLEEPS
}
```

The comment in the code acknowledges the missing behavior ("Use LoadRunState as an approximation if GetRunnable is not exposed") but does neither. Dep-waiting jobs use fixed exponential backoff without event-driven signaling from the backend's `/runnable` endpoint.

While the claim API itself does enforce ordering (a claim attempt before deps complete returns `depsWaiting: true`), the missing `/runnable` poll means:
- Jobs that become runnable quickly still wait for the full backoff delay
- The `/runnable` endpoint — a key coordination primitive — is never exercised

**Fix required:** Call `client.GetRunnable(ctx, runID)` inside `waitForJobRunnable` and block until `jobID` appears in the returned list, then return to let the caller retry the claim. Fix Blocker 2 first so the response deserializes correctly.

---

## Notable Risks (Non-Blocking)

These do not block merge but should be addressed in a follow-on task or noted in the spec.

### Risk A — `AfterJobTerminal` silently ignores update errors

**File:** `cmd/orun/command_run.go` (AfterJobTerminal hook)

If the terminal `UpdateJob` call fails (network error, auth expiry), the backend job state is left as `running` indefinitely. All downstream dependent jobs will never become runnable. There is no retry or warning to the user.

**Recommended:** Log the error prominently and optionally retry with a short bounded window (2-3 attempts). At minimum, surface it to the user.

### Risk B — Heartbeat goroutine context never cancelled

**File:** `cmd/orun/command_run.go:309`  
`ctx := context.Background()` — the heartbeat goroutine for explicit `--job` mode uses this context. If the runner exits (success, failure, already-complete) but the heartbeat goroutine is not stopped, it continues to heartbeat forever (until process exit).

In the `--job` code path, the heartbeat cancel (`hbCancel`) is called in `AfterJobTerminal`, so it does stop for that path. But the `context.Background()` for the non-`--job` (multi-job) path is never cancelled. Verify the heartbeat is not sent for a job that was already complete before execution.

### Risk C — Per-step remote logs not accumulated server-side

Each `AppendStepLog` call overwrites the entire job log (`UploadLog` with accumulated content). This means partial logs are visible mid-run but step boundaries are not preserved server-side. Acceptable for the current spec.

### Risk D — `AfterStepLog` silently ignores upload errors

Log upload errors do not surface to the user. Best-effort is acceptable per current spec, but remote explicit mode should at least emit a stderr warning.

---

## Criteria Assessment

| # | Criterion | Status |
|---|-----------|--------|
| 1 | Local-state compat without `--remote-state` | ✓ |
| 2 | Positional plan ref still works | ✓ |
| 3 | Existing flags/behaviors unbroken | ✓ |
| 4 | Flags exist on run/status/logs | ✓ |
| 5 | Remote activation precedence | ✓ |
| 6 | Backend URL precedence | ✓ |
| 7 | Fails clearly without backend URL | ✓ |
| 8 | Fails clearly without token | ✓ |
| 9 | OIDC uses correct env vars | ✓ |
| 10 | OIDC audience = `orun` | ✓ |
| 11 | `ORUN_TOKEN` static bearer fallback | ✓ |
| 12 | No token printed/logged/written | ✓ |
| 13 | Auth header + User-Agent | ✓ |
| 14 | Error envelope parsing | ✓ |
| 15 | Bounded timeouts | ✓ |
| 16 | Retry safety (non-idempotent = no retry) | ✓ |
| 17 | Run ID derivation precedence | ✓ |
| 18 | Step env vars injected | ✓ |
| 19 | Plan conversion non-mutating, correct shape | ✓ |
| 20 | Status mapping `success↔completed` | ✓ |
| 21 | `InitRun` join with deterministic ID | ✓ |
| 22 | Claim/update/heartbeat/log wired | ✓ |
| 23 | Dep wait is backend-driven via `/runnable` | **FAIL** — Blocker 3 |
| 24 | Already-complete exits 0 | **FAIL** — Blocker 1 |
| 25 | `depsBlocked` exits non-zero with message | ✓ |
| 26 | `running` status polls sensibly | ✓ |
| 27 | `/runnable` response shape matches contract | **FAIL** — Blocker 2 |
| 28 | Heartbeats stop on terminal | ✓ (for --job path) |
| 29 | Terminal update on success and failure | ✓ (but errors ignored — Risk A) |
| 30 | Logs uploaded with job context | ✓ |
| 31 | `status --remote-state` loads from backend, `--json` | ✓ |
| 32 | `status --watch` polls until terminal | ✓ |
| 33 | `logs --remote-state --job` fetches backend log | ✓ |
| 34 | Intent schema `execution.state.mode` enum | ✓ |
| 35 | Docs cover remote state, OIDC, secrets | ✓ |
| 36 | GHA example demonstrates full matrix pattern | partial (no dup-claim, no `ORUN_EXEC_ID` sharing, no status step) |
| 37 | Conformance workflow gated | ✓ |
| 38 | No unauthorized backend/auth changes | ✓ |
| 39 | Tests are meaningful | ✓ |
| 40 | `go test ./...` and race tests pass | ✓ |
| 41 | CI logs confirm tests ran | ✓ |
| 42 | State/report files repaired before PASS | n/a (FAIL) |

---

## What Is Good

The overall architecture is excellent. The `RunnerHooks` pattern keeps the runner transport-agnostic. The `statebackend.Backend` interface is clean. Auth (OIDC-first, then static token, then error), run-ID derivation, plan conversion, status/log rendering, and the cobra flag wiring are all correct. `go test -race` is clean. The conformance workflow gating is correct.

The three blockers are fixable in a few hours of work.

---

## Required Changes Before Re-Verification

1. **Catch `*jobAlreadyCompleteError` in `runPlan()` and return `nil`** — `cmd/orun/command_run.go`
2. **Change `json:"jobIds"` → `json:"jobs"` in `RunnableResponse`** — `internal/remotestate/client.go:126`
3. **Implement `waitForJobRunnable` using `GetRunnable` with backoff** — `cmd/orun/command_run.go`
4. Add test coverage for the already-complete path in `cmd/orun` tests.
5. Add test for `GetRunnable` deserialization in `client_test.go`.

Head SHA verified: `ec3709bb9d8c7c7f815ce609da6f852973b04990`  
CI: green on both `validate` and `test-changed-pr` runs.  
Date: 2026-05-02
