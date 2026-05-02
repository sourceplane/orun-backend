# Task 0006 Implementer Report

## Summary

Implemented the core Worker API gateway in `apps/worker`. All in-scope endpoints are routed, authenticated, rate-limited, and connected to the existing coordinator, storage, and auth packages. Added a `RateLimitCounter` Durable Object for per-namespace rate limiting and a `scheduled` handler for expired-run GC.

## Files Changed

- `packages/types/src/index.ts` — Added `runId?: string` to `CreateRunRequest`; added `RATE_LIMITER: DurableObjectNamespace` to `Env`.
- `packages/types/src/index.test.ts` — Added type test coverage for `CreateRunRequest.runId` and `Env.RATE_LIMITER`.
- `apps/worker/src/index.ts` — Rewired to use `routeRequest` and `handleScheduled`; exports `RunCoordinator` and `RateLimitCounter`.
- `apps/worker/src/http.ts` — (new) CORS headers, JSON/error response helpers, `handleOptions`, `handleError`.
- `apps/worker/src/router.ts` — (new) Route table with pattern matching, auth enforcement, rate limit gating.
- `apps/worker/src/rate-limit.ts` — (new) `RateLimitCounter` DO (token bucket, 5 req/s, burst 20) and `checkRateLimit` helper.
- `apps/worker/src/coordinator.ts` — (new) `getCoordinator` and `coordinatorFetch` helpers.
- `apps/worker/src/handlers/auth.ts` — (new) OAuth redirect and callback handlers.
- `apps/worker/src/handlers/runs.ts` — (new) `POST /v1/runs`, `GET /v1/runs`, `GET /v1/runs/:runId`, `assertNamespaceAccess`.
- `apps/worker/src/handlers/jobs.ts` — (new) claim, update, heartbeat, runnable, list jobs, job status.
- `apps/worker/src/handlers/logs.ts` — (new) log upload and retrieval.
- `apps/worker/src/scheduled.ts` — (new) GC handler for expired runs.
- `apps/worker/src/api.test.ts` — (new) 86 tests covering all acceptance criteria.
- `apps/worker/wrangler.jsonc` — Added `RATE_LIMITER` DO binding and `triggers.crons`.
- `apps/worker/src/auth/github-oauth.test.ts` — Added `RATE_LIMITER` to test env mock.
- `apps/worker/src/auth/index.test.ts` — Added `RATE_LIMITER` to test env mock.
- `apps/worker/src/auth/oidc.test.ts` — Added `RATE_LIMITER` to test env mock.

## API Implemented

| Method | Path | Auth | Status |
|--------|------|------|--------|
| GET | `/` | none | health |
| OPTIONS | `/*` | none | CORS preflight |
| GET | `/v1/auth/github` | none | OAuth redirect |
| GET | `/v1/auth/github/callback` | none | OAuth callback |
| POST | `/v1/runs` | oidc/session | create run |
| GET | `/v1/runs` | session | list runs |
| GET | `/v1/runs/:runId` | oidc/session | get run |
| GET | `/v1/runs/:runId/jobs` | oidc/session | list jobs |
| GET | `/v1/runs/:runId/jobs/:jobId/status` | oidc/session | job status |
| GET | `/v1/runs/:runId/runnable` | oidc | runnable jobs |
| POST | `/v1/runs/:runId/jobs/:jobId/claim` | oidc | claim job |
| POST | `/v1/runs/:runId/jobs/:jobId/update` | oidc | update job |
| POST | `/v1/runs/:runId/jobs/:jobId/heartbeat` | oidc | heartbeat |
| POST | `/v1/runs/:runId/logs/:jobId` | oidc | upload log |
| GET | `/v1/runs/:runId/logs/:jobId` | oidc/session | get log |

## Checks Run

- `pnpm exec turbo run typecheck` — 5/5 pass
- `pnpm exec turbo run build` — 5/5 pass
- `pnpm exec turbo run test` — 15/15 pass (86 tests in worker, 142 total)
- `pnpm exec turbo run lint` — 5/5 pass
- `pnpm --filter @orun/worker test` — 86 tests pass
- `pnpm --filter @orun/types test` — 16 tests pass
- `cd apps/worker && pnpm exec wrangler deploy --dry-run --outdir=dist` — pass (59.60 KiB)

## Local kiox/orun Validation

- `kiox -- orun plan --changed`: 0 jobs (expected: uncommitted changes not detected by orun's changed-file heuristic)
- `kiox -- orun run --changed`: 0 jobs, no jobs to run
- `kiox -- orun plan` (full): 5 components × 3 envs → 15 jobs, plan `52633df0372d`

## Assumptions

- Session-created runs require `namespaceId` in the body and the namespace must exist in D1 (created by prior OIDC activity). This is intentional: we don't invent display data.
- Rate limiting uses a Worker-owned Durable Object counter rather than KV (no KV binding exists). Token bucket with 5 req/s refill and burst capacity of 20.
- D1 mirrors are updated via `ctx.waitUntil()` and are not authoritative for execution decisions.
- `POST /v1/runs` idempotent join verifies plan checksum via coordinator `/state` endpoint.
- Deploy-token context is rejected from all run/job/log endpoints (FORBIDDEN).
- Coordinator key uses `coordinatorKey(namespaceId, runId)` from `@orun/types/paths`.

## Remaining Gaps

- Worker unit tests run locally only; CI (`verify-deploy-cloudflare-worker-turbo`) does build+typecheck+wrangler dry-run but does not execute vitest. Consistent with Tasks 0003-0005.
- Rate-limit DO is in-memory per isolate. Production tradeoff: eventual consistency across isolates. Acceptable for free-tier rate limiting; premium tier is a seam only.
- Session-created runs are implemented but require the namespace to already exist in D1 (upserted by prior OIDC traffic). If no namespace exists, returns NOT_FOUND.
- Specs were not modified. The code matches spec intent; `CreateRunRequest.runId` was the only required type addition.

## Next Task Dependencies

Task 0007 (account/repo linking) can use:
- Rate limiter binding and per-namespace enforcement
- D1 namespaces/runs/jobs tables

Task 0008 (CLI remote-state) can use:
- `POST /v1/runs` with deterministic `runId`
- Idempotent create/join semantics
- Plan checksum conflict detection
- Job claim/update/heartbeat with `runnerId` preservation
- `GET /v1/runs/:runId`, `/jobs`, `/runnable`, `/logs/:jobId`
- OIDC auth mapping repository_id to namespace

## PR Number

PR #13: https://github.com/sourceplane/orun-backend/pull/13
