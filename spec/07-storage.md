# Spec 07 — Storage (`packages/storage`)

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
  async writeLog(
    namespaceId: string,
    runId: string,
    jobId: string,
    content: string | ReadableStream,
    options?: { expiresAt?: string | Date }
  ): Promise<string>;
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
async writeLog(
  namespaceId: string,
  runId: string,
  jobId: string,
  content: string | ReadableStream,
  options?: { expiresAt?: string | Date }
): Promise<string> {
  const key = runLogPath(namespaceId, runId, jobId);
  const putOptions: R2PutOptions = {
    httpMetadata: { contentType: "text/plain; charset=utf-8" }
  };
  if (options?.expiresAt) {
    putOptions.customMetadata = {
      "expires-at": options.expiresAt instanceof Date
        ? options.expiresAt.toISOString()
        : options.expiresAt
    };
  }
  await this.bucket.put(key, content, putOptions);
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

#### `migrations/0003_cli_sessions.sql`

CLI human login uses Orun-issued refresh tokens so local `orun run --remote-state` can reuse the same backend coordination path as GitHub Actions without storing GitHub PATs or GitHub OAuth access tokens.

```sql
CREATE TABLE cli_sessions (
  session_id                 TEXT PRIMARY KEY,
  account_id                 TEXT NOT NULL,
  github_login               TEXT NOT NULL,
  refresh_token_hash         TEXT NOT NULL UNIQUE,
  allowed_namespace_ids_json TEXT NOT NULL,
  created_at                 TEXT NOT NULL,
  last_used_at               TEXT,
  expires_at                 TEXT NOT NULL,
  revoked_at                 TEXT,
  user_agent                 TEXT,
  device_label               TEXT,
  FOREIGN KEY (account_id) REFERENCES accounts(account_id)
);

CREATE INDEX idx_cli_sessions_account ON cli_sessions(account_id);
CREATE INDEX idx_cli_sessions_expires ON cli_sessions(expires_at);
CREATE INDEX idx_cli_sessions_hash ON cli_sessions(refresh_token_hash);
```

Requirements:

- Store only a cryptographic hash of the refresh token. The raw token is shown once to the CLI.
- `allowed_namespace_ids_json` is a snapshot used to mint short-lived Orun session JWTs without storing GitHub tokens.
- `revoked_at` is set by `orun auth logout`.
- Expired or revoked refresh tokens must not mint access tokens.
- A scheduled GC may delete expired CLI sessions after an audit retention window.

#### Catalog Index Migration

Catalog storage is defined in detail in `spec/12-catalog-index.md`. The storage package must grow a D1 catalog surface that keeps raw immutable payloads in R2 and only queryable metadata in D1.

Add a new migration after the current local namespace migration:

```sql
CREATE TABLE catalog_uploads (
  upload_id       TEXT PRIMARY KEY,
  namespace_id    TEXT NOT NULL,
  repo_id         TEXT NOT NULL,
  repo_full_name  TEXT NOT NULL,
  commit_sha      TEXT NOT NULL,
  branch          TEXT,
  workflow_run_id TEXT,
  workflow_ref    TEXT,
  pr_number       INTEGER,
  envelope_ref    TEXT NOT NULL,
  component_count INTEGER NOT NULL,
  created_at      TEXT NOT NULL,
  FOREIGN KEY (namespace_id) REFERENCES namespaces(namespace_id)
);

CREATE TABLE catalog_components (
  component_id         TEXT PRIMARY KEY,
  namespace_id         TEXT NOT NULL,
  repo_id              TEXT NOT NULL,
  repo_full_name       TEXT NOT NULL,
  name                 TEXT NOT NULL,
  title                TEXT,
  description          TEXT,
  type                 TEXT NOT NULL,
  owner                TEXT,
  system               TEXT,
  lifecycle            TEXT,
  repo_path            TEXT NOT NULL,
  tags_json            TEXT NOT NULL,
  environments_json    TEXT NOT NULL,
  latest_plan_id       TEXT,
  latest_plan_checksum TEXT,
  latest_commit_sha    TEXT NOT NULL,
  latest_status        TEXT NOT NULL DEFAULT 'unknown',
  current_state_ref    TEXT NOT NULL,
  first_seen_at        TEXT NOT NULL,
  last_seen_at         TEXT NOT NULL,
  FOREIGN KEY (namespace_id) REFERENCES namespaces(namespace_id)
);

CREATE TABLE catalog_component_relations (
  relation_id         TEXT PRIMARY KEY,
  source_component_id TEXT NOT NULL,
  relation_type       TEXT NOT NULL,
  target_kind         TEXT NOT NULL,
  target_ref          TEXT NOT NULL,
  environment         TEXT,
  job_id              TEXT,
  last_seen_at        TEXT NOT NULL,
  FOREIGN KEY (source_component_id) REFERENCES catalog_components(component_id)
);

CREATE TABLE catalog_component_events (
  event_id     TEXT PRIMARY KEY,
  component_id TEXT NOT NULL,
  namespace_id TEXT NOT NULL,
  upload_id    TEXT NOT NULL,
  event_type   TEXT NOT NULL,
  commit_sha   TEXT NOT NULL,
  pr_number    INTEGER,
  summary      TEXT,
  payload_ref  TEXT,
  created_at   TEXT NOT NULL,
  FOREIGN KEY (component_id) REFERENCES catalog_components(component_id),
  FOREIGN KEY (upload_id) REFERENCES catalog_uploads(upload_id)
);

CREATE INDEX idx_catalog_components_namespace ON catalog_components(namespace_id, last_seen_at DESC);
CREATE INDEX idx_catalog_components_repo ON catalog_components(repo_id, name);
CREATE INDEX idx_catalog_components_owner ON catalog_components(owner);
CREATE INDEX idx_catalog_components_type ON catalog_components(type);
CREATE INDEX idx_catalog_events_component ON catalog_component_events(component_id, created_at DESC);
CREATE INDEX idx_catalog_relations_target ON catalog_component_relations(target_kind, target_ref);
```

Catalog D1 rows are derived. Replaying the same `upload_id` must be idempotent.

#### Catalog R2 Paths

All catalog R2 paths must start with the effective namespace ID:

```text
{namespaceId}/catalog/uploads/{uploadId}/catalog-sync-envelope.json
{namespaceId}/catalog/commits/{commitSha}/components/{componentName}.json
{namespaceId}/catalog/commits/{commitSha}/plan.json
{namespaceId}/catalog/prs/{number}/component-diff.json
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
  async upsertJob(job: IndexedJobInput): Promise<void>;

  /** List jobs for a run. */
  async listJobs(namespaceId: string, runId: string): Promise<Job[]>;

  /** Delete all rows for expired runs (GC). */
  async deleteExpiredRuns(): Promise<number>;

  /** Create, refresh, and revoke local CLI sessions. */
  async createCliSession(input: CreateCliSessionInput): Promise<CliSession>;
  async getCliSessionByRefreshHash(refreshTokenHash: string): Promise<CliSession | null>;
  async markCliSessionUsed(sessionId: string, usedAt: string): Promise<void>;
  async revokeCliSession(sessionId: string, revokedAt: string): Promise<void>;

  /** Store and query normalized catalog rows. See spec/12-catalog-index.md. */
  async recordCatalogUpload(input: CatalogUploadInput): Promise<CatalogSyncAccepted>;
  async upsertCatalogComponent(input: CatalogComponentUpsert): Promise<void>;
  async replaceCatalogRelations(componentId: string, relations: CatalogRelationInput[]): Promise<void>;
  async listCatalogComponents(filter: CatalogComponentFilter): Promise<CatalogComponentListResponse>;
  async getCatalogComponent(visibleNamespaceIds: string[], componentId: string): Promise<CatalogComponentDetail | null>;
  async listCatalogComponentEvents(visibleNamespaceIds: string[], componentId: string): Promise<CatalogComponentEvent[]>;
  async listCatalogComponentRelations(visibleNamespaceIds: string[], componentId: string): Promise<CatalogComponentRelationsResponse>;
}

export type IndexedJobInput = Pick<
  Job,
  "jobId" | "runId" | "component" | "status" | "runnerId" | "startedAt" | "finishedAt" | "logRef"
> & {
  namespaceId: string;
};
```

`Job` itself does not contain `namespaceId`; callers pass `IndexedJobInput` when writing D1 rows.

`CliSession` is dashboard/account metadata, not execution state. It authorizes a human to obtain short-lived Orun access tokens for local remote-state runs. It must never contain GitHub OAuth access tokens, GitHub PATs, or raw Orun refresh tokens.

The D1 jobs table is a derived dashboard index, not the authoritative coordinator state. It currently stores `job_id`, `run_id`, `namespace_id`, `component`, `status`, `runner_id`, `started_at`, `finished_at`, and `log_ref`. Fields such as `deps`, `lastError`, and `heartbeatAt` are available from the coordinator, not D1; `listJobs()` returns empty/null values for those fields unless a later migration stores them.

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

export function catalogEnvelopePath(namespaceId: string, uploadId: string): string {
  return `${namespaceId}/catalog/uploads/${uploadId}/catalog-sync-envelope.json`;
}

export function catalogComponentStatePath(namespaceId: string, commitSha: string, componentName: string): string {
  return `${namespaceId}/catalog/commits/${commitSha}/components/${componentName}.json`;
}
```

---

## GC / Retention Policy

Default: runs expire 24 hours after creation.

The scheduled Worker (defined in the Worker spec) calls:
1. `d1Index.deleteExpiredRuns()` — remove expired D1 rows
2. `r2Storage.deleteRun(namespaceId, runId)` — remove R2 objects

`deleteExpiredRuns()` must delete jobs by correlated `(namespace_id, run_id)` pairs. Do not use independent `namespace_id IN (...)` and `run_id IN (...)` subqueries, because identical run IDs can exist in different namespaces.

With a linked premium account, retention extends to 30 days (configurable). The `expires_at` field is set at run creation time based on the account's retention policy.

---

## Testing Requirements

- Unit test `R2Storage` methods with mocked `R2Bucket`
- Unit test `D1Index` methods with `@cloudflare/vitest-pool-workers` in-memory D1
- Test namespace isolation: assert that queries always include `WHERE namespace_id = ?`
- Test GC: expired rows deleted, non-expired rows unaffected
- Test path utility functions deterministically
