# Task 0003 Implementer Report

## Summary

Replaced the placeholder `RunCoordinator` Durable Object with a production-grade implementation. The coordinator manages the full lifecycle of a single run's execution state: initialization from a plan DAG, atomic job claiming with dependency gating, heartbeat-based abandonment detection and takeover, terminal status updates with run-level status propagation, cancellation, full state inspection, runnable job queries, and alarm-based garbage collection.

## Files Changed

| File | Change |
|------|--------|
| `packages/coordinator/src/coordinator.ts` | Full implementation replacing placeholder |
| `packages/coordinator/src/coordinator.test.ts` | 35 tests covering all required scenarios |
| `packages/coordinator/src/index.ts` | Added type re-exports for `RunState`, `JobState`, `CoordinatorClaimResult`, `CoordinatorUpdateJobRequest` |
| `ai/reports/task-0003-implementer.md` | This report |
| `ai/state.json` | Updated to reflect task-0003 completion |

## Coordinator Endpoints

| Endpoint | Method | Implemented | Notes |
|----------|--------|-------------|-------|
| `/init` | POST | Yes | Idempotent, validates plan DAG, rejects duplicate jobIds and missing deps |
| `/jobs/:jobId/claim` | POST | Yes | Dependency gating with `depsBlocked`/`depsWaiting`, heartbeat takeover at 300s |
| `/jobs/:jobId/update` | POST | Yes | Runner ownership check, run status propagation, expiry alarm scheduling |
| `/jobs/:jobId/heartbeat` | POST | Yes | Timestamp refresh, abort signal for stale/taken-over runners |
| `/jobs/:jobId/status` | GET | Yes | Returns full `JobState` fields |
| `/runnable` | GET | Yes | Returns pending jobs with all deps satisfied, excludes blocked-by-failed |
| `/state` | GET | Yes | Returns full `RunState` |
| `/cancel` | POST | Yes | Marks pending+running as failed with `lastError="cancelled"`, schedules expiry |

## Tests Added

35 tests in `packages/coordinator/src/coordinator.test.ts`:

1. `/init` creates state from a plan
2. `/init` idempotency for same runId
3. `/init` rejects different runId (409)
4. `/init` rejects duplicate jobIds
5. `/init` rejects deps referencing missing jobs
6. `/init` rejects missing required fields
7. `/init` rejects non-array plan.jobs
8. Claim succeeds for dependency-free pending job
9. Claim rejected when deps are waiting (pending/running)
10. Claim rejected when dep failed (depsBlocked)
11. Claim rejected when another runner has fresh heartbeat
12. Claim returns terminal status for completed jobs
13. Claim rejects nonexistent job (404)
14. Claim rejects missing runnerId (400)
15. Claim rejects on uninitialized coordinator (404)
16. Heartbeat updates timestamp for owning runner
17. Heartbeat tells stale owners to abort after takeover
18. Takeover succeeds after 5-minute heartbeat timeout
19. Takeover does not trigger before timeout
20. Update rejected by non-owner
21. Update completes run when all jobs succeed
22. Update propagates failed status to runState
23. Update schedules expiry alarm on completion
24. Update rejected on non-running job
25. `/runnable` returns correct subset
26. `/runnable` excludes jobs blocked by failed deps
27. `/cancel` cancels run and marks pending/running jobs failed with lastError="cancelled"
28. `alarm()` deletes storage and clears in-memory state
29. Concurrent claim: only one runner gets claimed=true
30. `/jobs/:jobId/status` returns job state
31. `/jobs/:jobId/status` returns 404 for unknown job
32. Unknown route returns 404
33. Wrong method on known route returns 400
34. Invalid JSON body returns 400
35. State persists across reloads from storage

Used `vi.useFakeTimers()` / `vi.setSystemTime()` for heartbeat and alarm timing tests. FakeStorage class simulates DO transactional storage.

## Checks Run

| Command | Result |
|---------|--------|
| `pnpm install` | OK |
| `pnpm exec turbo run typecheck` | 5/5 pass |
| `pnpm exec turbo run build` | 5/5 pass |
| `pnpm exec turbo run test` | All pass (16 @orun/types + 35 @orun/coordinator = 51 total) |
| `pnpm exec turbo run lint` | 5/5 pass (deferred) |
| `pnpm --filter @orun/coordinator test` | 35/35 pass |
| `pnpm --filter @orun/types test` | 16/16 pass |
| `cd apps/worker && pnpm exec wrangler deploy --dry-run` | OK — COORDINATOR DO binding present |

## Kiox/Orun Validation

| Command | Result |
|---------|--------|
| `kiox -- orun plan --changed` | 0 components x 3 envs → 0 jobs (expected: only source files changed, no component.yaml changes) |
| `kiox -- orun run --changed` | 0 jobs, auto-scoped to orun-api-worker, "no jobs to run" |

This is expected behavior. The `--changed` flag detects component.yaml changes against the git base. Since this task only modifies files within `packages/coordinator/src/`, and the coordinator package's `component.yaml` was not modified, orun correctly reports no changed components. CI will evaluate the full change set against `origin/main` and should detect the coordinator package changes.

## Spec Contract Notes

### Gap 1: `ClaimResult` missing `depsBlocked`/`depsWaiting`

`@orun/types` defines:
```typescript
export type ClaimResult =
  | { claimed: true; takeover?: boolean }
  | { claimed: false; currentStatus: JobStatus };
```

The coordinator spec (`spec/05-coordinator-do.md`) requires `depsBlocked` and `depsWaiting` flags on claim responses. These flags are not present in `ClaimResult`.

**Resolution**: Defined a package-local `CoordinatorClaimResult` interface in `packages/coordinator/src/coordinator.ts` that includes `depsBlocked` and `depsWaiting` as optional booleans. This is exported for future Worker integration. `@orun/types` was not modified — the gap should be reconciled in a future types update if the Worker API needs to expose these flags to runners.

### Gap 2: `UpdateJobRequest` missing `runnerId`

`@orun/types` defines:
```typescript
export interface UpdateJobRequest {
  status: "success" | "failed";
  error?: string;
}
```

The coordinator spec requires `runnerId` in the update body for runner ownership verification.

**Resolution**: Defined a package-local `CoordinatorUpdateJobRequest` that extends `UpdateJobRequest` with `runnerId: string`. Exported from coordinator package. The ownership check is preserved. `@orun/types` was not modified.

## Assumptions

1. The `DurableObjectState` type from `@cloudflare/workers-types` is available in the typecheck scope via tsconfig `types` array. Verified by successful typecheck.
2. `structuredClone` is available in the test environment (Node.js 20+). Used in `FakeStorage` for deep-copying persisted state.
3. The concurrent claim test (`Promise.all`) validates single-threaded semantics. In production, the DO runtime serializes requests, so only one claim succeeds. In our test, the class method is async but runs synchronously within a single event loop tick, achieving the same effect.
4. `namespaceSlug` is accepted in `/init` but not stored in `RunState` (it is only for display and belongs in the Worker/D1 layer). The Plan and namespaceId are sufficient for coordination.

## Remaining Gaps

1. `@orun/types` `ClaimResult` and `UpdateJobRequest` do not include coordinator-specific fields (`depsBlocked`, `depsWaiting`, `runnerId`). Future Task 0006 (Worker API) should reconcile these when wiring the public API to the coordinator's internal endpoints.
2. No integration test with Miniflare/workerd runtime. Unit tests use a fake storage layer. Full integration testing will come with Task 0006.
3. Wrangler 3.x deprecation warning remains (known from Task 0002).

## Next Task Dependencies

Task 0003 does not block Tasks 0004 (storage) or 0005 (auth) — these are independent per the dependency graph. Task 0006 (Worker API) depends on this task and will wire the public API to the coordinator's internal endpoints.

## PR Number

PR #7 — https://github.com/sourceplane/orun-backend/pull/7
