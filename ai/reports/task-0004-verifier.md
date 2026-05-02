# Task 0004 Verifier Report

## Result
PASS (with verifier-approved fix)

## Checks

| # | Criterion | Command / File | Result | Notes |
|---|-----------|----------------|--------|-------|
| 1 | R2Storage implements all required methods | `packages/storage/src/r2.ts` | ✅ PASS | writeLog, readLog, savePlan, getPlan, listRunLogs, deleteRun — all 6 present |
| 2 | D1Index implements all required methods | `packages/storage/src/d1.ts` | ✅ PASS | upsertNamespace, createRun, updateRun, listRuns, getRun, upsertJob, listJobs, deleteExpiredRuns — all 8 present |
| 3 | Migrations match intended schema | `migrations/0001_init.sql`, `0002_namespaces_account.sql` | ✅ PASS | Exact match with spec/07-storage.md schema |
| 4 | All storage operations namespace-isolated | Source inspection | ✅ PASS | All R2 keys prefixed with namespaceId; all D1 queries filter by namespace_id |
| 5 | D1 writes use prepared statements | Source inspection | ✅ PASS | All queries use `.prepare()` + `.bind()` |
| 6 | R2 path utilities from @orun/types/paths | `r2.ts` line 2 | ✅ PASS | `import { runLogPath, planPath } from "@orun/types/paths"` |
| 7 | R2 and D1 tests cover required cases | `r2.test.ts`, `d1.test.ts` | ✅ PASS | 18 R2 tests, 24 D1 tests (42 total) |
| 8 | @orun/types and @orun/coordinator tests pass | `pnpm exec turbo run test` | ✅ PASS | 16 types + 35 coordinator + 42 storage = 93 tests pass |
| 9 | Worker dry-run build succeeds | `cd apps/worker && pnpm exec wrangler deploy --dry-run` | ✅ PASS | 11.79 KiB, all bindings present |
| 10 | No out-of-scope behavior | `rg "RunCoordinator\|auth\|OAuth\|OIDC\|rateLimit" packages/storage/src` | ✅ PASS | Only `account`/`repo` matches are migration schema tests — acceptable |
| 11 | deleteExpiredRuns cross-namespace bug | Verifier fix applied | ✅ FIXED | SQL changed to correlated EXISTS; new test added |
| 12 | Local kiox/orun validation attempted | `kiox -- orun plan --changed` | ✅ PASS | 0 components locally — expected (no component.yaml changes); CI proves orun-storage ran |
| 13 | Full turbo typecheck | `pnpm exec turbo run typecheck` | ✅ PASS | 5/5 packages, FULL TURBO cache hit |
| 14 | Full turbo build | `pnpm exec turbo run build` | ✅ PASS | 5/5 packages, FULL TURBO cache hit |
| 15 | No `any` in storage source | `rg "\bany\b" packages/storage/src` | ✅ PASS | Only match is `expect.any(Object)` in test — vitest matcher, not TypeScript `any` |
| 16 | Package exports correct | `packages/storage/src/index.ts` | ✅ PASS | Exports R2Storage, D1Index, IndexedJobInput |
| 17 | Storage tsconfig excludes test files | `packages/storage/tsconfig.json` | ✅ PASS | `"src/**/*.test.ts"` in exclude |
| 18 | Coordinator tsconfig test-exclude hygiene | `packages/coordinator/tsconfig.json` | ✅ PASS | `"src/**/*.test.ts"` added per Task 0003 verifier recommendation |
| 19 | CI green on head SHA | `gh pr checks 8` | ✅ PASS | Run 25241213120, both jobs SUCCESS |

## CI Logs Reviewed

**Workflow run**: `25241213120`
**Branch**: `codex/task-0004-storage`
**Head SHA evaluated**: `bc0ab3457e46df97b1a966a0e23652e06c7f3076` (PR head at verification time)
**Conclusion**: success

### Review Plan job (`74017317397`) — SUCCESS (5s)
- `sourceplane/kiox-action@v2.1.2` installed kiox v0.4.3 ✅
- `kiox -- orun plan --changed` ran in "Compile review-scoped plan" step ✅
- Output: **`2 components × 3 envs → 6 jobs`**, **`components: orun-coordinator, orun-storage`** ✅
- Plan `0c90ccf30e8f` compiled without error ✅

### Build & Deploy job (`74017317410`) — SUCCESS (55s)
- `kiox -- orun run --changed` ran in "Execute" step ✅
- `orun-storage` and `orun-coordinator` detected as changed components ✅
- `verify-turbo-package` ran for `orun-storage` in all 3 envs (dev, staging, production) ✅
- Steps: setup-node, setup-pnpm, install-workspace-dependencies, pre-build, verify-package-structure, build-package, typecheck-package ✅
- `@orun/types` + `@orun/storage` build ran (cache miss, both fresh) ✅
- `@orun/types` + `@orun/storage` typecheck ran (cache miss, both fresh) ✅
- No live Cloudflare production deploy triggered ✅

**Known CI limitation**: `verify-turbo-package` component type does not run tests. Storage tests (42) pass locally. Consistent with Task 0002/0003 behavior.

**Warnings (non-blocking)**:
- Node.js 20 actions deprecation (deadline 2026-06-02, same as prior tasks)
- pnpm 10.12.1 (10.33.2 available) — non-blocking

## Code Review Notes

### R2Storage
- `writeLog`: uses `runLogPath()` from `@orun/types/paths` ✅; sets `text/plain; charset=utf-8` ✅; handles `expiresAt` as string or Date ✅; returns key ✅
- `readLog`: returns `R2ObjectBody | null` via `bucket.get(key)` ✅
- `savePlan`: uses `planPath()` ✅; sets `application/json; charset=utf-8` ✅; returns key ✅
- `getPlan`: returns `null` when missing, parses JSON via `obj.json()` ✅
- `listRunLogs`: prefix `${namespaceId}/runs/${runId}/logs/` ✅; paginated do/while loop ✅
- `deleteRun`: prefix `${namespaceId}/runs/${runId}/` ✅; paginated ✅; does not cross namespace ✅
- R2 mock in tests stores actual data (not just call tracking) — behavior-based assertions proven ✅

### D1Index
- `upsertNamespace`: INSERT ON CONFLICT UPDATE for namespace_slug + last_seen_at ✅
- `createRun`: upserts namespace first, then INSERT ON CONFLICT UPDATE run ✅
- `updateRun`: dynamic SET clause, no SQL built from untrusted field names — only checked against known TypeScript fields ✅; early return on empty update ✅
- `listRuns`: early `[]` for empty namespace array ✅; uses placeholders IN list ✅; `ORDER BY created_at DESC` ✅; `LIMIT/OFFSET` with safe defaults ✅
- `getRun`: filters by both `namespace_id` AND `run_id` ✅
- `upsertJob`: keyed by `(namespace_id, run_id, job_id)` ✅
- `listJobs`: filters by `namespace_id AND run_id` ✅; returns `deps:[], lastError:null, heartbeatAt:null` ✅
- `deleteExpiredRuns` (after fix): uses correlated EXISTS subquery — correct pair matching ✅

### Migrations
- `0001_init.sql`: exact match with spec/07-storage.md schema including all 3 indexes ✅
- `0002_namespaces_account.sql`: exact match with spec accounts/account_repos + foreign keys + index ✅
- No account API logic implemented — schema only ✅

### Package Hygiene
- `packages/storage/dist`: no test files emitted ✅ (tsconfig excludes test files)
- `packages/coordinator/dist`: still has stale `coordinator.test.*` from pre-fix build — new builds are clean per tsconfig; pre-existing cosmetic issue from Task 0003 ✅ (non-blocking)
- Index exports: R2Storage, D1Index, IndexedJobInput ✅

## Issues

### BLOCKER (fixed by verifier)

**`deleteExpiredRuns` cross-namespace over-delete bug**

Original SQL:
```sql
DELETE FROM jobs WHERE namespace_id IN (
  SELECT namespace_id FROM runs WHERE expires_at <= ?1
) AND run_id IN (
  SELECT run_id FROM runs WHERE expires_at <= ?1
)
```

This is unsafe when:
- Namespace A has `run-123` (expired)
- Namespace B has `run-123` (NOT expired) AND Namespace B also has another expired run

In that scenario, namespace B would appear in the `namespace_id IN (...)` subquery (due to its other expired run), and `run-123` would appear in the `run_id IN (...)` subquery (due to namespace A's expired run). Result: namespace B's jobs for `run-123` would be incorrectly deleted.

**Fix applied**: Changed to correlated EXISTS subquery:
```sql
DELETE FROM jobs WHERE EXISTS (
  SELECT 1 FROM runs
  WHERE runs.namespace_id = jobs.namespace_id
    AND runs.run_id = jobs.run_id
    AND runs.expires_at <= ?1
)
```

This correctly matches `(namespace_id, run_id)` as a pair.

**New test added**: `d1.test.ts` — "does not delete jobs for non-expired run with same run_id in another namespace" proves correct behavior.

**Note**: `FakeD1Database.deleteExpiredJobs` already used correct pair matching, so existing tests were not catching the real SQL bug. The fix aligns the real SQL with the fake's correct semantics.

## Risk Notes

### Risk 1: D1 tests use a fake, not real D1 (low-medium, same as prior tasks)
The fake correctly validates SQL parameter binding and namespace isolation logic through recorded SQL and in-memory state. No `@cloudflare/vitest-pool-workers` D1 integration. Tests are meaningful and prove intended behavior, but cannot catch D1-specific SQL dialect issues. Consistent with Task 0003 coordinator test approach.

### Risk 2: Coordinator dist emits stale test files (low, pre-existing)
`packages/coordinator/dist/` still contains `coordinator.test.*` files from the build before the tsconfig exclusion was added. New builds will not emit test files. Non-functional. A `tsc --build --clean` would remove them. Not a blocker.

### Risk 3: turbo-package CI component type does not run tests (low, known)
Same as Tasks 0002 and 0003. Tests pass locally (42/42). CI validates build + typecheck only.

### Risk 4: Node.js 20 actions deprecation (low, deadline 2026-06-02)
Same as prior tasks. No immediate action needed.

## Recommended Next Move

Task 0004 verified **PASS** (with verifier-approved fix for `deleteExpiredRuns` SQL). Merging PR #8.

Tasks 0005 (auth) is independent and can proceed. Task 0006 (Worker API) depends on this package.

After merge, `@orun/storage` provides `R2Storage`, `D1Index`, and migrations for Task 0006 to consume.
