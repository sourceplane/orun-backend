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
| `POST` | `/v1/runs/:runId/jobs/:jobId/claim` | OIDC | Atomically claim a job |
| `POST` | `/v1/runs/:runId/jobs/:jobId/update` | OIDC | Update job status (success/failed) |
| `POST` | `/v1/runs/:runId/jobs/:jobId/heartbeat` | OIDC | Send heartbeat to prevent abandonment |
| `GET` | `/v1/runs/:runId/jobs` | OIDC or Session | List indexed jobs for status views |
| `GET` | `/v1/runs/:runId/jobs/:jobId/status` | OIDC or Session | Get job status |
| `GET` | `/v1/runs/:runId/runnable` | OIDC | Get list of claimable jobs |

### Logs

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/v1/runs/:runId/logs/:jobId` | OIDC | Upload job log (streamed or full) |
| `GET` | `/v1/runs/:runId/logs/:jobId` | OIDC or Session | Fetch job log content |

### Auth

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/v1/auth/github` | None | Redirect to GitHub OAuth |
| `GET` | `/v1/auth/github/callback` | None | GitHub OAuth callback, issue session JWT |

### Accounts & Repo Linking

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/v1/accounts` | Session | Create a orun account |
| `GET` | `/v1/accounts/me` | Session | Get current account info |
| `POST` | `/v1/accounts/repos` | Session | Link a GitHub repo (admin-only) |
| `GET` | `/v1/accounts/repos` | Session | List linked repos |
| `DELETE` | `/v1/accounts/repos/:namespaceId` | Session | Unlink a repo |

---

## Request Authentication Flow

Every request goes through `authenticate(request, env)` which returns a `RequestContext`:

```typescript
interface RequestContext {
  type: "oidc" | "session";
  namespace: Namespace;              // for OIDC — single namespace from token
  allowedNamespaceIds: string[];     // for session — all accessible namespaces
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
3. Extract `allowedNamespaceIds` from session claims
4. Return `RequestContext` with `type: "session"`

### Namespace Enforcement
Before **any** storage access:
```typescript
function assertNamespaceAccess(ctx: RequestContext, targetNamespaceId: string): void {
  if (ctx.type === "oidc") {
    if (ctx.namespace.namespaceId !== targetNamespaceId) throw forbidden();
  } else {
    if (!ctx.allowedNamespaceIds.includes(targetNamespaceId)) throw forbidden();
  }
}
```

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

The implementation may use any approach (KV sliding window, DO counter, Cloudflare's built-in rate limiting API) — the key constraint is that limits are **per namespace_id** and configurable between free/premium tiers.

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
1. Extract namespace from auth context
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
1. Verify OIDC auth (session tokens may not claim)
2. Enforce namespace access
3. Forward to coordinator: `coordinator.fetch(new Request("/jobs/${jobId}/claim", ...))`
4. Return coordinator response directly

**Response**: `200 ClaimResult`

If `claimed: false`, return `200` not `409` — the runner should interpret the status. The coordinator currently returns the package-local extended shape `CoordinatorClaimResult`, which may include `depsWaiting` or `depsBlocked` in addition to the public `ClaimResult` union.

### `POST /v1/runs/:runId/jobs/:jobId/update`

**Request body**: `{ runnerId: string; status: "success" | "failed"; error?: string }`

**Actions**:
1. Verify OIDC auth
2. Enforce namespace access
3. Forward to coordinator as `CoordinatorUpdateJobRequest`
4. After a successful coordinator response, mirror the job/run summary into D1 with `ctx.waitUntil(...)`

The Worker must not drop `runnerId`; the coordinator uses it to reject updates from a runner that no longer owns the job.

---

### `POST /v1/runs/:runId/logs/:jobId`

**Actions**:
1. Verify OIDC auth
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
  - Rate limit exceeded → 429
  - DO returns `claimed: false`
  - Log upload and retrieval
