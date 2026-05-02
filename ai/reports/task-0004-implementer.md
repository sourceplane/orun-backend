# Task 0004 Implementer Report

## Summary

Implemented the `@orun/storage` package with R2Storage (log/plan management) and D1Index (dashboard query index) classes, plus initial D1 migrations. All storage operations enforce namespace isolation, D1 uses prepared statements exclusively, and R2 paths come from `@orun/types/paths`.

## Files Changed

- `packages/storage/src/r2.ts` — R2Storage class (new)
- `packages/storage/src/d1.ts` — D1Index class + IndexedJobInput type (new)
- `packages/storage/src/index.ts` — updated exports
- `packages/storage/src/r2.test.ts` — R2 tests (new)
- `packages/storage/src/d1.test.ts` — D1 tests (new)
- `packages/storage/tsconfig.json` — exclude test files from build
- `packages/coordinator/tsconfig.json` — exclude test files from build (hygiene fix from Task 0003 verifier)
- `migrations/0001_init.sql` — initial schema (new)
- `migrations/0002_namespaces_account.sql` — account/repo linking schema (new)

## R2Storage

All 6 methods implemented:

| Method | Behavior |
|--------|----------|
| `writeLog` | Writes to `runLogPath()`, sets `text/plain` content type, optionally sets `expires-at` custom metadata |
| `readLog` | Returns R2 object body or null |
| `savePlan` | Writes immutable plan JSON to `planPath()` with `application/json` content type |
| `getPlan` | Returns parsed `Plan` or null |
| `listRunLogs` | Lists keys under `{ns}/runs/{runId}/logs/` with pagination |
| `deleteRun` | Deletes all keys under `{ns}/runs/{runId}/` with pagination |

## D1Index

All 8 methods implemented:

| Method | Behavior |
|--------|----------|
| `upsertNamespace` | INSERT ON CONFLICT UPDATE for namespace_slug and last_seen_at |
| `createRun` | Upserts namespace first, then inserts/upserts run row |
| `updateRun` | Dynamic SET clause with only allowed fields, always binds namespace_id + run_id |
| `listRuns` | Filters by namespace_id IN (...), orders by created_at DESC, supports limit/offset |
| `getRun` | Filters by both namespace_id and run_id, joins namespace slug |
| `upsertJob` | INSERT ON CONFLICT UPDATE keyed by (namespace_id, run_id, job_id) |
| `listJobs` | Filters by namespace_id AND run_id |
| `deleteExpiredRuns` | Deletes jobs first, then runs where expires_at <= now, does not touch namespaces/accounts |

## Migrations

- `migrations/0001_init.sql` — namespaces, runs, jobs tables with indexes
- `migrations/0002_namespaces_account.sql` — accounts, account_repos tables with foreign keys and index

Both match spec/07-storage.md schema exactly.

## Tests Added

**R2 tests (18 tests):**
- writeLog writes to exact path, sets content type, handles expiresAt (string and Date), accepts ReadableStream
- readLog returns body or null
- savePlan writes JSON to planPath
- getPlan parses or returns null
- listRunLogs uses correct prefix, handles pagination
- deleteRun deletes only correct prefix keys, handles pagination
- Namespace isolation verified

**D1 tests (23 tests):**
- Migrations exist and contain expected SQL
- upsertNamespace insert and update
- createRun creates namespace + run, idempotent
- updateRun only allowed fields, no-op on empty update
- listRuns filters by namespace, orders DESC, empty list returns [], respects limit/offset
- getRun namespace isolation (cannot read cross-namespace)
- upsertJob insert and update
- listJobs filters by namespace/run, returns deps=[], lastError=null, heartbeatAt=null
- deleteExpiredRuns removes expired runs+jobs, leaves non-expired intact, does not delete namespaces
- SQL namespace isolation verification across all operations

## Checks Run

| Check | Result |
|-------|--------|
| `pnpm exec turbo run typecheck` | ✅ 5/5 packages pass |
| `pnpm exec turbo run build` | ✅ 5/5 packages (Worker 11.79 KiB) |
| `pnpm exec turbo run test` | ✅ 92 tests (16 types + 35 coordinator + 41 storage) |
| `pnpm exec turbo run lint` | ✅ lint deferred (consistent) |
| `wrangler deploy --dry-run` | ✅ Worker builds with all bindings |

## Kiox/Orun Validation

```
kiox -- orun plan --changed → 0 components × 3 envs → 0 jobs
kiox -- orun run --changed  → 0 components × 3 envs → 0 jobs, no jobs to run
```

0 components locally is expected: no `component.yaml` was modified in this PR. CI correctly detects `orun-storage` changes via git diff in the pushed branch (same pattern as Tasks 0002 and 0003).

## Spec Contract Notes

**D1 lossiness for Job fields:**
- The D1 `jobs` table does not store `deps`, `lastError`, or `heartbeatAt` (coordination-only fields that belong in the DO)
- `listJobs` returns `deps: []`, `lastError: null`, `heartbeatAt: null` for all rows
- This is deliberate: D1 is a derived dashboard index, not authoritative execution state

**R2 expiresAt:**
- The `writeLog` method accepts an optional `expiresAt` parameter beyond what the base spec shows, per the task-0004 requirements
- This metadata enables future scheduled GC without extra lookup

## Assumptions

- D1 test approach uses a deterministic fake rather than `@cloudflare/vitest-pool-workers` in-memory D1. The fake validates SQL parameter binding and namespace isolation through recorded SQL and in-memory table state. This avoids adding heavy pool-workers dev dependency while still proving correctness.
- `rowToRun` defaults `triggerType` to `"ci"` and `planChecksum` to `""` for null DB values, since the `Run` type requires non-optional fields.
- `deleteExpiredRuns` deletes jobs first via subquery matching expired runs, then deletes the runs themselves.

## Remaining Gaps

- No real D1 integration test (would need `@cloudflare/vitest-pool-workers` or miniflare setup)
- Lint is deferred (consistent with all prior tasks)
- CI does not run tests for `turbo-package` component type (known from Task 0003 verifier, tests pass locally)

## Next Task Dependencies

- Task 0005 (Auth) is independent, can proceed in parallel
- Task 0006 (Worker API) depends on this package — will import `R2Storage` and `D1Index`
- Task 0007 (Account/Repo Linking) depends on `accounts` and `account_repos` tables from migration 0002

## PR Number

PR #8 — https://github.com/sourceplane/orun-backend/pull/8
