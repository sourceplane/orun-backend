# Spec 09 - orun Remote State Client Integration

## Scope

This spec defines the client-side work in `sourceplane/orun` and the backend HTTP contract needed for distributed run state.

The goal is that normal `orun run` remains fully local and backward-compatible, while `orun run --remote-state` stores execution state in orun-backend so multiple independent runners can coordinate against the same plan.

Primary examples:

```bash
orun run 0b673779a274 --remote-state
orun run 0b673779a274 --env dev --remote-state
orun run 0b673779a274 --env stage --remote-state
orun run 0b673779a274 --job api-edge-worker@production.deploy-worker --remote-state
```

This work belongs in the `sourceplane/orun` repository, with any missing backend API support implemented in `sourceplane/orun-backend`.

---

## Current orun CLI Reality

The current `sourceplane/orun` implementation already has these contracts:

- `orun run [component|planhash]` accepts a positional component name, plan name, plan file, or plan checksum prefix.
- `--plan` still exists but is deprecated in favor of the positional argument.
- `--job` runs a single job by exact plan job ID.
- `--env` filters jobs by plan job environment.
- `--component` filters jobs by component.
- `--gha` is a shortcut for the GitHub Actions runner, but GHA mode is also auto-detected in CI.
- `orun run` executes by default; there is no `--execute` flag.
- Plans are saved under `.orun/plans/{checksum}.json` and `.orun/plans/latest.json`.
- Execution records are saved under `.orun/executions/{execID}/` with `state.json`, `metadata.json`, and `logs/{job}/{step}.log`.
- `ORUN_PLAN_ID` overrides the default plan reference.
- `ORUN_EXEC_ID` pins the execution ID.

Do not reintroduce the older `orun run --remote --job <id>` contract. The new user-facing flag is `--remote-state`.

---

## CLI Modes

| Mode | Activation | Behavior |
|------|------------|----------|
| Local state | default `orun run` | Uses the filesystem state store under `.orun/executions/{execID}`. No backend HTTP calls. |
| Remote state | `orun run --remote-state` | Uses orun-backend for run/job state, dependency checks, heartbeats, and log upload. Steps still execute locally through the selected runner. |
| Intent-enabled remote state | `intent.yaml` config | Uses remote state without requiring the CLI flag. |

Environment variable alternative:

```bash
ORUN_REMOTE_STATE=true orun run 0b673779a274
```

Recommended precedence:

1. `--remote-state`
2. `ORUN_REMOTE_STATE=true`
3. `intent.yaml` remote-state config
4. Local filesystem state

The CLI should also support `--backend-url` and `ORUN_BACKEND_URL` for the backend endpoint.

---

## Intent Configuration

Add an optional top-level execution state block to `intent.yaml`:

```yaml
execution:
  state:
    mode: remote        # local | remote
    backendUrl: https://orun-api.<account>.workers.dev
```

The `mode` field selects the state backend. The `backendUrl` field is optional when `ORUN_BACKEND_URL` or `~/.orun/config.yaml` provides it.

The `sourceplane/orun` schemas, model structs, docs, and validation should accept this block. Existing intents without the block must behave exactly as they do today.

---

## Plan and Job Identity

The existing orun plan checksum remains the plan ID. Use `state.PlanChecksumShort(plan)` as the short display ID, for example `0b673779a274`.

Do not mutate existing plan job IDs. Existing IDs such as:

```text
orun-api-worker@production.deploy-worker
```

remain the canonical job IDs inside the plan.

For runtime uniqueness, generate a job-run ID that includes the plan ID, run ID, and plan job ID:

```text
{planID}:{runID}:{jobID}
```

The CLI should expose this to steps as:

```bash
ORUN_PLAN_ID=<planID>
ORUN_EXEC_ID=<runID>
ORUN_JOB_ID=<jobID>
ORUN_JOB_RUN_ID=<planID>:<runID>:<jobID>
```

Use path-safe escaping when storing these IDs on disk.

---

## Run ID Coordination

Remote-state runs need a deterministic run ID so matrix jobs attach to the same backend state.

Recommended derivation:

```go
func deriveRemoteRunID(planID string) string {
    explicit := strings.TrimSpace(firstNonEmpty(runExecID, os.Getenv("ORUN_EXEC_ID")))
    if explicit != "" {
        return ensureContainsPlanID(explicit, planID)
    }
    if ghRunID := os.Getenv("GITHUB_RUN_ID"); ghRunID != "" {
        attempt := firstNonEmpty(os.Getenv("GITHUB_RUN_ATTEMPT"), "1")
        return fmt.Sprintf("gh-%s-%s-%s", ghRunID, attempt, planID)
    }
    return fmt.Sprintf("local-%s-%s", planID, randomSuffix())
}
```

For `orun run 0b673779a274 --remote-state`, the CLI resolves `0b673779a274` through the existing saved-plan lookup, derives the run ID from that plan, and calls `POST /v1/runs` idempotently.

Multiple commands such as:

```bash
orun run 0b673779a274 --env dev --remote-state
orun run 0b673779a274 --env stage --remote-state
```

must initialize or join the same remote run when they share the same CI context and plan ID.

---

## State Backend Interface

Extract a state backend seam in `sourceplane/orun` so the runner does not write directly to `state.Store`.

Suggested interface:

```go
type StateBackend interface {
    InitRun(ctx context.Context, plan *model.Plan, opts InitRunOptions) (*RunHandle, error)
    ClaimJob(ctx context.Context, runID string, job model.PlanJob, runnerID string) (*ClaimResult, error)
    Heartbeat(ctx context.Context, runID string, jobID string, runnerID string) (*HeartbeatResult, error)
    UpdateJob(ctx context.Context, runID string, jobID string, runnerID string, status JobStatus, errText string) error
    AppendStepLog(ctx context.Context, runID string, jobID string, stepID string, content string) error
    LoadRunState(ctx context.Context, runID string) (*RunState, error)
    Close(ctx context.Context) error
}
```

Implementations:

- `FileStateBackend`: wraps the current `.orun/executions/{execID}` store, metadata, and log files. Preserve compatibility with `orun status`, `orun logs`, resume, `--retry`, and legacy migration.
- `RemoteStateBackend`: uses orun-backend HTTP APIs for coordination, heartbeats, terminal updates, run status, and log upload.

The runner should still own step execution, output formatting, GHA rendering, workspace isolation, and retries. Only state coordination and log persistence move behind the backend interface.

---

## Local Filesystem State Requirements

Local state should remain the default and should continue to work without network access.

When multiple local `orun run <planID> --job ...` processes share the same `--exec-id`, local coordination should be best-effort safe:

- Use atomic write/rename for state files.
- Add an advisory lock file around claim/update writes where supported.
- Treat `completed` jobs as already done.
- Treat `failed` dependencies as blocked.
- Wait or report cleanly when dependencies are pending/running.

This keeps local behavior useful for development while remote state remains the production-grade coordination layer for CI.

---

## Remote Flow

For each selected job:

1. Resolve or generate the plan using existing `orun run [component|planhash]` behavior.
2. Compute `planID`.
3. Derive `runID`.
4. Normalize the orun plan into the backend plan contract:
   - `plan.Metadata.Checksum` -> `checksum`
   - `plan.APIVersion` / `plan.Kind` -> `version`
   - `job.ID` -> `jobId`
   - `job.Component` -> `component`
   - `job.DependsOn` -> `deps`
   - map steps into the backend step shape without losing raw plan information needed for execution
   - translate CLI local `"completed"` states to backend `"success"` states at the backend boundary
5. Call `POST /v1/runs` with `{ runId, plan, triggerType, actor, dryRun }`.
6. For each target job, call `POST /v1/runs/{runID}/jobs/{jobID}/claim`.
7. If claimed, execute the job through the existing runner.
8. Send heartbeat every 30 seconds while the job is running.
9. Upload logs.
10. Send terminal update with `runnerId`, `status`, and optional error.

Dependency responses:

| Claim result | CLI behavior |
|--------------|--------------|
| `claimed: true` | Execute the job. |
| `claimed: true, takeover: true` | Execute and mention takeover in verbose output. |
| `claimed: false, currentStatus: "running"` | Poll until the job/dependencies resolve, then retry or exit if another runner completes it. |
| `claimed: false, currentStatus: "success"` | Treat as already complete and exit 0 for that job. |
| `claimed: false, currentStatus: "failed"` | Exit 1. |
| `claimed: false, depsWaiting: true` | Poll `/v1/runs/{runID}/runnable` with backoff, then retry claim. |
| `claimed: false, depsBlocked: true` | Exit 1 with a clear upstream dependency message. |

Use exponential backoff with jitter for dependency polling, starting at 2 seconds and capping at 60 seconds. Default dependency wait timeout: 30 minutes, configurable later.

---

## Backend HTTP Requirements

The backend must support these client calls:

```text
POST /v1/runs
GET  /v1/runs/{runID}
GET  /v1/runs/{runID}/jobs
GET  /v1/runs/{runID}/runnable
POST /v1/runs/{runID}/jobs/{jobID}/claim
POST /v1/runs/{runID}/jobs/{jobID}/heartbeat
POST /v1/runs/{runID}/jobs/{jobID}/update
POST /v1/runs/{runID}/logs/{jobID}
GET  /v1/runs/{runID}/logs/{jobID}
```

`POST /v1/runs` must accept an optional deterministic `runId` in `CreateRunRequest`. If a run already exists for the same namespace/run ID, return the existing run metadata rather than failing.

Update requests must include `runnerId` and be forwarded to the coordinator without dropping it.

Claim responses may use the coordinator-extended shape with optional `depsWaiting` and `depsBlocked`.

---

## Authentication and Config

Resolution order for backend URL:

1. `--backend-url`
2. `ORUN_BACKEND_URL`
3. `intent.yaml` `execution.state.backendUrl`
4. `~/.orun/config.yaml` `backend.url`

Token resolution:

1. In GitHub Actions, request an OIDC token from `ACTIONS_ID_TOKEN_REQUEST_URL` using audience `orun` unless configured otherwise.
2. Outside GitHub Actions, use `ORUN_TOKEN`.
3. Later, `orun login` may store a session token in `~/.orun/config.yaml`.

The Go HTTP client must:

- Set `User-Agent: orun-cli/<version>`.
- Set `Authorization: Bearer <token>` on every request.
- Parse backend `ApiError` JSON bodies.
- Retry idempotent `5xx` responses with exponential backoff.
- Use bounded timeouts: 5 seconds connect, 30 seconds read, 60 seconds log upload.

---

## Status and Logs

`orun status` and `orun logs` should remain local by default.

Add remote-state support with the same activation rules:

```bash
orun status --remote-state --exec-id <runID>
orun logs --remote-state --exec-id <runID> --job <jobID>
```

When `ORUN_REMOTE_STATE=true` or intent remote state is enabled, `status` and `logs` should read from the backend unless `--exec-id` points to a local-only execution.

---

## Acceptance Criteria

For `sourceplane/orun`:

- `orun run` without `--remote-state` is behavior-compatible with the current implementation.
- `orun run <planID> --remote-state` resolves a saved plan by hash prefix and coordinates through orun-backend.
- `orun run <planID> --env dev --remote-state` and `--env stage` can run independently while sharing the same backend run state.
- `--job` with `--remote-state` waits for dependencies instead of failing only because local state is missing them.
- Job runtime IDs include the plan ID and are exposed through environment variables.
- `intent.yaml` can enable remote state.
- Local filesystem state is implemented through the same `StateBackend` interface and preserves status/log/resume compatibility.
- Unit tests cover file state, remote client request/response handling, dependency wait behavior, and ID derivation.
- `go test ./...` passes.

For `sourceplane/orun-backend`:

- `POST /v1/runs` supports deterministic `runId` and idempotent create/join.
- Worker update forwarding includes `runnerId`.
- Worker exposes enough run/job read APIs for `orun status --remote-state` and `orun logs --remote-state`.
- Existing coordinator/storage tests still pass.

For verification:

- Run local checks in each touched repo.
- Use `/Users/irinelinson/.local/bin/kiox -- orun plan --changed` and `/Users/irinelinson/.local/bin/kiox -- orun run --changed` for orun-backend delivery validation when relevant.
- Inspect GitHub Actions logs, including successful jobs, to confirm the expected kiox/orun commands ran.
