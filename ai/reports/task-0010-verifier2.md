# Task 0010 Verifier 2 Report

## Result

**PASS**

---

## PR / Merge State

- **PR #27**: `feat: add CLI authentication via device flow and OAuth loopback`
- **State**: MERGED
- **Merge commit**: `aade858de725c0f1e7e13dfbc6f8eff2c18deccf`
- **Merged at**: 2026-05-06T13:43:55Z
- **Head at merge**: `f97a9712bcbcd652649d890b1dada3ae287c622d`

---

## Main Pipeline Review

- **Run ID**: 25439085842
- **URL**: https://github.com/sourceplane/orun-backend/actions/runs/25439085842
- **Trigger**: push to main (merge of PR #27)
- **Started**: 2026-05-06T14:23:58Z (after merge)
- **Conclusion**: success

Jobs executed and passed:

| Job | Duration | Result |
|---|---|---|
| Orun Plan | 11s | ✓ |
| orun-api-worker · dev · Verify deploy cloudflare worker turbo | 40s | ✓ |
| orun-api-worker · staging · Verify deploy cloudflare worker turbo | 39s | ✓ (deploy skipped: not production branch) |
| orun-api-worker · production · Verify deploy cloudflare worker turbo | 48s | ✓ |
| orun-storage · production · Verify turbo package | 31s | ✓ |
| orun-storage · staging · Verify turbo package | 34s | ✓ |
| orun-storage · dev · Verify turbo package | 30s | ✓ |
| orun-types · production · Verify turbo package | 25s | ✓ |
| orun-types · staging · Verify turbo package | 29s | ✓ |
| orun-types · dev · Verify turbo package | 33s | ✓ |

Staging deploy was explicitly `SKIPPED: Cloudflare Worker deploy for orun-api-worker in staging on refs/heads/main (not production branch).` — this is correct behavior. Production job ran for 48s and completed successfully.

No secret values printed in logs (all masked as `***`).

---

## Wrangler Worker Review

- **Account**: rahulvarghesepullely@gmail.com (Rahulvarghesepullely@gmail.com's Account)
- **Worker name**: `orun-api`
- **Latest deployment created**: 2026-05-06T14:24:01.100Z
- **Latest deployment version ID**: `748aec6c-a5e6-40bb-ab45-823088640856`
- **Deployment is after merge**: ✓ (merge 13:43:55Z → deployment 14:24:01Z, ~40min lag through CI)
- **No rollback or failed deployment is current**: ✓

Deployment timeline confirms the production job in run 25439085842 pushed the Task 0010 code.

---

## D1 Migration Review

- **Database**: `orun-db` (ID: `536b10bc-8c63-42e8-bc56-457e636d3a6e`)
- **Migration status**: `No migrations to apply!` — all migrations (0001, 0002, 0003) are applied remotely ✓
- **`cli_sessions` table**: exists ✓

Schema verified via remote `PRAGMA table_info(cli_sessions)`:

| Column | Type | NOT NULL | Notes |
|---|---|---|---|
| session_id | TEXT | — | PRIMARY KEY |
| account_id | TEXT | ✓ | |
| github_login | TEXT | ✓ | |
| refresh_token_hash | TEXT | ✓ | UNIQUE |
| allowed_namespace_ids_json | TEXT | ✓ | |
| created_at | TEXT | ✓ | |
| last_used_at | TEXT | — | nullable |
| expires_at | TEXT | ✓ | |
| revoked_at | TEXT | — | nullable |
| user_agent | TEXT | — | nullable |
| device_label | TEXT | — | nullable |

All 11 required columns present. ✓

Indexes verified via `PRAGMA index_list(cli_sessions)`:

| Index | Unique | Origin |
|---|---|---|
| idx_cli_sessions_hash | 0 | CREATE INDEX |
| idx_cli_sessions_expires | 0 | CREATE INDEX |
| idx_cli_sessions_account | 0 | CREATE INDEX |
| sqlite_autoindex_cli_sessions_2 | 1 | UNIQUE constraint on refresh_token_hash |
| sqlite_autoindex_cli_sessions_1 | 1 | PRIMARY KEY on session_id |

`refresh_token_hash` UNIQUE constraint enforced by `sqlite_autoindex_cli_sessions_2`. ✓

---

## Secrets / Vars Review

Secrets returned by `wrangler secret list` (names only, no values):

| Secret | Present |
|---|---|
| GITHUB_CLIENT_ID | ✓ |
| GITHUB_CLIENT_SECRET | ✓ |
| ORUN_SESSION_SECRET | ✓ |
| ORUN_DASHBOARD_URL | ✓ |
| ORUN_PUBLIC_URL | ✓ |
| ORUN_DEPLOY_TOKEN | ✓ |
| GITHUB_DEVICE_CLIENT_ID | not present |

`GITHUB_DEVICE_CLIENT_ID` is intentionally absent. The implementer confirmed `startDeviceFlow` reads `GITHUB_CLIENT_ID` (a safe consolidation under the same GitHub OAuth App). The `/v1/auth/cli/device/start` endpoint returned a live `deviceCode` in smoke testing, confirming the fallback works in production.

No secret values were printed at any point.

---

## Live API Smoke Tests

Base origin: `https://orun-api.sourceplane.ai`

### Base API
```
GET /
→ 200 {"status":"ok","service":"orun-api"}
```
✓

### CLI OAuth Loopback Positive
```
GET /v1/auth/github?client=cli&returnTo=http://127.0.0.1:8765/callback/verify-nonce
→ 302 Location: https://github.com/login/oauth/authorize?...&state=<signed-jwt-with-client=cli-and-returnTo>
```
- State JWT contains `client: "cli"` and `returnTo: "http://127.0.0.1:8765/callback/verify-nonce"` ✓
- No tokens in response ✓

### CLI OAuth Loopback Negative
```
GET /v1/auth/github?client=cli&returnTo=https://example.com/callback
→ 400 {"error":"CLI returnTo must be a loopback URL (127.0.0.1 or localhost)","code":"INVALID_REQUEST"}
```
✓

### Dashboard OAuth Still Works
```
GET /v1/auth/github?returnTo=https://orun-dashboard.sourceplane.ai/
→ 302 Location: https://github.com/login/oauth/authorize?...
```
No tokens in response ✓

### Dashboard Open Redirect Blocked
```
GET /v1/auth/github?returnTo=https://evil.example/
→ 400 {"error":"returnTo origin not allowed","code":"INVALID_REQUEST"}
```
✓

### Device Start Endpoint
```
POST /v1/auth/cli/device/start
→ 200 {"deviceCode":"[REDACTED]","userCode":"[REDACTED]","verificationUri":"https://github.com/login/device","verificationUriComplete":"https://github.com/login/device","expiresIn":899,"interval":5}
```
All required fields present ✓. Values redacted in this report.

### Device Poll Negative
```
POST /v1/auth/cli/device/poll {"deviceCode":"definitely-invalid-device-code"}
→ 400 {"error":"GitHub device flow error: incorrect_device_code","code":"INVALID_REQUEST"}
```
Typed JSON error, no crash, no HTML ✓

### Token Refresh Negative
```
POST /v1/auth/cli/token {"refreshToken":"definitely-invalid-refresh-token"}
→ 401 {"error":"Invalid refresh token","code":"UNAUTHORIZED"}
```
✓

### Logout Negative / Idempotent
```
POST /v1/auth/cli/logout {"refreshToken":"definitely-invalid-refresh-token"}
→ 200 {"ok":true}
```
Idempotent for unknown tokens ✓. No token leakage.

---

## Optional Manual Device Login

Skipped. Manual GitHub authorization of the user's account is not appropriate in this automated verification pass. Device start endpoint is confirmed live and returning valid device flow tokens.

---

## Pipeline Config Review

### `.github/workflows/workflow.yml`
- Uses Orun/kiox plan+execute pipeline ✓
- `orun plan --changed` on push/PR ✓
- PR path: `--remote-state` state coordination, no production mutation ✓
- Main (push) path: same workflow, production lane activated by `productionBranch: main` in component ✓
- No secret values printed in workflow file ✓

### `apps/worker/component.yaml`
- `type: cloudflare-worker-turbo` ✓
- `productionBranch: main` ✓
- `migrationCommand: "pnpm exec wrangler d1 migrations apply orun-db --remote --config wrangler.jsonc"` ✓
- `subscribe.environments: [dev, staging, production]` ✓

### `intent.yaml`
- `oci://ghcr.io/sourceplane/stack-tectonic:0.12.0` ✓

### `kiox.yaml`
- `source: ghcr.io/sourceplane/orun:v1.11.0` ✓

---

## Issues

No blocking issues. All PASS criteria met.

---

## Risk Notes

The following non-blocking risks were accepted by Verifier 1 and carry over:

1. **Device endpoint rate limiting not implemented**: `POST /v1/auth/cli/device/start` and `POST /v1/auth/cli/device/poll` are not rate-limited by IP or device code. This was acknowledged in the implementer report as a remaining gap. Production deployment is currently live without this protection. Should be addressed before significant CLI adoption or public announcement.

2. **Refresh token not rotated on use**: Refresh tokens remain valid until explicit logout or expiry. A replay window exists if a refresh token is intercepted after use. Lower severity for internal/developer tooling use case, but worth rotating in a future task.

3. **GC for expired `cli_sessions` rows**: The scheduled Worker GC cron does not purge expired `cli_sessions`. The `expires_at` check correctly blocks token minting. Row accumulation is a housekeeping concern only.

4. **Node.js 20 actions deprecation warning**: Pipeline annotations warn that `actions/cache@v4`, `actions/checkout@v4`, `actions/upload-artifact@v4`, `actions/download-artifact@v4` are deprecated on Node.js 20. These will need updating before September 2026.

---

## Recommended Next Move

Task 0010 is verified live and healthy. Proceed to **Task 0011** (`task-0011-orun-cli-auth-local-remote-state`) — implementing `orun auth login`, `orun auth login --device`, and `orun run --remote-state` in the `sourceplane/orun` CLI.

Device flow rate limiting (risk item 1) should be tracked as a follow-up task (Task 0010.1 or bundled into a future worker hardening PR) before public CLI release.
