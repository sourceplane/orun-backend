# Spec 04 — Worker API (`packages/worker`)

## Scope

The Worker is the HTTP API gateway for the orun-backend. It handles:
1. Request authentication (OIDC JWT or session JWT)
2. Namespace extraction and validation
3. Rate limiting
4. Routing to Durable Objects, R2, and D1
5. Response formatting

**Agent task**: Implement `packages/worker/src/index.ts` and supporting modules.

The Worker contains **no business logic** — it delegates to the Coordinator DO, R2Storage, and D1Index utilities.

---

## API Endpoints

All endpoints are prefixed `/v1/`. The Worker returns JSON for all responses.

### Runs

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/v1/runs` | OIDC or Session | Create a new run, initialize a Coordinator DO |
| `GET` | `/v1/runs` | Session | List recent runs for the caller's namespaces |
| `GET` | `/v1/runs/:runId` | OIDC or Session | Get run details |

### Jobs (Coordination — hot path)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/v1/runs/:runId/jobs/:jobId/claim` | OIDC or CLI Session | Atomically claim a job |
| `POST` | `/v1/runs/:runId/jobs/:jobId/update` | OIDC or CLI Session | Update job status (success/failed) |
| `POST` | `/v1/runs/:runId/jobs/:jobId/heartbeat` | OIDC or CLI Session | Send heartbeat to prevent abandonment |
| `GET` | `/v1/runs/:runId/jobs` | OIDC or Session | List indexed jobs for status views |
| `GET` | `/v1/runs/:runId/jobs/:jobId/status` | OIDC or Session | Get job status |
| `GET` | `/v1/runs/:runId/runnable` | OIDC or CLI Session | Get list of claimable jobs |

### Logs

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/v1/runs/:runId/logs/:jobId` | OIDC or CLI Session | Upload job log (streamed or full) |
| `GET` | `/v1/runs/:runId/logs/:jobId` | OIDC or Session | Fetch job log content |

### Auth

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/v1/auth/github` | None | Redirect to GitHub OAuth |
| `GET` | `/v1/auth/github/callback` | None | GitHub OAuth callback, issue session JWT |
| `POST` | `/v1/auth/cli/device/start` | None | Start backend-mediated GitHub device login |
| `POST` | `/v1/auth/cli/device/poll` | None | Poll device login and issue Orun CLI credentials |
| `POST` | `/v1/auth/cli/token` | None | Exchange Orun refresh token for short-lived access token |
| `POST` | `/v1/auth/cli/logout` | None | Revoke Orun CLI refresh token |

### Accounts & Repo Linking

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/v1/accounts` | Session | Create a orun account |
| `GET` | `/v1/accounts/me` | Session | Get current account info |
| `POST` | `/v1/accounts/repos` | Session + `X-GitHub-Access-Token` | Link a GitHub repo (admin-only, dashboard/admin flow) |
| `POST` | `/v1/accounts/repos/link` | CLI Session | Resolve/create the caller's user-scoped local namespace for a repo (no GitHub token required) |
| `GET` | `/v1/accounts/repos` | Session | List linked repos |
| `DELETE` | `/v1/accounts/repos/:namespaceId` | Session | Unlink a repo |

### Catalog

The catalog API supports the dashboard product model in `spec/11-dashboard-ui.md` and the ingestion/indexing contract in `spec/12-catalog-index.md`.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/v1/catalog/sync` | OIDC | Upload a catalog sync envelope for the calling repo namespace |
| `GET` | `/v1/catalog/components` | Session | List visible catalog components across linked repo namespaces |
| `GET` | `/v1/catalog/components/:componentId` | Session | Get a visible component detail record |
| `GET` | `/v1/catalog/components/:componentId/history` | Session | Get component sync/change events |
| `GET` | `/v1/catalog/components/:componentId/runs` | Session | Get recent runs touching the component |
| `GET` | `/v1/catalog/components/:componentId/dependencies` | Session | Get incoming and outgoing component relations |
| `GET` | `/v1/repos/:repoId/components` | Session | List visible components for one repo |

#### `POST /v1/accounts/repos/link`

Allows a local Orun CLI session to resolve the caller's local remote-state namespace for a GitHub repo without sending a GitHub OAuth access token. This endpoint closes the bootstrapping gap for `orun run --remote-state` on developer machines.

This endpoint must **not** return or grant access to the canonical repo namespace. Local runs are owned by the authenticated human user and live in a separate namespace derived server-side from the immutable GitHub user ID and repo ID.

**Request**:
```http
POST /v1/accounts/repos/link
Authorization: Bearer <orun-cli-session-token>
Content-Type: application/json

{ "repoFullName": "owner/repo" }
```

**Response (200)**:
```json
{
  "namespaceKind": "local",
  "namespaceId": "local:user:123456:repo:987654321",
  "namespaceSlug": "local:octocat/owner/repo",
  "repoId": "987654321",
  "repoFullName": "owner/repo",
  "linkedAt": "..."
}
```

**Behavior**:
- Requires `sessionKind="cli"`. Dashboard sessions are rejected with `FORBIDDEN`.
- Validates `repoFullName` format (`owner/repo`).
- Looks up `repoFullName` only in the caller's account-scoped repo cache populated during GitHub OAuth/device login. It must not authorize from the global `namespaces` table alone.
- Computes the local namespace ID as `local:user:<githubUserId>:repo:<repoId>`. Both IDs are numeric GitHub IDs discovered by the backend; clients cannot supply or override them.
- Creates or reuses the local `namespaces` row and the account-local repo link. Idempotent.
- Returns `namespaceKind="local"` so the CLI never confuses this with a canonical repo namespace.
- If the repo slug is unknown to the caller's cache, returns `NOT_FOUND` with guidance to re-run `orun auth login`. A future explicit repo-allow policy may add repo access checks, but the first secure version must prefer a clear relogin/error over slug-based authorization.

The existing `POST /v1/accounts/repos` with `X-GitHub-Access-Token` is unchanged and still used by dashboard/admin flows.

---

## Namespace Kinds and Trust Boundaries

The Worker has two production namespace kinds:

| Kind | Namespace ID | Who can write | Purpose |
|------|--------------|---------------|---------|
| `repo` | GitHub `repository_id` from verified OIDC | GitHub Actions OIDC for that repo only | CI/workload remote-state and future repo-scoped SaaS dispatch |
| `local` | `local:user:<githubUserId>:repo:<repoId>` | The matching CLI user session only | Developer-machine remote-state sandbox |

```typescript
interface Namespace {
  kind: "repo" | "local";
  namespaceId: string;
  namespaceSlug: string;
}
```

Canonical repo namespaces are workload identity. They are only valid when the Worker has verified a GitHub Actions OIDC token whose `repository_id` and `repository` claims match the target repo. A local OAuth/device session never writes into a canonical repo namespace, even when the human is an admin of that repo.

Local namespaces are human identity. They let a developer exercise the same Durable Object, R2, D1, claim, dependency, heartbeat, status, and log paths from a laptop without mixing state with GitHub Actions. Local runs for two different users on the same repo intentionally do not collide:

```text
local:user:111:repo:987654321
local:user:222:repo:987654321
```

Security requirements:

- The backend must capture the immutable numeric GitHub user ID during OAuth/device login and include it in signed CLI session claims.
- The backend must cache `(account_id, repo_id, repo_full_name)` from GitHub while the OAuth token is available. Local namespace resolution uses this account-scoped cache, not a globally guessable slug table.
- Clients may send `repoFullName` to ask the backend to resolve a local namespace. If a client sends `namespaceId`, it is treated as advisory and must exactly equal the server-derived local namespace for that session and repo.
- No authenticated user session can create, link, claim, update, upload logs, or otherwise mutate a canonical repo namespace. Future repo-delegated local execution requires an explicit policy table and is out of scope for this design.

---

## Request Authentication Flow

Every request goes through `authenticate(request, env)` which returns a `RequestContext`:

```typescript
interface RequestContext {
  type: "oidc" | "session";
  sessionKind?: "dashboard" | "cli";
  namespace?: Namespace;             // for OIDC: canonical repo namespace from token
  accountId?: string;                // for session
  githubUserId?: string;             // for CLI session, immutable numeric GitHub user ID
  githubLogin?: string;              // for display/audit only
  actor: string;
}
```

### OIDC Token Flow
1. Extract `Authorization: Bearer <jwt>` header
2. Fetch JWKS from `env.GITHUB_JWKS_URL` (cache for 15 min in KV or memory)
3. Verify JWT signature, expiry, issuer (`https://token.actions.githubusercontent.com`), audience (`env.GITHUB_OIDC_AUDIENCE`)
4. Extract `repository_id` and `repository` from claims
5. Return `RequestContext` with `type: "oidc"`

### Session Token Flow
1. Extract `Authorization: Bearer <jwt>` header
2. Verify signature against `ORUN_SESSION_SECRET` (Workers secret)
3. Extract `accountId`, immutable `githubUserId`, display `githubLogin`, and optional `sessionKind` from session claims
4. Dashboard sessions are read-oriented. CLI sessions may use mutable coordination routes only through local namespaces owned by that user.
5. Return `RequestContext` with `type: "session"`

### Local Remote-State CLI Flow

When `orun run --remote-state` is run outside GitHub Actions, the CLI authenticates a human through GitHub OAuth/device login and sends an Orun access token:

```text
Authorization: Bearer <orun session JWT with sessionKind="cli">
```

This is allowed on mutable coordination routes so local developers can exercise the same backend coordination machinery used by GitHub Actions. The Worker must still enforce namespace access against the run namespace and must record the human actor on run/job metadata.

Dashboard sessions must remain read-oriented and must not be allowed to claim, update, heartbeat, or upload logs. If the Worker cannot distinguish dashboard from CLI sessions, it must reject session tokens on mutable coordination routes until the CLI session token shape is implemented.

For local remote-state, the CLI sends the detected `repoFullName` when creating a run or first calls `POST /v1/accounts/repos/link`. The Worker derives the local namespace from the signed session's `githubUserId` and the backend-cached GitHub `repoId`. The CLI never receives authority to pick a canonical repo namespace.

### Namespace Enforcement
Before **any** storage access:
```typescript
async function assertNamespaceAccess(ctx: RequestContext, targetNamespace: Namespace): Promise<void> {
  if (ctx.type === "oidc") {
    if (targetNamespace.kind !== "repo") throw forbidden();
    if (ctx.namespace?.namespaceId !== targetNamespace.namespaceId) throw forbidden();
    return;
  }

  if (ctx.sessionKind !== "cli") throw forbidden();
  if (targetNamespace.kind !== "local") throw forbidden();
  if (!targetNamespace.namespaceId.startsWith(`local:user:${ctx.githubUserId}:repo:`)) throw forbidden();
}
```

Read-oriented dashboard APIs may additionally expose repo namespaces linked through `account_repos`, but that read policy must not be reused on mutable coordination routes.

---

## Rate Limiting

Rate limiting runs **before** routing. Implemented using a DO counter or KV:

```typescript
async function rateLimit(namespaceId: string, env: Env): Promise<void> {
  // Use KV or a lightweight DO counter keyed by namespaceId
  // Default: 5 req/s, burst 20
  // Premium: checked against D1 account_repos table
  // If exceeded: throw ApiError("RATE_LIMITED")
}
```

The implementation may use any approach (KV sliding window, DO counter, Cloudflare's built-in rate limiting API) — the key constraint is that limits are keyed by the effective namespace ID. GitHub Actions traffic is limited by canonical repo namespace; local CLI traffic is limited by the user-scoped local namespace or by account ID for auth/link endpoints.

---

## Routing Implementation

The Worker uses a simple router (agents may use `itty-router`, `hono`, or a hand-rolled pattern matcher):

```typescript
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const authCtx = await authenticate(request, env);
    await rateLimit(authCtx.namespace.namespaceId, env);

    const url = new URL(request.url);
    const { method } = request;
    const path = url.pathname;

    // Route to handler functions
  }
}
```

---

## DO Routing

Runs and jobs are routed to the appropriate `RunCoordinator` DO instance:

```typescript
function getCoordinator(env: Env, namespaceId: string, runId: string): DurableObjectStub {
  const key = coordinatorKey(namespaceId, runId); // "{namespaceId}:{runId}"
  const id = env.COORDINATOR.idFromName(key);
  return env.COORDINATOR.get(id);
}
```

The Worker forwards relevant requests as sub-requests to the DO's `fetch` method.

---

## Handler Contracts

### `POST /v1/runs`

**Request body**: `CreateRunRequest`

**Actions**:
1. Resolve the effective namespace:
   - OIDC: derive the canonical repo namespace from verified token claims. If the request includes a namespace ID, it must match the OIDC-derived repo namespace exactly.
   - CLI session: require `repoFullName` or a previously returned local namespace reference. Resolve `repoFullName` in the caller's account repo cache and derive `local:user:<githubUserId>:repo:<repoId>`. Reject any canonical repo namespace ID supplied by a session token.
2. Use `body.runId` when supplied, otherwise generate `runId` = `nanoid()` or `crypto.randomUUID()`
3. Call `coordinator.fetch(new Request("/init", { method: "POST", body: JSON.stringify({ plan, runId, namespaceId: namespace.namespaceId, namespaceSlug: namespace.namespaceSlug }) }))`
4. Write run row to D1 via `D1Index.createRun(run)`
5. Optionally store plan in R2 via `R2Storage.savePlan(namespace.namespaceId, plan)`

**Response**: `201 CreateRunResponse`

When `runId` is client-supplied, creation must be idempotent for the same namespace/run pair. This is required for `orun run <plan-ref> --remote-state` in matrix jobs where several runners may initialize the same run concurrently.

---

### `POST /v1/runs/:runId/jobs/:jobId/claim`

**Request body**: `ClaimJobRequest`

**Actions**:
1. Verify OIDC auth or CLI session auth (dashboard sessions may not claim)
2. Enforce namespace access
3. Forward to coordinator: `coordinator.fetch(new Request("/jobs/${jobId}/claim", ...))`
4. Return coordinator response directly

**Response**: `200 ClaimResult`

If `claimed: false`, return `200` not `409` — the runner should interpret the status. The coordinator currently returns the package-local extended shape `CoordinatorClaimResult`, which may include `depsWaiting` or `depsBlocked` in addition to the public `ClaimResult` union.

### `POST /v1/runs/:runId/jobs/:jobId/update`

**Request body**: `{ runnerId: string; status: "success" | "failed"; error?: string }`

**Actions**:
1. Verify OIDC auth or CLI session auth (dashboard sessions may not update)
2. Enforce namespace access
3. Forward to coordinator as `CoordinatorUpdateJobRequest`
4. After a successful coordinator response, mirror the job/run summary into D1 with `ctx.waitUntil(...)`

The Worker must not drop `runnerId`; the coordinator uses it to reject updates from a runner that no longer owns the job.

---

### `POST /v1/runs/:runId/logs/:jobId`

**Actions**:
1. Verify OIDC auth or CLI session auth (dashboard sessions may not upload logs)
2. Read request body as text stream
3. Write to R2 via `R2Storage.writeLog(namespaceId, runId, jobId, body, { expiresAt })`
4. Update D1 `jobs` row with `logRef`

**Response**: `200 { ok: true }`

---

### `GET /v1/runs/:runId/logs/:jobId`

**Actions**:
1. Verify auth (OIDC or session)
2. Fetch from R2: `env.STORAGE.get(runLogPath(namespaceId, runId, jobId))`
3. Stream R2 object body as response

**Response**: `200` with `Content-Type: text/plain` and streamed body

---

### `POST /v1/catalog/sync`

**Request body**: `CatalogSyncEnvelope`

**Actions**:
1. Require verified GitHub Actions OIDC. Reject dashboard sessions and CLI sessions.
2. Require `envelope.source.repoId` to equal the OIDC `repository_id` claim and `envelope.source.repo` to equal the OIDC `repository` claim.
3. Validate supported `schemaVersion`, bounded body size, non-empty `uploadId`, non-empty commit SHA, and component paths that are relative paths inside the repo.
4. Upsert the canonical repo namespace as `kind: "repo"`.
5. Store the raw envelope in R2 using the catalog path helpers from `spec/12-catalog-index.md`.
6. Normalize component, relation, upload, and event rows into D1. The first implementation may do this synchronously or with `ctx.waitUntil`; do not add a Queue binding until a queue task exists.
7. Treat duplicate `uploadId` as idempotent success.

**Response**: `202 { uploadId: string; acceptedAt: string; componentCount: number }`

---

### Catalog read endpoints

**Actions**:
1. Require a dashboard or read-capable session.
2. Resolve visible canonical repo namespace IDs from the caller's linked repos.
3. Query only catalog rows whose `namespace_id` is in that visible set.
4. Return typed response envelopes from `@orun/types`.

Catalog reads must not expose local CLI namespaces by default. Local namespaces are for laptop remote-state experiments and are not part of the canonical software catalog.

---

## Error Handling

Every handler is wrapped in a try-catch. Errors are formatted as `ApiError`:

```typescript
function handleError(err: unknown): Response {
  if (err instanceof OrunError) {
    return Response.json({ error: err.message, code: err.code }, { status: err.httpStatus });
  }
  console.error("Unexpected error", err);
  return Response.json({ error: "Internal server error", code: "INTERNAL_ERROR" }, { status: 500 });
}
```

HTTP status mapping:
- `UNAUTHORIZED` → 401
- `FORBIDDEN` → 403
- `NOT_FOUND` → 404
- `RATE_LIMITED` → 429
- `CONFLICT` → 409
- `INVALID_REQUEST` → 400
- `INTERNAL_ERROR` → 500

---

## CORS

For browser-initiated requests (UI):

```typescript
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",   // Restrict to known UI domain in production
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};
```

---

## Scheduled Worker

A `scheduled` handler runs every 15 minutes to:
1. Find runs in D1 where `status = 'running'` and `expires_at < NOW()`
2. Call coordinator to mark them as `cancelled`
3. Remove expired D1 rows

```typescript
export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    // GC expired runs
  }
}
```

---

## Testing Requirements

- Unit test: Each handler function with mocked DO/R2/D1
- Integration test: Full Worker lifecycle using `@cloudflare/vitest-pool-workers`
- Test cases must cover:
  - Valid OIDC claim + successful job claim
  - Cross-namespace access → 403
  - CLI session create derives a local namespace from `githubUserId` + `repoId`
  - CLI session cannot create, claim, update, heartbeat, or upload logs under a canonical repo namespace
  - Two CLI users targeting the same repo receive different local namespaces
  - Repo slug guessing does not work when the repo is absent from the caller's account-scoped cache
  - Rate limit exceeded → 429
  - DO returns `claimed: false`
  - Log upload and retrieval
  - Catalog sync rejects repo ID/repo slug mismatches
  - Catalog sync rejects dashboard and CLI session writes
  - Catalog sync is idempotent by `uploadId`
  - Catalog reads only return components from linked canonical repo namespaces
