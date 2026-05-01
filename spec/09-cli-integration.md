# Spec 08 — CLI Integration Contract

## Scope

This spec defines the exact HTTP contract between the **orun CLI** (Go) and the orun-backend (Cloudflare Worker). It is the canonical reference for CLI implementers.

The CLI is a thin execution client. It does not own state — it delegates coordination to the backend.

**Agent task (Go CLI side)**: Implement `internal/backend/remote/client.go` that satisfies this contract.

---

## CLI Modes

| Flag | Behavior |
|------|---------|
| `orun run` (no flag) | Local mode — no HTTP calls, existing behavior unchanged |
| `orun run --remote` | Remote mode — all coordination via backend API |

Environment variable alternative: `ORUN_REMOTE=true orun run`

---

## Configuration

The CLI resolves backend config from (in priority order):
1. `--backend-url` flag
2. `ORUN_BACKEND_URL` env var
3. `~/.orun/config.yaml` field `backend.url`

Local config file (`~/.orun/config.yaml`):

```yaml
backend:
  url: "https://orun-api.<account>.workers.dev"
  # Optional: override defaults
```

---

## Authentication from CLI

### In GitHub Actions (OIDC)

No configuration needed. The CLI auto-detects the GitHub Actions environment via the `ACTIONS_ID_TOKEN_REQUEST_URL` env var and requests an OIDC token:

```go
func getOIDCToken(audience string) (string, error) {
    requestURL := os.Getenv("ACTIONS_ID_TOKEN_REQUEST_URL")
    requestToken := os.Getenv("ACTIONS_ID_TOKEN_REQUEST_TOKEN")
    if requestURL == "" {
        return "", errors.New("not running in GitHub Actions")
    }

    url := fmt.Sprintf("%s&audience=%s", requestURL, url.QueryEscape(audience))
    req, _ := http.NewRequest("GET", url, nil)
    req.Header.Set("Authorization", "Bearer "+requestToken)
    // ... fetch and return .value field from JSON response
}
```

### Local Dev

```
ORUN_TOKEN=<personal token> orun run --remote
```

Or use `orun login` (future) which stores a session token in `~/.orun/config.yaml`.

---

## HTTP Client Requirements

The Go HTTP client must:
- Set `User-Agent: orun-cli/<version>`
- Set `Authorization: Bearer <token>` on every request
- Retry on `5xx` responses with exponential backoff (max 3 retries, starting at 1s)
- Return typed errors for `4xx` responses (parse `ApiError` JSON body)
- Set timeouts: connection 5s, read 30s (60s for log upload)

---

## Flow: `orun run --remote`

This is the primary distributed execution flow, typically invoked once per GitHub Actions job.

```
1. Create run (once per pipeline invocation, not per job)
   POST /v1/runs
   Body: { plan: <plan.json contents>, triggerType: "ci", actor: "<GITHUB_ACTOR>" }
   Response: { runId, status, createdAt }
   Store runId for subsequent calls.

2. Claim job
   POST /v1/runs/{runId}/jobs/{jobId}/claim
   Body: { runnerId: "<unique runner ID, e.g. github runner ID>" }
   Response:
     - { claimed: true } → proceed to execute
     - { claimed: false, currentStatus: "running" } → exit 0 (another runner has it)
     - { claimed: false, currentStatus: "success" } → exit 0 (already done)
     - { claimed: false, currentStatus: "failed" } → exit 1
     - { claimed: false, depsWaiting: true } → poll with backoff (see below)
     - { claimed: false, depsBlocked: true } → exit 1 (upstream failed)

3. Wait for dependencies (if depsWaiting: true)
   GET /v1/runs/{runId}/runnable
   Poll with exponential backoff: 2s, 4s, 8s, 16s, 32s, 60s (max)
   If job appears in runnable list → retry claim
   Max wait: 30 minutes (configurable via --timeout)

4. Start heartbeat goroutine (after successful claim)
   POST /v1/runs/{runId}/jobs/{jobId}/heartbeat  every 30s
   Body: { runnerId: "<runnerId>" }
   If response.abort === true → stop execution, exit 1

5. Execute job locally (existing orun executor logic)
   Collect stdout/stderr output.

6. Upload logs
   POST /v1/runs/{runId}/logs/{jobId}
   Body: plain text log content (stream or full)
   Content-Type: text/plain

7. Update job status
   POST /v1/runs/{runId}/jobs/{jobId}/update
   Body: { status: "success" | "failed", runnerId: "<runnerId>", error?: "<message>" }

8. Stop heartbeat goroutine
```

---

## Runner ID

Each runner generates a unique ID at startup:

```go
runnerId := fmt.Sprintf("runner-%s-%d", os.Getenv("GITHUB_RUN_ID"), os.Getenv("GITHUB_JOB"))
// Fallback for local:
runnerId := fmt.Sprintf("runner-%s", uuid.New().String()[:8])
```

---

## Run ID Coordination

In GitHub Actions matrix builds, all jobs in the same pipeline share one `runId`. The CLI derives the `runId` from the GitHub run context:

```go
func deriveRunID() string {
    // In GitHub Actions: use run ID + attempt number for uniqueness
    if runID := os.Getenv("GITHUB_RUN_ID"); runID != "" {
        attempt := os.Getenv("GITHUB_RUN_ATTEMPT")
        return fmt.Sprintf("gh-%s-%s", runID, attempt)
    }
    // Local: generate once and persist to .orun/current-run-id
    // Read/write .orun/current-run-id
}
```

The first runner to call `POST /v1/runs` initializes the run. Subsequent calls with the same `runId` are idempotent (DO handles this).

---

## Dependency Polling Pseudocode

```go
func waitForClaimable(client *BackendClient, runId, jobId, runnerId string) error {
    backoff := 2 * time.Second
    maxBackoff := 60 * time.Second
    deadline := time.Now().Add(30 * time.Minute)

    for {
        if time.Now().After(deadline) {
            return errors.New("timeout waiting for dependencies")
        }

        runnableJobs, err := client.GetRunnableJobs(runId)
        if err != nil {
            return err
        }

        for _, j := range runnableJobs {
            if j == jobId {
                result, err := client.ClaimJob(runId, jobId, runnerId)
                if err != nil {
                    return err
                }
                if result.Claimed {
                    return nil  // success
                }
            }
        }

        time.Sleep(backoff + jitter(backoff * 0.1))
        backoff = min(backoff*2, maxBackoff)
    }
}
```

---

## Go Client Interface

```go
type BackendClient interface {
    CreateRun(ctx context.Context, plan *model.Plan, opts CreateRunOpts) (*CreateRunResponse, error)
    ClaimJob(ctx context.Context, runId, jobId, runnerId string) (*ClaimResult, error)
    UpdateJob(ctx context.Context, runId, jobId, runnerId, status string, jobErr string) error
    SendHeartbeat(ctx context.Context, runId, jobId, runnerId string) (*HeartbeatResponse, error)
    GetRunnableJobs(ctx context.Context, runId string) ([]string, error)
    UploadLog(ctx context.Context, runId, jobId string, content io.Reader) error
}
```

---

## CLI Exit Codes

| Situation | Exit code |
|-----------|-----------|
| Job completed successfully | 0 |
| Job already claimed by another runner | 0 |
| Job already completed | 0 |
| Dependency blocked (upstream failed) | 1 |
| Job execution failed | 1 |
| Heartbeat received abort | 1 |
| Backend API error (unrecoverable) | 1 |
| Dependency wait timeout | 1 |

---

## `orun status --remote` Contract

Fetches run summary from D1 via the Worker:

```
GET /v1/runs/{runId}
GET /v1/runs/{runId}/jobs (list)  → via GET /v1/runs?runId=...
```

The CLI formats the response in the same style as local `orun status`.

---

## `orun logs --remote` Contract

```
GET /v1/runs/{runId}/logs/{jobId}
```

Streams the response body to stdout.

---

## No Bootstrap in CLI (Phase 1)

In Phase 1, the backend is deployed manually (or via a one-time setup script). The CLI does **not** auto-provision Cloudflare infrastructure. The `--backend-url` must be set.

Bootstrap CLI integration (`orun backend init`) is Phase 3.
