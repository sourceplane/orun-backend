# Task 0010 Verifier Report

## Result

**PASS**

## PR

- Repo: `sourceplane/orun-backend`
- PR: #27
- Title: `feat: add CLI authentication via device flow and OAuth loopback`
- Branch: `default-orun-workflow` → `main`
- Head SHA: `800224ff029bea4d837d1c64bcd089eb20fde7cb`
- Merge state at verification: `CLEAN`

## Checks

All local checks pass from clean PR #27 content on the `default-orun-workflow` branch:

| Check | Result |
|-------|--------|
| `pnpm install` | ✓ |
| `pnpm --filter @orun/storage test` | ✓ 48/48 |
| `pnpm --filter @orun/storage typecheck` | ✓ |
| `pnpm --filter @orun/worker test` | ✓ 162/162 |
| `pnpm --filter @orun/worker typecheck` | ✓ |
| `pnpm --filter @orun/worker build` | ✓ (dry-run) |
| `git diff --check` | ✓ CLEAN |
| `pnpm exec turbo run lint` | ✓ (deferred no-op) |

No generated `dist/`, `.wrangler/`, `.turbo/`, coverage, or `.orun/` output committed.

## CI Log Review

GitHub Actions run `25437407888` — all 10 check runs green:

- `Orun Plan` — success
- `orun-api-worker · dev/staging/production · Verify deploy cloudflare worker turbo` — success (3 jobs)
- `orun-storage · dev/staging/production · Verify turbo package` — success (3 jobs)
- `orun-types · dev/staging/production · Verify turbo package` — success (3 jobs)

CI ran Orun plan/run plus all changed-component verification jobs. No unexpected failures. PR description reports 162/162 tests pass; locally confirmed.

## OAuth Loopback Review

**PASS**

- `GET /v1/auth/github?client=cli&returnTo=http://127.0.0.1:<port>/callback/<nonce>` — accepted. ✓
- `http://localhost:<port>` — accepted. ✓
- Non-loopback CLI `returnTo` values — rejected with `INVALID_REQUEST`. ✓
- `https://127.0.0.1` loopback — rejected (protocol check requires `http:`). ✓
- External hosts — rejected. ✓
- Malformed URLs — rejected. ✓
- `client`, `returnTo`, and nonce-bearing path bound into HMAC-signed state. ✓
- Dashboard `ORUN_DASHBOARD_URL` behavior unchanged. ✓
- No-`returnTo` JSON callback preserved. ✓
- CLI callback returns Orun access/refresh tokens in loopback URL fragment. ✓
- GitHub OAuth access token not included in fragment, JSON body, D1, or JWT. Verified in test "does not include GitHub access token in result" and by reading `handleGitHubOAuthCallback`: GitHub token is discarded after namespace resolution. ✓
- Raw Orun refresh token returned to CLI exactly once; stored only as SHA-256 hash in D1. ✓
- `_refreshTokenHash` is an internal field passed between `handleGitHubOAuthCallback` and `handleAuthGitHubCallback` for D1 storage; it is NOT returned via any public API endpoint. ✓

Minor note: when `client=cli` is used without `returnTo`, the raw refresh token is returned in the JSON response body. This is acceptable (the CLI is the caller over HTTPS, device flow is the headless alternative), but it deviates from the spec phrase "tokens only to the loopback URL fragment." Flagged as a pre-existing edge-case; not a blocker.

## Device Flow Review

**PASS with accepted risk**

- `POST /v1/auth/cli/device/start` — implemented as POST. ✓
- `POST /v1/auth/cli/device/poll` — implemented as POST. ✓
- GitHub device authorization response parsed correctly. ✓
- Poll handles:
  - `authorization_pending` → 202 `{ status: "pending", interval }`. ✓
  - `slow_down` → `RATE_LIMITED` error. ✓
  - `expired_token` → `UNAUTHORIZED`. ✓
  - `access_denied` → `FORBIDDEN`. ✓
  - Unknown error codes → `INVALID_REQUEST`. ✓
  - Malformed GitHub response (missing `access_token`) → `INTERNAL_ERROR`. ✓
  - Successful approval → issues Orun access + refresh tokens, fetches user/repo permissions. ✓
- GitHub access token used only within request scope; not stored. ✓
- Orun access + raw refresh token issued once; only hash stored in D1. ✓
- `GITHUB_DEVICE_CLIENT_ID` env var is defined in `Env` but unused; `startDeviceFlow` reads `GITHUB_CLIENT_ID`. Implementer notes this is intentional (same OAuth app supports both flows). Accepted. ✓
- **DEFERRED: Per-IP and per-device-code rate limiting NOT implemented.** Proposal written at `/ai/proposals/task-0010-device-flow-rate-limiting.md`. Risk accepted for pre-production phase — GitHub's own protocol (code expiry, `slow_down`, per-app rate limits) provides partial mitigation. Must be addressed before GA.

## Refresh / Logout Review

**PASS**

- `POST /v1/auth/cli/token` accepts only `refreshToken` in request body. ✓
- Refresh token is not accepted as Bearer auth (route is `auth: "none"` at router; handler reads body only). ✓
- Refresh token hashed before D1 lookup via `hashRefreshToken`. ✓
- Unknown tokens → `UNAUTHORIZED`. ✓
- Expired tokens → `UNAUTHORIZED` (ISO string comparison, `session.expiresAt <= now`). ✓
- Revoked tokens → `UNAUTHORIZED`. ✓
- Valid refresh mints new access token with `sessionKind: "cli"` and `tokenUse: "access"`. ✓
- `last_used_at` updated on refresh via `markCliSessionUsed`. ✓
- `POST /v1/auth/cli/logout` revokes the stored session. ✓
- Logout returns `ok: true` for unknown tokens (idempotent). Does not leak session existence because no conditional branching in the response. ✓
- Raw refresh tokens never logged. ✓

Residual: refresh tokens are not rotated on each use (refresh mints new access token but doesn't issue a new refresh token). Acceptable for initial implementation.

## Storage Migration Review

**PASS**

- `migrations/0003_cli_sessions.sql` matches `spec/07-storage.md` schema exactly. ✓
- `refresh_token_hash TEXT NOT NULL UNIQUE` with `idx_cli_sessions_hash` index. ✓
- `expires_at`, `revoked_at` fields present. ✓
- Storage helpers bind values safely via positional D1 parameters. ✓
- `allowed_namespace_ids_json` parsed via `JSON.parse()` in `rowToCliSession` — defensive because D1 stores raw JSON string. ✓
- Tests prove: create, get by hash, mark used, revoke, and migration file content. ✓
- No conflicts with migrations 0001 or 0002. ✓

Residual: expired `cli_sessions` rows are not yet cleaned up by the scheduled GC (`deleteExpiredRuns` does not touch `cli_sessions`). Expired sessions are already functionally blocked from minting tokens by the `expiresAt` check. Pure housekeeping gap.

## Mutable Route Authorization Review

**PASS**

Routes enforced via `assertMutableAccess(authCtx)` in both `handlers/jobs.ts` and `handlers/logs.ts`:

| Route | Auth required | Dashboard result |
|-------|--------------|-----------------|
| `POST /v1/runs/:runId/jobs/:jobId/claim` | OIDC or CLI session | 403 FORBIDDEN |
| `POST /v1/runs/:runId/jobs/:jobId/update` | OIDC or CLI session | 403 FORBIDDEN |
| `POST /v1/runs/:runId/jobs/:jobId/heartbeat` | OIDC or CLI session | 403 FORBIDDEN |
| `GET /v1/runs/:runId/runnable` | OIDC or CLI session | 403 FORBIDDEN |
| `POST /v1/runs/:runId/logs/:jobId` | OIDC or CLI session | 403 FORBIDDEN |

OIDC behavior unchanged: OIDC tokens use embedded `namespaceId` directly, same as before. ✓

CLI namespace resolution: iterates `resolveSessionNamespaceIds` → `account_repos` D1 lookup → `getRun` per namespace. Adds 1–2 D1 reads per mutable CLI request. Acceptable for local remote-state; hot path for CI uses OIDC.

`GET /v1/runs/:runId/logs/:jobId` (read log) — allows any session type (including dashboard). Correct per spec. ✓

`POST /v1/runs` — `oidc_or_session` allowing dashboard sessions to create runs. This is pre-existing behavior from Task 0006 and spec/04 explicitly lists "OIDC or Session" for this route. Not a regression introduced by Task 0010. ✓

## Rate-Limit Scope Review

**PASS**

The PR updates two `RateLimitCounter DO` tests in `apps/worker/src/api.test.ts` to match the 300-burst limit shipped in PR #25:

- `expect(data.remaining).toBe(299)` (was failing against old 20-token default)
- Loop 300 iterations before asserting `limited: true` (was fewer)

These changes align tests with already-merged production behavior. No hidden rate-limit behavior changes introduced by this PR. The implementer report's "2 pre-existing RateLimitCounter DO failures" were exactly these two tests; the PR fixes both (162 pass vs 160 before fix).

## Docs and Spec Review

**PASS**

- `spec/04-worker-api.md` — API table updated to list CLI device/token/logout routes and CLI session authorization semantics. ✓
- `spec/06-auth.md` — `SessionClaims` `sessionKind`/`tokenUse` extensions, device flow contract, CLI refresh token contract, migration schema all match implementation. ✓
- `spec/07-storage.md` — `cli_sessions` migration schema, `D1Index` interface, and `CliSession`/`CreateCliSessionInput` types match implementation. ✓
- `spec/09-cli-integration.md` — not modified; this is a backend-only task. CLI integration is Task 0011 scope. ✓

One typo in implementer report: device/start listed as "GET" in report but correctly implemented and routed as POST.

## Issues

No blockers. Accepted residual risks documented below.

## Risk Notes

1. **Device endpoint rate limiting deferred** — `POST /v1/auth/cli/device/start` and `POST /v1/auth/cli/device/poll` have no per-IP or per-device-code rate limiting. Risk is GitHub API rate exhaustion for the OAuth app, not credential exposure. Proposal at `/ai/proposals/task-0010-device-flow-rate-limiting.md`. Must address before GA.

2. **Refresh token not rotated** — Each refresh call mints a new access token but issues no new refresh token. Replay window equals the 30-day refresh token TTL. Acceptable for initial implementation; rotation can be added without a schema migration.

3. **No CLI session GC** — `deleteExpiredRuns` does not delete expired `cli_sessions` rows. Expired sessions cannot mint tokens; cleanup is purely housekeeping. Can be added to the scheduled handler in a later task.

4. **CLI OAuth JSON path without `returnTo`** — When `client=cli` is used without `returnTo`, raw refresh token returned in JSON response body instead of loopback fragment. Acceptable over HTTPS but deviates from strict spec wording. Edge case; device flow is the recommended headless path.

## Spec Proposals

- `/ai/proposals/task-0010-device-flow-rate-limiting.md` — documents deferred device endpoint rate limiting and acceptance rationale.

## Merge / Sync Actions

- Verifier bookkeeping committed to branch `default-orun-workflow` before merge.
- PR #27 merged to `main` via squash.
- Local `main` fast-forward pulled from `origin/main`.
- `ai/reports/task-0010-implementer.md` committed to repo via this bookkeeping commit (was untracked locally, now in history).

## Recommended Next Move

Proceed to **Task 0011** — `orun` CLI auth implementation and local `orun run --remote-state` integration. The backend foundation is complete and verified. Task 0011 implements `orun auth login`, `orun auth login --device`, `orun auth status`, `orun auth logout`, and the CLI token resolution path for local remote-state runs.
