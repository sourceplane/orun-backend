# Spec 06 — Storage (`packages/storage`)

## Scope

This package provides typed utility functions for accessing Cloudflare R2 (logs, plans, artifacts) and D1 (dashboard index). It is a shared library used by the Worker. All storage is namespace-isolated.

**Agent task**: Implement `packages/storage/src/r2.ts` and `packages/storage/src/d1.ts`.

---

## R2 Storage (`R2Storage`)

### Path Layout

All R2 paths begin with the `namespace_id`. Agents must use the path utilities from `@orun/types/paths`.

```
{namespaceId}/runs/{runId}/logs/{jobId}.log
{namespaceId}/plans/{checksum}.json
{namespaceId}/snapshots/{runId}.json    (optional: final run state archive)
```

### Interface

```typescript
export class R2Storage {
  constructor(private bucket: R2Bucket) {}

  /** Write job log. Content may be string or ReadableStream. */
  async writeLog(namespaceId: string, runId: string, jobId: string, content: string | ReadableStream): Promise<string>;
  // Returns the R2 key (logRef) for later retrieval

  /** Read job log. Returns null if not found. */
  async readLog(namespaceId: string, runId: string, jobId: string): Promise<R2ObjectBody | null>;

  /** Save immutable plan snapshot. Key = checksum. Idempotent. */
  async savePlan(namespaceId: string, plan: Plan): Promise<string>;
  // Returns the R2 key

  /** Retrieve plan by checksum. Returns null if not found. */
  async getPlan(namespaceId: string, checksum: string): Promise<Plan | null>;

  /** List all log keys for a run (for dashboard use). */
  async listRunLogs(namespaceId: string, runId: string): Promise<string[]>;

  /** Delete all objects for a run (GC). */
  async deleteRun(namespaceId: string, runId: string): Promise<void>;
}
```

### Streaming Logs

The `writeLog` method must accept a `ReadableStream` for large logs:

```typescript
async writeLog(namespaceId: string, runId: string, jobId: string, content: string | ReadableStream): Promise<string> {
  const key = runLogPath(namespaceId, runId, jobId);
  await this.bucket.put(key, content, {
    httpMetadata: { contentType: "text/plain; charset=utf-8" }
  });
  return key;
}
```

### R2 Lifecycle

R2 objects for logs are set with a custom metadata tag `expires-at` so that a scheduled Worker can GC them:

```typescript
await this.bucket.put(key, content, {
  customMetadata: { "expires-at": expiresAt.toISOString() }
});
```

---

## D1 Index (`D1Index`)

D1 is used for **queryable metadata only**. It is not authoritative for execution state.

### Schema Migrations

Migrations are in `migrations/` directory, numbered sequentially. They are applied via `wrangler d1 migrations apply`.

#### `migrations/0001_init.sql`

```sql
CREATE TABLE namespaces (
  namespace_id   TEXT PRIMARY KEY,
  namespace_slug TEXT NOT NULL,
  last_seen_at   TEXT NOT NULL
);

CREATE TABLE runs (
  run_id         TEXT NOT NULL,
  namespace_id   TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending',
  plan_checksum  TEXT,
  trigger_type   TEXT,
  actor          TEXT,
  dry_run        INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  finished_at    TEXT,
  job_total      INTEGER NOT NULL DEFAULT 0,
  job_done       INTEGER NOT NULL DEFAULT 0,
  job_failed     INTEGER NOT NULL DEFAULT 0,
  expires_at     TEXT NOT NULL,
  PRIMARY KEY (namespace_id, run_id)
);

CREATE TABLE jobs (
  job_id         TEXT NOT NULL,
  run_id         TEXT NOT NULL,
  namespace_id   TEXT NOT NULL,
  component      TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending',
  runner_id      TEXT,
  started_at     TEXT,
  finished_at    TEXT,
  log_ref        TEXT,
  PRIMARY KEY (namespace_id, run_id, job_id)
);

CREATE INDEX idx_runs_namespace_status ON runs(namespace_id, status);
CREATE INDEX idx_runs_expires ON runs(expires_at);
CREATE INDEX idx_jobs_run ON jobs(namespace_id, run_id);
```

#### `migrations/0002_namespaces_account.sql`

```sql
CREATE TABLE accounts (
  account_id   TEXT PRIMARY KEY,
  github_login TEXT NOT NULL UNIQUE,
  created_at   TEXT NOT NULL
);

CREATE TABLE account_repos (
  account_id    TEXT NOT NULL,
  namespace_id  TEXT NOT NULL,
  linked_by     TEXT NOT NULL,      -- github login of user who linked
  linked_at     TEXT NOT NULL,
  PRIMARY KEY (account_id, namespace_id),
  FOREIGN KEY (account_id) REFERENCES accounts(account_id),
  FOREIGN KEY (namespace_id) REFERENCES namespaces(namespace_id)
);

CREATE INDEX idx_account_repos_namespace ON account_repos(namespace_id);
```

### D1Index Interface

```typescript
export class D1Index {
  constructor(private db: D1Database) {}

  /** Insert or update namespace slug (called on every OIDC request). */
  async upsertNamespace(namespace: Namespace): Promise<void>;

  /** Create a run record. Called when DO is initialized. */
  async createRun(run: Run): Promise<void>;

  /** Update run status and progress counters. Called after DO state changes. */
  async updateRun(
    namespaceId: string,
    runId: string,
    update: Partial<Pick<Run, "status" | "jobDone" | "jobFailed" | "finishedAt" | "updatedAt">>
  ): Promise<void>;

  /** List recent runs for a set of namespaceIds. Ordered by created_at DESC. */
  async listRuns(namespaceIds: string[], limit?: number, offset?: number): Promise<Run[]>;

  /** Get a single run. */
  async getRun(namespaceId: string, runId: string): Promise<Run | null>;

  /** Upsert a job row (called when job status changes). */
  async upsertJob(job: Pick<Job, "jobId" | "runId" | "namespaceId" | "component" | "status" | "runnerId" | "startedAt" | "finishedAt" | "logRef">): Promise<void>;

  /** List jobs for a run. */
  async listJobs(namespaceId: string, runId: string): Promise<Job[]>;

  /** Delete all rows for expired runs (GC). */
  async deleteExpiredRuns(): Promise<number>;
}
```

### D1 Write Strategy

D1 writes are **fire-and-forget** from the hot path. The Worker calls:

```typescript
ctx.waitUntil(d1Index.createRun(run));
```

This means D1 may briefly lag behind the DO state. This is acceptable because D1 is only for dashboard queries, not execution decisions.

---

## Shared Path Utilities

Implemented in `packages/types/src/paths.ts`:

```typescript
export function runLogPath(namespaceId: string, runId: string, jobId: string): string {
  return `${namespaceId}/runs/${runId}/logs/${jobId}.log`;
}

export function planPath(namespaceId: string, checksum: string): string {
  return `${namespaceId}/plans/${checksum}.json`;
}

export function coordinatorKey(namespaceId: string, runId: string): string {
  return `${namespaceId}:${runId}`;
}
```

---

## GC / Retention Policy

Default: runs expire 24 hours after creation.

The scheduled Worker (defined in the Worker spec) calls:
1. `d1Index.deleteExpiredRuns()` — remove expired D1 rows
2. `r2Storage.deleteRun(namespaceId, runId)` — remove R2 objects

With a linked premium account, retention extends to 30 days (configurable). The `expires_at` field is set at run creation time based on the account's retention policy.

---

## Testing Requirements

- Unit test `R2Storage` methods with mocked `R2Bucket`
- Unit test `D1Index` methods with `@cloudflare/vitest-pool-workers` in-memory D1
- Test namespace isolation: assert that queries always include `WHERE namespace_id = ?`
- Test GC: expired rows deleted, non-expired rows unaffected
- Test path utility functions deterministically
