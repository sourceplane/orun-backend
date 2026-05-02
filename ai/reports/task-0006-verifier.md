# Task 0006 Verifier Report

Result: PASS (with three verifier-applied fixes)

## Checks

- **Typecheck**: 5/5 packages pass (`turbo run typecheck`)
- **Build**: 5/5 packages pass; Wrangler dry-run bundles at 60.13 KiB with `COORDINATOR: RunCoordinator` and `RATE_LIMITER: RateLimitCounter` bindings
- **Test**: 89 worker tests pass (7 test files), 179 total tests across all packages (types 16, coordinator 35, storage 42, worker 89)
- **Lint**: 5/5 packages pass (lint scripts are still `echo 'lint deferred'`)
- **Wrangler dry-run**: passes with R2/D1/DO bindings correctly declared
- **Local kiox/orun**: `orun plan --changed` detects `orun-api-worker` + `orun-types` (2 components × 3 envs → 6 jobs); `orun run --changed` succeeds (exec id `orun-backend-20260502-cf0bfb`, 6/6 jobs succeeded)
- **CI run 25244619107**: Both Review Plan and Build & Deploy jobs succeeded. `kiox -- orun plan --changed` and `kiox -- orun run --changed` both ran with 2 components (`orun-api-worker`, `orun-types`). Worker build, typecheck, and Wrangler dry-run all passed in CI. Production deploy correctly skipped for PR. Node.js 20 action deprecation and Wrangler 3.x version warnings noted (known, non-blocking).

## Acceptance Criteria Verification

1. `apps/worker/src/index.ts` exports `fetch` and `scheduled` handlers — **PASS**
2. `RunCoordinator` re-exported — **PASS**
3. `RateLimitCounter` exported and configured in `wrangler.jsonc` as `RATE_LIMITER` DO binding — **PASS**
4. `/v1/auth/github` and `/v1/auth/github/callback` wired — **PASS**
5. All 15 in-scope endpoints route correctly — **PASS** (verified via route table and tests)
6. Protected routes use `authenticate(request, env, ctx)` — **PASS** (router.ts:90)
7. Namespace access enforced for OIDC (namespaceId match) and session (allowedNamespaceIds) — **PASS**
8. Deploy-token context rejected from general endpoints — **PASS** (router.ts:98-100, tested)
9. `POST /v1/runs` supports optional deterministic `runId` and idempotent create/join — **PASS**
10. `POST /v1/runs` initializes Coordinator DO and writes D1/R2 mirrors — **PASS**
11. Job claim/update/heartbeat/runnable forward to Coordinator DO — **PASS** (with `encodeURIComponent` for jobId)
12. Update forwarding preserves `runnerId` via `CoordinatorUpdateJobRequest` — **PASS** (tested with body capture)
13. D1 mirrors updated after job updates and log uploads — **PASS** (after verifier fix)
14. Log upload and retrieval use `R2Storage` — **PASS**
15. Rate limiting produces HTTP 429 with `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining` — **PASS**
16. Scheduled GC handles expired runs without deleting namespaces/accounts/account_repos — **PASS** (uses `deleteExpiredRuns` which only touches runs/jobs tables)
17. `CreateRunRequest.runId?: string` added to `@orun/types` and type-tested — **PASS**
18. Tests cover happy paths, auth failures, cross-namespace denial, rate limit, unclaimed response, log upload/retrieval, and scheduled GC — **PASS** (89 tests, 34 in api.test.ts)
19. No account/repo-linking endpoints implemented — **PASS** (rg scan confirmed)
20. No Go CLI code modified — **PASS**
21. Local checks pass — **PASS** (all turbo tasks, all package tests, wrangler dry-run)
22. Local kiox/orun validation passes — **PASS** (6/6 jobs)
23. PR CI logs prove validation ran — **PASS** (orun-api-worker and orun-types both validated)

## Verifier-Applied Fixes

Three D1 mirror corruption bugs were identified during code review and fixed with tests:

### Fix 1: Log upload D1 corruption (BLOCKER → FIXED)
**File**: `apps/worker/src/handlers/logs.ts:31-43`
**Problem**: `handleUploadLog` called `upsertJob` with `component: ""`, `status: "running"`, `runnerId: null`, erasing any existing job's real status/runner/timestamps. D1's `ON CONFLICT DO UPDATE SET status = excluded.status, runner_id = excluded.runner_id...` would overwrite a completed/failed job back to "running" with blank fields.
**Fix**: Changed to targeted `UPDATE jobs SET log_ref = ?1 WHERE ...` that only touches `log_ref`. Falls back to `upsertJob` only if the job row doesn't exist yet. Test added to verify `UPDATE jobs SET log_ref` is used.

### Fix 2: Job update erases logRef (BLOCKER → FIXED)
**File**: `apps/worker/src/handlers/jobs.ts:100-115`
**Problem**: `handleUpdateJob` mirrored coordinator job state to D1 with `logRef: null`, erasing any previously uploaded log reference.
**Fix**: Before upserting, reads the existing `log_ref` from D1 with `SELECT log_ref FROM jobs WHERE ...` and preserves it in the upsert. Test added to verify the `SELECT log_ref` query is issued.

### Fix 3: Plan checksum bypass (BLOCKER → FIXED)
**File**: `apps/worker/src/handlers/runs.ts:108-118`
**Problem**: When coordinator's `/init` returned `alreadyExists: true` but `/state` failed, the code silently returned 200 without verifying the plan checksum. A different plan could be accepted for an existing run.
**Fix**: If `/state` fails after `alreadyExists`, now throws `INTERNAL_ERROR` (500) instead of silently accepting. Test added to verify 500 response when `/state` fails for an existing run.

## Issues

No unresolved blockers after fixes. All three blockers resolved and tested.

## Risk Notes

- **CI does not run unit tests**: The `verify-deploy-cloudflare-worker-turbo` component type only builds, typechecks, and dry-run deploys. Worker's 89 tests and all other package tests only run locally. This is consistent with Tasks 0003–0005. Offset by full local test runs documented here.
- **Session GET run/jobs/status uses D1 only**: Session reads (handleGetRun, handleListJobs, handleJobStatus for session auth) query D1 without trying coordinator for freshness. Acceptable for dashboard reads where D1 lag behind coordinator is tolerable. OIDC reads correctly prefer coordinator state.
- **Idempotent join returns synthetic metadata**: `POST /v1/runs` with `alreadyExists` returns `status: "running"` and a new `createdAt` timestamp regardless of actual coordinator state. Acceptable for Task 0008 remote-state where the CLI calls `GET /v1/runs/:runId` for fresh status after joining.
- **coordinatorStateToRun returns empty namespaceSlug**: Coordinator state doesn't track namespace slug, so OIDC reads via coordinator return `namespaceSlug: ""`. D1 fallback has the real slug. Non-blocking for Task 0008 which keys on namespaceId.
- **coordinatorJobToPublic returns logRef: null**: Coordinator doesn't track logRef, so coordinator-backed job responses always have `logRef: null`. D1 has the real logRef. Log retrieval uses R2 directly, not the logRef field. Acceptable.
- **Rate limit uses burst (20) as X-RateLimit-Limit**: The `X-RateLimit-Limit` header reports the token bucket capacity (20) rather than the per-second rate (5). Consistent with token bucket semantics. Rate-limit DO is in-memory (no persistence across DO eviction), acceptable for free tier.
- **Session rate-limit key**: Uses `allowedNamespaceIds[0] ?? authCtx.actor` for session rate limiting. Deliberate choice documented in implementer report. Future Task 0007 account scoping may refine this.
- **Scheduled GC timing**: `ctx.waitUntil(cleanupPromises)` runs R2/coordinator cleanup asynchronously while D1 rows are deleted immediately. If cleanup fails after D1 deletion, there's no retry source. Acceptable best-effort GC — orphaned R2 objects and coordinator DOs will self-clean via their own alarms/TTLs.
- **Wrangler DO migrations**: Production deployment of `RateLimitCounter` may require Cloudflare DO migration declarations. Wrangler dry-run passes, but this is a first-deploy risk note.
- **Wrangler 3.x deprecation**: `wrangler 3.114.17 (update available 4.87.0)` warning. Known across all tasks.
- **Node.js 20 action deprecation**: Actions runners will force Node.js 24 by 2026-06-02. Known, non-blocking.

## Recommended Next Move

- Update `ai/state.json` to `current_task: 7`, advance to Task 0007 (account/repo linking).
- Task 0007 depends only on Task 0006 and can proceed immediately.
- Task 0008 (CLI remote-state) also depends only on Task 0006 and can proceed in parallel with Task 0007.
- Consider addressing Wrangler 4.x upgrade and Node.js 24 action migration before the June 2026 deadline.
