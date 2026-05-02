# Spec 03 — Shared Types Package (`@orun/types`)

## Scope

This spec defines every shared TypeScript type, interface, and enum. This package is a dependency of all other packages. It is **type-only** — no runtime code.

**Agent task**: Implement `packages/types/src/index.ts` with all exports below.

## Current Contract Notes

The current implementation intentionally keeps a small public API contract in `@orun/types` and lets integration packages define narrower internal request/response shapes where needed:

- `ClaimResult` does not expose dependency-specific flags. `packages/coordinator` exports `CoordinatorClaimResult`, which adds optional `depsBlocked` and `depsWaiting` for Worker/CLI coordination.
- `UpdateJobRequest` does not include `runnerId`. `packages/coordinator` exports `CoordinatorUpdateJobRequest`, which requires `runnerId` so the DO can enforce claim ownership.
- The `Plan` type below is the backend-normalized plan contract. The Go `sourceplane/orun` CLI uses `model.Plan` with `metadata.checksum`, job `id`, and `dependsOn`; the CLI remote-state task must normalize those fields to `checksum`, `jobId`, and `deps` before calling the backend.
- Backend `JobStatus` uses `"success"` for terminal success. The current Go CLI local state uses `"completed"`; the remote-state client must translate between those values at the state backend boundary.

---

## Core Domain Types

### Namespace

```typescript
export interface Namespace {
  /** Immutable GitHub repository numeric ID — canonical storage key */
  namespaceId: string;
  /** Human-readable org/repo slug — display only, mutable */
  namespaceSlug: string;
}
```

### Run

```typescript
export type RunStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface Run {
  runId: string;
  namespace: Namespace;
  status: RunStatus;
  planChecksum: string;
  triggerType: "ci" | "manual" | "api";
  actor: string | null;           // GitHub actor who triggered the run
  createdAt: string;              // ISO 8601
  updatedAt: string;
  finishedAt: string | null;
  jobTotal: number;
  jobDone: number;
  jobFailed: number;
  dryRun: boolean;
  expiresAt: string;              // ISO 8601 — when this run's state should be GC'd
}
```

### Job

```typescript
export type JobStatus = "pending" | "running" | "success" | "failed" | "skipped";

export interface Job {
  jobId: string;
  runId: string;
  component: string;             // e.g. "api", "web"
  status: JobStatus;
  deps: string[];                // jobIds this job depends on
  runnerId: string | null;       // which runner claimed this job
  startedAt: string | null;
  finishedAt: string | null;
  lastError: string | null;
  heartbeatAt: string | null;    // last heartbeat from runner
  logRef: string | null;         // R2 path: "runs/{nsId}/{runId}/logs/{jobId}.log"
}
```

### Plan

```typescript
export interface PlanJob {
  jobId: string;
  component: string;
  deps: string[];
  steps: PlanStep[];
}

export interface PlanStep {
  stepId: string;
  uses: string;
  with: Record<string, unknown>;
  timeout?: number;
}

export interface Plan {
  checksum: string;
  version: string;
  jobs: PlanJob[];
  createdAt: string;
}
```

---

## API Request / Response Payloads

### Create Run

```typescript
export interface CreateRunRequest {
  plan: Plan;
  /** Optional deterministic run id used by distributed runners for the same plan. */
  runId?: string;
  dryRun?: boolean;
  triggerType?: "ci" | "manual" | "api";
  actor?: string;
}

export interface CreateRunResponse {
  runId: string;
  status: RunStatus;
  createdAt: string;
}
```

### Claim Job

```typescript
export interface ClaimJobRequest {
  runnerId: string;
}

export type ClaimResult =
  | { claimed: true; takeover?: boolean }
  | { claimed: false; currentStatus: JobStatus };
```

### Update Job

```typescript
export interface UpdateJobRequest {
  status: "success" | "failed";
  error?: string;
}
```

### Heartbeat

```typescript
export interface HeartbeatRequest {
  runnerId: string;
}

export interface HeartbeatResponse {
  ok: boolean;
  /** Runner should stop if true — job was taken over or cancelled */
  abort?: boolean;
}
```

### Get Runnable Jobs

```typescript
export interface RunnableJobsResponse {
  jobs: string[];  // jobIds that are pending AND have all deps satisfied
}
```

### Log Write / Read

```typescript
export interface WriteLogRequest {
  content: string;   // plain text log content
}

export interface ReadLogResponse {
  content: string;
  logRef: string;
}
```

---

## Auth Types

### OIDC Claims (from GitHub Actions JWT)

```typescript
export interface OIDCClaims {
  /** e.g. "sourceplane/orun" */
  repository: string;
  /** GitHub numeric repo ID as string */
  repository_id: string;
  /** e.g. "sourceplane" */
  repository_owner: string;
  /** GitHub org's numeric ID */
  repository_owner_id: string;
  /** GitHub Actions actor */
  actor: string;
  /** OIDC audience */
  aud: string;
  iss: string;
  exp: number;
  iat: number;
}
```

### Session Claims (orun session JWT for UI)

```typescript
export interface SessionClaims {
  sub: string;                        // GitHub user login
  /** Numeric namespace IDs this user may read */
  allowedNamespaceIds: string[];
  exp: number;
  iat: number;
}
```

---

## Error Types

```typescript
export type ErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "INVALID_REQUEST"
  | "INTERNAL_ERROR";

export interface ApiError {
  error: string;
  code: ErrorCode;
}
```

---

## Storage Path Utilities (type-level)

These are pure string functions — no runtime dependencies. Export from `@orun/types/paths`:

```typescript
/** R2 path for a job's log file */
export function runLogPath(namespaceId: string, runId: string, jobId: string): string;

/** R2 path for plan snapshot */
export function planPath(namespaceId: string, checksum: string): string;

/** DO key for a run coordinator */
export function coordinatorKey(namespaceId: string, runId: string): string;
```

---

## Env Interface

```typescript
import type { DurableObjectNamespace, R2Bucket, D1Database } from "@cloudflare/workers-types";

export interface Env {
  COORDINATOR: DurableObjectNamespace;
  STORAGE: R2Bucket;
  DB: D1Database;
  GITHUB_JWKS_URL: string;
  GITHUB_OIDC_AUDIENCE: string;
  ORUN_DEPLOY_TOKEN?: string;
}
```

---

## Package Configuration

```json
{
  "name": "@orun/types",
  "version": "0.1.0",
  "private": true,
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./paths": "./src/paths.ts"
  },
  "dependencies": {
    "@cloudflare/workers-types": "^4.0.0"
  }
}
```

No build step required — other packages import TypeScript directly.
