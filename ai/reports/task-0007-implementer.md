# Task 0007 Implementer Report

## Summary

Implemented the account and repository linking layer in the Worker. Accounts are visibility overlays that allow session users to see runs from linked repositories beyond what their JWT snapshot provides. Five new endpoints under `/v1/accounts/**`, GitHub admin verification for repo linking, D1 helpers for account/repo CRUD, and session namespace resolution that unions JWT namespaces with persistent linked repos.

## Files Changed

### New Files
- `apps/worker/src/handlers/accounts.ts` — Account/repo handlers, D1 helpers, GitHub admin verification, `resolveSessionNamespaceIds`
- `apps/worker/src/handlers/accounts.test.ts` — 29 tests covering all account endpoints, GitHub verification, namespace resolution, and session read integration

### Modified Files
- `apps/worker/src/router.ts` — Added 5 account routes with session auth
- `apps/worker/src/http.ts` — Added `X-GitHub-Access-Token` to CORS allowed headers
- `apps/worker/src/handlers/runs.ts` — Updated `handleListRuns`, `handleGetRun`, and `handleCreateRun` to use `resolveSessionNamespaceIds`
- `apps/worker/src/handlers/jobs.ts` — Updated `handleListJobs` and `handleJobStatus` to use `resolveSessionNamespaceIds`
- `apps/worker/src/handlers/logs.ts` — Updated `handleGetLog` to use `resolveSessionNamespaceIds`

## API Behavior

| Route | Auth | Behavior |
|-------|------|----------|
| `POST /v1/accounts` | session | Idempotent create/return account by `authCtx.actor` |
| `GET /v1/accounts/me` | session | Return existing account or typed 404 |
| `POST /v1/accounts/repos` | session | Verify GitHub admin, upsert namespace, idempotent link |
| `GET /v1/accounts/repos` | session | List linked repos newest-first, empty array if no account |
| `DELETE /v1/accounts/repos/:namespaceId` | session | Remove link only, idempotent |

### Session Namespace Resolution
- `resolveSessionNamespaceIds(authCtx, db)` unions JWT `allowedNamespaceIds` with D1 `account_repos` linked namespaces
- Dedupes while preserving deterministic order (JWT first, then linked)
- Returns JWT namespaces unchanged if no account exists
- Applied to: `GET /v1/runs`, `GET /v1/runs/:runId`, `GET /v1/runs/:runId/jobs`, `GET /v1/runs/:runId/jobs/:jobId/status`, `GET /v1/runs/:runId/logs/:jobId`, `POST /v1/runs` (session)

### Rate Limiting
Account routes use the existing session rate-limit key: `authCtx.allowedNamespaceIds[0] ?? authCtx.actor`. This is deterministic for session users and requires no schema changes.

## GitHub Token Handling

- Short-lived GitHub access token passed via `X-GitHub-Access-Token` header
- Used only for `GET /repos/{owner}/{repo}` and `GET /orgs/{owner}/memberships/{login}` verification calls
- Never stored in D1, never added to session JWTs, never logged, never returned in responses or errors
- `verifyRepoAdminAccess` accepts injectable `fetchImpl` for testability
- `repoFullName` validated strictly: exactly `owner/repo`, no empty segments, no traversal, segments URL-encoded

## Checks Run

| Check | Result |
|-------|--------|
| `pnpm --filter @orun/worker test` | 118 tests passed (8 test files) |
| `pnpm --filter @orun/worker typecheck` | Pass |
| `pnpm --filter @orun/worker build` | Pass (69 KiB / 14.35 KiB gzip) |
| `pnpm exec turbo run test typecheck build` | 15/15 tasks passed |
| `kiox -- orun plan --changed` | 1 component, 3 envs |
| `kiox -- orun run --changed` | 3/3 jobs succeeded |

## Assumptions

- `INSERT OR IGNORE` + `SELECT` pattern used instead of `RETURNING` for D1 compatibility with test fakes
- Account creation uses `crypto.randomUUID()` for `account_id` generation
- GitHub API verification uses the caller's access token, not a server-side app installation token
- `verifyRepoAdminAccess` checks repo `permissions.admin` first, then falls back to org membership `role === "admin"`
- For user-owned repos where the caller is not admin and there is no org, the org membership lookup will fail and return FORBIDDEN
- `UNAUTHORIZED` (401) chosen as the error code for missing GitHub access token, consistent with missing auth semantics

## Remaining Gaps

- No account tier/billing schema — future work per task constraints
- No GitHub token persistence — by design; tokens are ephemeral verification-only
- Session JWT `allowedNamespaceIds` remains a login-time snapshot; D1 `account_repos` is the persistent complement
- `resolveSessionNamespaceIds` makes 2 extra D1 queries per session request (account lookup + linked repos). Acceptable for dashboard reads; could be cached if needed
- No pagination on `GET /v1/accounts/repos` — acceptable for early usage patterns
- Worker unit tests remain local-only; CI runs typecheck + wrangler dry-run but not vitest

## Next Task Dependencies

- **Task 0008** (CLI remote-state): No blocking changes. Run/job/log contracts unchanged.
- **Task 0009** (Dashboard): Can consume all 5 account endpoints. Namespace resolution is transparent to API consumers.
- OAuth `allowedNamespaceIds` from login remains the real-time snapshot; D1 `account_repos` is the persistent visibility layer used by dashboard reads.

## PR Number

TBD — PR will be opened after this report is committed.
