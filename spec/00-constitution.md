# orun-backend — Architectural Constitution

## What This Is

orun-backend is the cloud control plane for the [orun CLI](https://github.com/sourceplane/orun) — a policy-aware workflow compiler that turns CI/CD intents into executable plan DAGs.

When multiple GitHub Actions runners execute `orun run <plan-id> --remote-state` concurrently, they need a shared coordination layer: to claim jobs atomically, check dependency status, and report results. This backend provides that coordination layer, hosted entirely on Cloudflare.

---

## Non-Negotiable Architectural Principles

These are hard constraints. Every implementation decision must respect them. Coding agents may choose their implementation approach freely except where these principles apply.

### 1. Durable Objects are the Source of Truth for Execution State

Execution state (job status, run progress, coordination) lives **only** in Durable Objects. It is never duplicated into R2, D1, or any other store as the authoritative copy.

- **Correct**: DO holds job statuses. D1 holds an eventually-consistent index for queries.
- **Incorrect**: Storing `ExecState` blobs in R2 that runners load/save. This reintroduces race conditions.
- **Why**: DOs are single-threaded per key. No CAS, no retries, no race conditions. This is the whole point.

### 2. One Durable Object Per Run

DO instance key = `runId`. Never create a global scheduler DO or a per-job DO.

- **Correct**: `env.COORDINATOR.idFromName(runId)` routes all coordination for a run to one DO instance.
- **Incorrect**: A global DO that manages all runs (single-threaded bottleneck).
- **Why**: Natural sharding. 1,000 concurrent runs = 1,000 independent DOs.

### 3. R2 is Append-Only Storage (Not State)

R2 stores logs, artifacts, and immutable plan snapshots. It is never polled for coordination signals.

- **Correct**: After a job completes, stream logs to `R2: runs/{namespace_id}/{runId}/logs/{jobId}.log`.
- **Incorrect**: Polling R2 job files to discover run status. S3-style polling introduces contention and cost.
- **Why**: R2 has no native locking. Polling creates read amplification and eventual consistency hazards.

### 4. D1 is a Derived Index (Not Authoritative)

D1 rows are written *after* DO state transitions, not instead of them. D1 is used for dashboard queries only.

- **Correct**: After DO claims job, Worker writes a summary row to D1 asynchronously.
- **Incorrect**: Checking D1 to decide whether a job can be claimed.
- **Why**: D1 may lag behind real-time DO state. Authoritative decisions must use the DO.

### 5. Identity = `repository_id`, Not `org/repo`

The canonical namespace for all storage is GitHub's **numeric repository ID** (`repository_id`), not the human-readable slug. The slug is stored alongside for display only and updated lazily.

- **Correct**: `namespace_id = "123456789"`, `namespace_slug = "sourceplane/orun"`.
- **Incorrect**: Using `sourceplane/orun` as the storage key. Repo renames and transfers will break history.
- **Why**: `repository_id` is immutable. Org renames, repo renames, and transfers do not change it.

### 6. GitHub is the Only Identity Provider

There are no custom users, passwords, or independent accounts. All identity derives from GitHub:

- **CI writes**: GitHub Actions OIDC JWT, verified by the Worker against GitHub's JWKS endpoint.
- **UI reads**: GitHub OAuth2 flow, yielding a short-lived session token scoped to `allowed_namespace_ids`.
- **Why**: Eliminates an entire auth surface. Repo access control is delegated to GitHub's proven permissions model.

### 7. Accounts are Visibility Overlays, Not Data Owners

Data is always written under `namespace_id = repository_id`. orun accounts only add visibility (linking a repo to an account for dashboard access) and optionally unlock higher rate limits or retention.

- **Correct**: CI creates runs under `repository_id`. User creates account. User links repo. Dashboard shows historical runs.
- **Incorrect**: Switching write path to `account_id` when an account exists. This fragments history and creates migration nightmares.
- **Why**: Seamless upgrade path. Users see all historical runs the moment they link a repo.

### 8. All Storage is Namespace-Isolated

Every storage access is scoped by `namespace_id`. No query or operation crosses namespace boundaries.

```
R2:  runs/{namespace_id}/{runId}/...
D1:  WHERE namespace_id = ?
DO:  key = "{namespace_id}:{runId}"
```

The Worker enforces this at every handler before any storage access is allowed.

### 9. Workers are Thin API Gateways

Workers handle: auth verification, namespace extraction, rate limiting, routing to DO/R2/D1. They contain no business logic beyond routing.

- **Correct**: Worker extracts namespace from JWT, calls `DO.claimJob(jobId, runnerId)`, returns result.
- **Incorrect**: Worker reimplements job claiming logic inline without using DO.

### 10. Never Store Secrets or Sensitive Pipeline Outputs

Logs may contain secret values printed by user scripts. The platform:
- Must warn users not to print secrets in logs.
- Must never store GitHub tokens, API keys, or pipeline secrets as first-class data.
- In future: support optional client-side encryption for logs.

### 11. All CI/CD Delivery Uses the Tectonic Stack

Every deployable unit and shared package must be wired to the [tectonic stack](https://github.com/sourceplane/stack-tectonic) composition catalog. No custom GitHub Actions workflows are written for build, typecheck, or deploy steps — these are provided by tectonic compositions.

- **Correct**: `apps/worker/component.yaml` declares `type: cloudflare-worker-turbo`; the tectonic stack composition runs build, typecheck, and deploy.
- **Incorrect**: A bespoke `.github/workflows/deploy-worker.yml` that re-implements install → build → typecheck → wrangler deploy.
- **Why**: Tectonic compositions are versioned, tested, and maintained centrally. One-off workflows drift, break, and accumulate security debt. All CI/CD logic changes flow through `intent.yaml` version bumps, not per-repo workflow edits.

**Mandatory files at the monorepo root**:
- `intent.yaml` — declares `stack-tectonic` as the OCI composition source, lists discovery roots, and defines environments.
- `kiox.yaml` — pins the orun runtime version.

**Mandatory file per deliverable unit** (every `apps/*` and every `packages/*` that participates in tectonic delivery):
- `component.yaml` — declares the composition type (`cloudflare-worker-turbo`, `turbo-package`, etc.), subscribed environments, and inputs.

See `spec/01-monorepo-structure.md` for canonical examples of each file.

---

## Technology Decisions

| Concern | Technology | Reason |
|---------|-----------|--------|
| API layer | Cloudflare Workers (TypeScript) | Stateless, edge-global, zero cold start |
| Coordination | Cloudflare Durable Objects | Single-threaded per key = atomic job claiming |
| Logs/Artifacts | Cloudflare R2 | S3-compatible, zero egress cost, edge-accessible |
| Dashboard index | Cloudflare D1 (SQLite) | Native Workers integration, simple SQL |
| Runtime cache | Cloudflare KV (optional) | Permission caching, rate limit counters |
| Language | TypeScript | Workers native, strong types across packages |
| Monorepo | pnpm + Turborepo | pnpm workspaces for dependency management; Turbo for build/typecheck orchestration with caching |
| CI/CD delivery | Tectonic stack (`oci://ghcr.io/sourceplane/stack-tectonic`) | Versioned composition catalog; compositions handle all build/deploy logic via `component.yaml` declarations |

---

## Security Model

### Threat Model

| Threat | Mitigation |
|--------|-----------|
| Runner claims another repo's job | OIDC namespace enforced at Worker; DO keyed by `{namespace_id}:{runId}` |
| User reads another org's logs | OAuth session scoped to `allowed_namespace_ids`; D1/R2 always filtered by namespace |
| Malicious OIDC token | Signature verified against `https://token.actions.githubusercontent.com/.well-known/jwks` |
| Expired session | Short-lived tokens (1h), re-checked against GitHub API |
| Cloudflare account compromise | Namespace isolation limits blast radius; future: opt-in E2EE for logs |
| Repo transfer giving old owner access | GitHub API re-checked on each UI session; `repository_id` stays the same, but org membership is re-verified |

### Auth Header Protocol

```
CI runners:    Authorization: Bearer <GitHub OIDC JWT>
UI clients:    Authorization: Bearer <orun session JWT>
Bootstrap:     X-Orun-Deploy-Token: <CF API token>  (setup only, never in hot path)
```

---

## Rate Limiting

Default limits (no account):
- Max concurrent jobs per namespace: 10
- API requests per second per namespace: 5

Premium limits (account with paid plan):
- Configurable or unlimited

Enforcement: Durable Object counter per namespace (or KV), checked in the Worker before routing.

---

## Data Retention

Default: 24 hours (DO TTL via scheduled Workers + R2 lifecycle rules)  
With account: configurable (up to 30 days default)

DO instances are ephemeral; once a run completes and state is snapshotted to D1, the DO can be garbage-collected.

---

## API Versioning

All endpoints are prefixed `/v1/`. Breaking changes require a new version prefix. The Worker routes both simultaneously during migration windows.

---

## Monorepo Package Contracts

These cross-package contracts must be honored by all implementations:

### Type Exports (`packages/types`)
Every package imports shared types from `@orun/types`. No package duplicates these types.

### Error Format
All API errors return:
```json
{
  "error": "string describing what went wrong",
  "code": "SNAKE_CASE_ERROR_CODE"
}
```

### Log Format
Structured JSON logs emitted by Workers via `console.log()`:
```json
{
  "level": "info|warn|error",
  "msg": "...",
  "namespace_id": "...",
  "run_id": "...",
  "ts": "ISO8601"
}
```
