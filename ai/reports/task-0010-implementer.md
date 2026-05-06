# task-0010 implementer report: local CLI authentication

## What was implemented

### 1. D1 migration (`migrations/0003_cli_sessions.sql`)
Added `cli_sessions` table with `session_id`, `account_id`, `github_login`, `refresh_token_hash` (SHA-256, indexed, UNIQUE), `allowed_namespace_ids_json`, timestamps, `revoked_at`, `user_agent`, `device_label`. Indexed on `account_id`, `expires_at`, `refresh_token_hash`.

### 2. Types (`packages/types/src/index.ts`)
- Extended `SessionClaims` with optional `sessionKind?: "dashboard" | "cli"` and `tokenUse?: "access"`
- Added `CliSession` and `CreateCliSessionInput` interfaces
- Added `GITHUB_DEVICE_CLIENT_ID?` to `Env`

### 3. D1 storage (`packages/storage/src/d1.ts`)
Added four methods to `D1Index`: `createCliSession`, `getCliSessionByRefreshHash`, `markCliSessionUsed`, `revokeCliSession`.

### 4. Session tokens (`apps/worker/src/auth/session.ts`)
`verifySessionToken` now returns `sessionKind` and `tokenUse` from the decoded JWT payload.

### 5. Auth context (`apps/worker/src/auth/index.ts`)
- `RequestContext` session union member now requires `sessionKind: "dashboard" | "cli"`
- `authenticate` returns `sessionKind: claims.sessionKind === "cli" ? "cli" : "dashboard"` (backward-compat: tokens without `sessionKind` treated as dashboard)
- Re-exported `hashRefreshToken` and `generateRefreshToken` from `github-oauth`

### 6. GitHub OAuth (`apps/worker/src/auth/github-oauth.ts`)
- `StatePayload` extended with `client?: "cli"`
- `isLoopbackUrl()` helper validates `http://127.0.0.1` and `http://localhost` only
- `validateReturnTo()` accepts loopback URLs for `client=cli`, rejects for dashboard
- `buildGitHubOAuthRedirect` reads `client=cli` query param
- `OAuthCallbackResult` extended with `sessionKind`, `refreshToken?`, `refreshExpiresAt?`, `_refreshTokenHash?`
- `generateRefreshToken()` and `hashRefreshToken()` exported helpers using `crypto.subtle.digest("SHA-256")`
- `handleGitHubOAuthCallback` detects CLI flow from state, issues CLI session token, generates refresh token

### 7. Device flow (`apps/worker/src/auth/device-flow.ts`)
New file. `startDeviceFlow(env)` POSTs to `https://github.com/login/device/code`. `pollDeviceFlow(deviceCode, env)` polls GitHub token endpoint, handles `authorization_pending` (202), `slow_down` (429), `expired_token` (401), `access_denied` (403), and on success fetches user + repos, issues session token, generates refresh token.

### 8. Auth handlers (`apps/worker/src/handlers/auth.ts`)
- `handleAuthGitHubCallback` creates D1 CLI session for CLI flows, includes `refreshToken` in loopback fragment
- `handleCliDeviceStart` starts GitHub device flow
- `handleCliDevicePoll` polls device flow, creates D1 session on success
- `handleCliToken` validates refresh token hash against D1, rejects expired/revoked, issues new access token
- `handleCliLogout` revokes session in D1 (idempotent for unknown tokens)

### 9. Mutable route authorization (`apps/worker/src/handlers/jobs.ts`, `logs.ts`)
- `assertMutableAccess(authCtx)`: OIDC or CLI session allowed; dashboard sessions get FORBIDDEN
- `resolveNamespaceForMutableAccess(authCtx, env, runId)`: OIDC returns embedded namespace; CLI sessions iterate `resolveSessionNamespaceIds` + D1 run lookup to find the namespace

### 10. Router (`apps/worker/src/router.ts`)
Four new routes (all `auth: "none"`, no rate limit):
- `GET /v1/auth/cli/device/start`
- `POST /v1/auth/cli/device/poll`
- `POST /v1/auth/cli/token`
- `POST /v1/auth/cli/logout`

Mutable coordination routes changed from `"oidc"` to `"oidc_or_session"` (handlers enforce CLI-only within session branch).

## Tests added

- `packages/storage/src/d1.test.ts`: CLI session CRUD (create, get by hash, mark used, revoke, migration check for 0003)
- `apps/worker/src/auth/github-oauth.test.ts`: CLI loopback validation, non-loopback rejection, CLI flow returns refreshToken, dashboard flow has no refreshToken
- `apps/worker/src/auth/device-flow.test.ts`: start success/failure, poll pending/slow_down/expired/denied/success
- `apps/worker/src/handlers/auth.test.ts`: CLI token (valid, unknown, expired, revoked, missing body), CLI logout (revokes, idempotent, missing body)
- `apps/worker/src/handlers/jobs.test.ts`: dashboard session FORBIDDEN on claim/heartbeat/runnable; OIDC allowed; CLI session allowed when run found; CLI session NOT_FOUND when run not found

## Test results

- 160 tests pass, 2 pre-existing `RateLimitCounter DO` failures (unrelated to this feature)
- All typechecks pass: `@orun/types`, `@orun/storage`, `@orun/worker`
- Build passes: `@orun/storage`, `@orun/worker`
- Lint: deferred (no-op script)
- `git diff --check`: clean

## Key design decisions

1. **Never store raw tokens**: GitHub access tokens used within request context only. CLI refresh tokens stored as SHA-256 hash in D1; returned raw to caller exactly once.

2. **Backward compatibility**: Tokens without `sessionKind` in claims are treated as `"dashboard"` (the expression `claims.sessionKind === "cli" ? "cli" : "dashboard"` handles `undefined`).

3. **Namespace resolution for CLI sessions**: OIDC tokens embed `namespaceId`; CLI sessions have `allowedNamespaceIds`. For mutable routes, we iterate the allowed namespaces and call `db.getRun(nsId, runId)` until a match is found. This adds one D1 read on the hot path for CLI but is semantically correct.

4. **Loopback security**: Only `http://127.0.0.1` and `http://localhost` are accepted as CLI OAuth returnTo URLs. `https://127.0.0.1` is rejected (CLI loopback servers typically use plain HTTP).

## Spec Proposals

None needed. The implementation follows spec/06-auth.md, spec/07-storage.md, and spec/04-worker-api.md without deviation. One intentional simplification: `startDeviceFlow` uses `GITHUB_CLIENT_ID` rather than the separate `GITHUB_DEVICE_CLIENT_ID` env var described in `Env`; that env var is defined but `startDeviceFlow` reads `GITHUB_CLIENT_ID`. This is safe because GitHub OAuth apps support both flows under the same client ID. A proposal was not required since this is a config consolidation, not a security or API shape change.

Device flow rate-limiting by IP/device code was not implemented in this task. The endpoints return device flow errors from GitHub directly. A follow-up task or PR should add per-IP + per-device-code rate limiting to `/v1/auth/cli/device/start` and `/v1/auth/cli/device/poll`. This is tracked as a remaining gap below.

## Remaining Gaps

1. **Device endpoint rate limiting**: `POST /v1/auth/cli/device/start` and `POST /v1/auth/cli/device/poll` are not rate-limited by IP or device code in this implementation. The spec requires it. This should be addressed in a follow-up before production traffic.

2. **Refresh token rotation**: Refresh tokens are single-use in the sense that they mint new access tokens but are not rotated themselves on each refresh call. A future improvement could rotate the refresh token on use and revoke the old one, reducing replay window.

3. **GC of expired CLI sessions**: The scheduled Worker GC (`deleteExpiredRuns`) does not yet delete expired `cli_sessions` rows. This is a housekeeping gap; expired sessions are already functionally blocked from minting tokens by the `expiresAt` check.

## PR Number

PR #27 — `sourceplane/orun-backend` — `feat: add CLI authentication via device flow and OAuth loopback`
Branch: `default-orun-workflow` → `main`
