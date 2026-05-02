# Task 0008 Implementer Report

## Task

Implement remote-state client integration in `sourceplane/orun` so that GitHub Actions matrix jobs can coordinate distributed execution of a shared plan DAG via the `sourceplane/orun-backend` API.

## Status

**Completed.** All tests pass. PR opened at https://github.com/sourceplane/orun/pull/52.

## What Was Built

### New packages

#### `internal/remotestate`

| File | Purpose |
| --- | --- |
| `client.go` | HTTP client for all orun-backend API endpoints: `CreateRun`, `GetRun`, `ListJobs`, `GetRunnable`, `ClaimJob`, `Heartbeat`, `UpdateJob`, `UploadLog`, `GetLog`. Includes `doJSON` helper with 3-attempt retry on 5xx, `APIError` type with `IsAuth()`, URL segment escaping. |
| `auth.go` | `TokenSource` interface, `OIDCTokenSource` (fetches from `ACTIONS_ID_TOKEN_REQUEST_URL` with audience `orun`), `StaticTokenSource`, `ResolveTokenSource()` (OIDC-first, then `ORUN_TOKEN`, error if neither). |
| `runid.go` | `DeriveRunID(planID, explicitID)`: explicit → `gh-{RUN_ID}-{ATTEMPT}-{planID}` → `local-{planID}-{hex3}`. Uses `crypto/rand` for the fallback suffix. |
| `convert.go` | `ConvertPlan(*model.Plan) *BackendPlan` — non-mutating conversion. `BackendJobStatusToLocal`/`LocalJobStatusToBackend` status mapping. |
| `auth_test.go`, `runid_test.go`, `client_test.go` | Unit tests using `httptest.NewServer`. |

#### `internal/statebackend`

| File | Purpose |
| --- | --- |
| `backend.go` | `Backend` interface with `InitRun`, `ClaimJob`, `Heartbeat`, `UpdateJob`, `AppendStepLog`, `LoadRunState`, `ReadJobLog`, `Close`. Supporting types: `JobStatus`, `InitRunOptions`, `RunHandle`, `ClaimResult`, `HeartbeatResult`. |
| `file.go` | `FileStateBackend`: wraps `*state.Store`. Claim/heartbeat/update/log mutations are no-ops (local state is written by the runner directly). `ReadJobLog` concatenates `.orun/executions/{id}/logs/{job}/*.log` files. |
| `remote.go` | `RemoteStateBackend`: wraps `*remotestate.Client`. `DeriveRunnerID()` builds GHA-aware runner ID. `LoadRunState` converts `RunResponse`+`[]JobResponse` → `*state.ExecState`+`*state.ExecMetadata`. |

### Modified files

#### `internal/runner/runner.go`

- Added `RunnerHooks` struct with `BeforeJob(jobID string) (skip bool, err error)`, `AfterStepLog(jobID, stepID, output string)`, `AfterJobTerminal(jobID string, success bool, errText string)`.
- Added `Runner` fields: `PlanID string`, `SkipLocalDepsForJob bool`, `Hooks *RunnerHooks`.
- `baseExecContext.BaseEnv` now includes `ORUN_PLAN_ID`.
- `stepExecContext` injects `ORUN_JOB_ID` and `ORUN_JOB_RUN_ID` into job env.
- Serial and concurrent run paths both call `BeforeJob` before executing; `AfterStepLog` after writing each step log; `AfterJobTerminal` at every terminal point.
- `SkipLocalDepsForJob` bypasses the local dependency check when the backend enforces ordering.

#### `cmd/orun/commands_root.go`

- Added `remoteStateEnvVar`, `backendURLEnvVar`, `tokenEnvVar` constants.
- Added `newRemoteBackend(url string) (statebackend.Backend, error)` shared helper.

#### `cmd/orun/command_run.go`

- `--remote-state` and `--backend-url` flags.
- `isRemoteStateActive(intent)` and `resolveBackendURL(intent)`: flag → env → intent resolution.
- `runPlan()`: computes `planID`, derives remote run ID, calls `setupRemoteStateHooks`.
- `setupRemoteStateHooks()`: resolves token, creates client+backend, calls `InitRun`, handles `--job` claim loop, wires all three hooks. For explicit `--job` mode, claim is performed up-front and `BeforeJob` is nil.
- `performRemoteJobClaim()`: 30min timeout claim loop with exponential backoff (2s→60s). Handles `DepsWaiting`, `DepsBlocked`, already-complete, already-failed cases.
- `runHeartbeat()`: goroutine sending heartbeat every 30s via context cancellation.

#### `cmd/orun/command_status.go`

- `--remote-state` and `--backend-url` flags.
- `showStatus()` detects remote mode; calls `showRemoteExecution()` (single pass) or `watchRemoteExecution()` (polling until terminal).
- `showExecution()` refactored into a thin wrapper over `renderExecution(execID, meta, st, color)` so both local and remote paths share the same renderer.
- `renderExecutionJSON()` handles `--json` for both paths.

#### `cmd/orun/command_logs.go`

- `--remote-state` and `--backend-url` flags.
- `showLogs()` detects remote mode; calls `showRemoteLogs()`.
- `collectRemoteLogEntries()`: loads run state for job list, fetches each job's log from backend, applies `--job` and `--failed` filters.
- `renderLogEntries()` extracted as shared renderer used by both local and remote paths.

#### `internal/model/intent.go`

- Added `Execution IntentExecution` field to `Intent`.
- `IntentExecution.State.Mode` (`local`|`remote`) and `IntentExecution.State.BackendURL`.

#### `assets/config/schemas/intent.schema.yaml`

- Added `execution.state` section with `mode` enum and `backendUrl` format:uri.

### Examples and workflows

- `examples/remote-state-matrix/intent.yaml` — fixture DAG: foundation → api, web across dev and stage.
- `examples/github-actions/remote-state-matrix.yml` — full GHA matrix workflow (plan → matrix emit → parallel run jobs).
- `.github/workflows/remote-state-conformance.yml` — gated conformance smoke test (`REMOTE_STATE_TESTS=true`).

### Docs

Updated: `website/docs/cli/orun-run.md`, `orun-status.md`, `orun-logs.md`, `reference/configuration.md`, `reference/environment-variables.md`.

## Test Results

```
ok  github.com/sourceplane/orun/cmd/orun
ok  github.com/sourceplane/orun/internal/remotestate
ok  github.com/sourceplane/orun/internal/runner
# all other packages pass
```

Race detector: clean on `./internal/runner ./cmd/orun ./internal/remotestate`.

## Notable Design Decisions

1. **RunnerHooks pattern** — backend logic stays out of the runner; the command layer wires it. The runner remains transport-agnostic.
2. **`SkipLocalDepsForJob`** — when `--job` is given in remote mode, the backend claim API enforces ordering; the local dep check would block forever (no local state for peer jobs), so it is bypassed.
3. **Log accumulation** — per-job logs are built up in a mutex-protected map and each `AppendStepLog` call overwrites the full job log on the backend (idempotent). This avoids a streaming API and keeps things simple.
4. **`crypto/rand` for run ID** — `math/rand/v2` removed `Read` in Go 1.20; switched to `crypto/rand` for the local fallback suffix.
5. **`renderExecution` extraction** — both local and remote status paths share the same terminal renderer. Same for `renderLogEntries` in logs.

## PR

https://github.com/sourceplane/orun/pull/52
