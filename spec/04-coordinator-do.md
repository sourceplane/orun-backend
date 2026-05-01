# Spec 04 — RunCoordinator Durable Object (`packages/coordinator`)

## Scope

The `RunCoordinator` Durable Object is the heart of distributed job execution. It is the **authoritative source of truth** for a single run's state: which jobs are pending, running, completed, or failed; which runner owns each job; and whether jobs are ready to run based on dependency satisfaction.

**Agent task**: Implement `packages/coordinator/src/coordinator.ts` as a Durable Object class.

One DO instance per run. Key = `coordinatorKey(namespaceId, runId)`.

---

## Data Model (In-Memory + Persistent Storage)

The DO persists state via `this.state.storage` (Durable Object transactional storage). State is loaded on the first request and kept in memory thereafter.

```typescript
interface RunState {
  runId: string;
  namespaceId: string;
  status: "running" | "completed" | "failed" | "cancelled";
  plan: Plan;                    // full plan for dependency resolution
  jobs: Record<string, JobState>;
  createdAt: string;
  updatedAt: string;
}

interface JobState {
  jobId: string;
  component: string;
  status: JobStatus;             // "pending" | "running" | "success" | "failed"
  deps: string[];                // from plan
  runnerId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  lastError: string | null;
  heartbeatAt: string | null;
}
```

The DO **does not store**:
- Log content (R2 only)
- Full step outputs
- Plan steps beyond what is needed for dep resolution

---

## HTTP Interface (Internal, Worker-Facing)

The DO exposes a lightweight internal HTTP API. The Worker calls these URLs via `stub.fetch()`. These are **not** public-facing endpoints.

### `POST /init`

Initialize a new run. Must be idempotent — if already initialized with the same `runId`, return existing state without error.

**Body**:
```typescript
{ plan: Plan; runId: string; namespaceId: string; namespaceSlug: string; }
```

**Response**: `{ ok: true, alreadyExists: boolean }`

**Logic**:
1. If `runState` already exists with this `runId` → return `{ ok: true, alreadyExists: true }`
2. Create `RunState` with all jobs in `"pending"` status (extracted from `plan.jobs`)
3. Persist via `this.state.storage.put("runState", runState)`

---

### `POST /jobs/:jobId/claim`

Atomically claim a job for a runner.

**Body**: `{ runnerId: string }`

**Response**: `ClaimResult`

**Logic (critical — must be exact)**:
```
if job.status === "pending":
  check deps: all deps must have status === "success"
  if any dep has status "failed": return { claimed: false, currentStatus: "pending", depsBlocked: true }
  if any dep not "success": return { claimed: false, currentStatus: "pending", depsWaiting: true }
  
  // Claim the job
  job.status = "running"
  job.runnerId = runnerId
  job.startedAt = now()
  job.heartbeatAt = now()
  persist()
  return { claimed: true }

else if job.status === "running":
  check heartbeat: if now() - heartbeatAt > 300s (5 min):
    // Takeover abandoned job
    job.runnerId = runnerId
    job.heartbeatAt = now()
    persist()
    return { claimed: true, takeover: true }
  else:
    return { claimed: false, currentStatus: "running" }

else:
  return { claimed: false, currentStatus: job.status }
```

---

### `POST /jobs/:jobId/update`

Update a job's terminal status (success or failed).

**Body**: `{ status: "success" | "failed"; error?: string }`

**Response**: `{ ok: true }`

**Logic**:
1. Verify `job.runnerId` matches caller's `runnerId` in body (pass `runnerId` in body)
2. Set `job.status`, `job.finishedAt`, `job.lastError`
3. Recompute `runState.status`:
   - If all jobs `success` → `runState.status = "completed"`
   - If any job `failed` → `runState.status = "failed"`
4. Persist

---

### `POST /jobs/:jobId/heartbeat`

Refresh the heartbeat timestamp to prevent abandonment detection.

**Body**: `{ runnerId: string }`

**Response**: `HeartbeatResponse`

**Logic**:
1. If `job.runnerId !== runnerId` → `{ ok: false, abort: true }` (job was taken over)
2. If `job.status !== "running"` → `{ ok: false, abort: true }` (job was cancelled/completed)
3. Update `job.heartbeatAt = now()`
4. Return `{ ok: true }`

---

### `GET /jobs/:jobId/status`

Return current status of a single job.

**Response**: `{ jobId: string; status: JobStatus; runnerId: string | null; ... }`

---

### `GET /runnable`

Return list of job IDs that are `"pending"` **and** have all dependencies satisfied.

**Response**: `{ jobs: string[] }`

**Logic**:
```
for each job where status === "pending":
  if all job.deps are in "success" status:
    include in result
```

---

### `GET /state`

Return the full `RunState` (used by Worker for dashboard updates to D1).

**Response**: `RunState`

---

### `POST /cancel`

Cancel a running run.

**Body**: `{}`

**Logic**:
1. Set all `"pending"` and `"running"` jobs to `"failed"` with `lastError = "cancelled"`
2. Set `runState.status = "cancelled"`
3. Persist

---

## State Persistence Strategy

The DO uses `this.state.storage.put("runState", runState)` for all mutations. Because DO storage is transactional and the DO is single-threaded, there is no need for optimistic locking.

The full `RunState` is loaded once at startup and cached in memory:

```typescript
export class RunCoordinator implements DurableObject {
  private runState: RunState | null = null;

  constructor(private state: DurableObjectState, private env: Env) {}

  private async loadState(): Promise<RunState | null> {
    if (this.runState !== null) return this.runState;
    this.runState = await this.state.storage.get<RunState>("runState") ?? null;
    return this.runState;
  }

  private async persistState(): Promise<void> {
    if (this.runState) {
      await this.state.storage.put("runState", this.runState);
    }
  }
}
```

---

## DO Alarm (Garbage Collection)

Set an alarm 24 hours after run completion to delete the DO's storage:

```typescript
async function scheduleExpiry(): Promise<void> {
  const alarm = await this.state.storage.getAlarm();
  if (!alarm) {
    await this.state.storage.setAlarm(Date.now() + 24 * 60 * 60 * 1000);
  }
}

async alarm(): Promise<void> {
  await this.state.storage.deleteAll();
}
```

---

## Dependency Resolution Rules

1. A job is **runnable** if: `status === "pending"` AND all deps have `status === "success"`
2. A job is **blocked** if: any dep has `status === "failed"`
3. A job is **waiting** if: any dep has `status === "pending"` or `"running"`
4. A job with no deps is immediately runnable

Cycles are not possible because the orun CLI validates the DAG before creating a run.

---

## Heartbeat Timeout Configuration

- Default abandonment threshold: **300 seconds** (5 minutes)
- Runners send heartbeats every **30 seconds**
- If `now() - heartbeatAt > 300s`, the job is considered abandoned and can be taken over

---

## Testing Requirements

- Unit test the DO class directly (no Worker needed)
- Test cases:
  - `/init` idempotency (call twice with same plan)
  - Successful claim when all deps satisfied
  - Rejected claim when deps not yet complete
  - Rejected claim when another runner holds the job
  - Heartbeat takeover after 5-minute timeout
  - `/update` with `failed` status propagates to `runState.status`
  - `/runnable` returns correct subset
  - Alarm fires and deletes storage
