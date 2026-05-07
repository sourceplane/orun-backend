# Task 0010 Verifier 2

# Agent

Verifier

# Focus

Live Cloudflare infrastructure and deployment pipeline verification for Task 0010.

This verifier complements `/Users/irinelinson/sourceplane/orun-backend/ai/tasks/task-0010-verifier.md`. The first verifier reviews code, tests, and security. This verifier proves the Task 0010 backend is actually deployed and usable through the live Cloudflare Worker, D1, and CI/CD pipeline.

# Current Repo Context

Primary repo:

```text
/Users/irinelinson/sourceplane/orun-backend
```

Task 0010 PR to verify:

- Repo: `sourceplane/orun-backend`
- PR: #27
- URL: `https://github.com/sourceplane/orun-backend/pull/27`
- Title: `feat: add CLI authentication via device flow and OAuth loopback`
- Branch: `default-orun-workflow`
- Latest head at verifier2 prompt creation: `f97a9712bcbcd652649d890b1dada3ae287c622d`
- Latest PR CI run at verifier2 prompt creation: `https://github.com/sourceplane/orun-backend/actions/runs/25439071374`
- Live API origin: `https://orun-api.sourceplane.ai`
- Live dashboard origin: `https://orun-dashboard.sourceplane.ai`

Task 0010 adds:

- `migrations/0003_cli_sessions.sql`
- CLI OAuth loopback support
- CLI device login endpoints
- CLI refresh/logout endpoints
- CLI session authorization on mutable remote-state routes

# Objective

Verify that Task 0010 is deployed to Cloudflare and that the deployed API, D1 schema, secrets, and pipeline are correct.

This verifier must not PASS based only on local tests or PR checks. It must verify live infrastructure with `wrangler`, `gh`, and HTTP smoke tests.

PASS requires:

1. PR #27 is merged.
2. The post-merge main pipeline completed successfully.
3. The production Worker deployment is newer than the merge and corresponds to the Task 0010 code.
4. The remote D1 database has migration `0003_cli_sessions` applied and the `cli_sessions` schema is present.
5. Required Worker secrets/vars exist without leaking values.
6. New Task 0010 auth endpoints respond from `https://orun-api.sourceplane.ai`.
7. Negative auth/security endpoint checks return typed failures, not HTML, 404s, or Worker crashes.

# Read First

1. `/Users/irinelinson/sourceplane/orun-backend/ai/tasks/task-0010.md`
2. `/Users/irinelinson/sourceplane/orun-backend/ai/tasks/task-0010-verifier.md`
3. `/Users/irinelinson/sourceplane/orun-backend/ai/reports/task-0010-implementer.md`
4. `/Users/irinelinson/sourceplane/orun-backend/apps/worker/component.yaml`
5. `/Users/irinelinson/sourceplane/orun-backend/apps/worker/wrangler.jsonc`
6. `/Users/irinelinson/sourceplane/orun-backend/migrations/0003_cli_sessions.sql`
7. `/Users/irinelinson/sourceplane/orun-backend/.github/workflows/workflow.yml`
8. `/Users/irinelinson/sourceplane/orun-backend/intent.yaml`
9. `/Users/irinelinson/sourceplane/orun-backend/kiox.yaml`

# Verification Steps

## 1. Confirm PR and Main Pipeline State

```bash
gh pr view 27 --repo sourceplane/orun-backend --json state,mergedAt,mergeCommit,url,title,headRefOid
gh run list --repo sourceplane/orun-backend --branch main --limit 10 --json databaseId,status,conclusion,event,workflowName,displayTitle,headSha,url,createdAt
```

If PR #27 is not merged, this verifier cannot PASS yet. Record `BLOCKED` or `FAIL` depending on whether you are expected to merge it as part of verification.

After merge, identify the main-branch run for the merge commit. Inspect logs:

```bash
gh run view <MAIN_RUN_ID> --repo sourceplane/orun-backend --log
```

Verify:

- main pipeline ran after PR #27 merge
- production deploy path was not skipped
- logs show the Worker build/deploy path for `orun-api-worker`
- logs show the migration command for `orun-db`, or a clearly equivalent D1 migration apply step
- no secret values are printed
- the run conclusion is success

Also inspect the latest PR run if needed:

```bash
gh run view 25439071374 --repo sourceplane/orun-backend --log
```

PR runs can prove changed-component verification, but they do not replace post-merge production deploy evidence.

## 2. Verify Wrangler Auth and Worker Deployment

Use Wrangler through the repo package context:

```bash
pnpm --filter @orun/worker exec wrangler whoami
pnpm --filter @orun/worker exec wrangler deployments list --config apps/worker/wrangler.jsonc
pnpm --filter @orun/worker exec wrangler deployments status --config apps/worker/wrangler.jsonc
```

If Wrangler config path handling differs, run from `apps/worker`:

```bash
cd /Users/irinelinson/sourceplane/orun-backend/apps/worker
pnpm exec wrangler whoami
pnpm exec wrangler deployments list --config wrangler.jsonc
pnpm exec wrangler deployments status --config wrangler.jsonc
```

Verify:

- Wrangler is authenticated to the expected Cloudflare account.
- Current Worker deployment is for `orun-api`.
- Current deployment time is after the PR #27 merge/main deploy.
- No rollback or failed deployment is current.
- Deployment status is healthy.

## 3. Verify D1 Migration and Schema

Run:

```bash
pnpm --filter @orun/worker exec wrangler d1 list --config apps/worker/wrangler.jsonc
pnpm --filter @orun/worker exec wrangler d1 info orun-db --config apps/worker/wrangler.jsonc
pnpm --filter @orun/worker exec wrangler d1 migrations list orun-db --remote --config apps/worker/wrangler.jsonc
pnpm --filter @orun/worker exec wrangler d1 execute orun-db --remote --config apps/worker/wrangler.jsonc --command "SELECT name FROM sqlite_master WHERE type='table' AND name='cli_sessions';"
pnpm --filter @orun/worker exec wrangler d1 execute orun-db --remote --config apps/worker/wrangler.jsonc --command "PRAGMA table_info(cli_sessions);"
pnpm --filter @orun/worker exec wrangler d1 execute orun-db --remote --config apps/worker/wrangler.jsonc --command "PRAGMA index_list(cli_sessions);"
```

If config path handling differs, run from `apps/worker` with `--config wrangler.jsonc`.

Verify:

- D1 database `orun-db` exists.
- `0003_cli_sessions` is listed as applied remotely.
- `cli_sessions` table exists.
- Required columns exist:
  - `session_id`
  - `account_id`
  - `github_login`
  - `refresh_token_hash`
  - `allowed_namespace_ids_json`
  - `created_at`
  - `last_used_at`
  - `expires_at`
  - `revoked_at`
  - `user_agent`
  - `device_label`
- `refresh_token_hash` is unique or protected by a unique index.
- Expiry/hash indexes exist.

Do not dump user session rows. Schema-only queries are enough.

## 4. Verify Secrets and Vars Exist

Run:

```bash
pnpm --filter @orun/worker exec wrangler secret list --config apps/worker/wrangler.jsonc
```

Verify names only. Do not print values.

Required secret/variable names for Task 0010 live use:

- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `ORUN_SESSION_SECRET`
- `ORUN_DASHBOARD_URL`
- `ORUN_PUBLIC_URL`
- `ORUN_DEPLOY_TOKEN`

Also verify how `GITHUB_DEVICE_CLIENT_ID` is handled:

- If present as a secret/var, record that.
- If omitted, confirm the deployed code safely falls back to `GITHUB_CLIENT_ID` and docs/tests support that behavior.

Missing required secrets are blockers if they prevent the deployed endpoints from working.

## 5. Live API Smoke Tests

Use `curl` against:

```text
https://orun-api.sourceplane.ai
```

Do not include real secrets in shell history or report output. Redact device codes, refresh tokens, and access tokens from reports.

### Base API

```bash
curl -fsS https://orun-api.sourceplane.ai/
```

Expected: JSON with `status: "ok"` and `service: "orun-api"`.

### CLI OAuth Loopback Positive

```bash
curl -sS -o /tmp/orun-cli-oauth.headers -D /tmp/orun-cli-oauth.headers \
  "https://orun-api.sourceplane.ai/v1/auth/github?client=cli&returnTo=http%3A%2F%2F127.0.0.1%3A8765%2Fcallback%2Fverify-nonce"
head -40 /tmp/orun-cli-oauth.headers
```

Expected:

- HTTP `302`
- `Location` points at `https://github.com/login/oauth/authorize`
- `state` is present
- no Orun session token, refresh token, or GitHub access token is present

### CLI OAuth Loopback Negative

```bash
curl -sS -i \
  "https://orun-api.sourceplane.ai/v1/auth/github?client=cli&returnTo=https%3A%2F%2Fexample.com%2Fcallback"
```

Expected:

- HTTP `400`
- JSON error envelope with `INVALID_REQUEST`
- not a `302`

### Dashboard OAuth Still Works

```bash
curl -sS -i \
  "https://orun-api.sourceplane.ai/v1/auth/github?returnTo=https%3A%2F%2Forun-dashboard.sourceplane.ai%2F"
```

Expected:

- HTTP `302` to GitHub
- no token values in response

### Dashboard Open Redirect Still Blocked

```bash
curl -sS -i \
  "https://orun-api.sourceplane.ai/v1/auth/github?returnTo=https%3A%2F%2Fevil.example%2F"
```

Expected:

- HTTP `400`
- JSON error envelope with `INVALID_REQUEST`

### Device Start Endpoint

```bash
curl -sS -i -X POST https://orun-api.sourceplane.ai/v1/auth/cli/device/start
```

Expected:

- HTTP `200`
- JSON includes `deviceCode`, `userCode`, `verificationUri`, `expiresIn`, and `interval`
- redacted in report

Do not visit the verification URL unless you are intentionally doing a full manual login test.

### Device Poll Negative

```bash
curl -sS -i -X POST https://orun-api.sourceplane.ai/v1/auth/cli/device/poll \
  -H "content-type: application/json" \
  --data '{"deviceCode":"definitely-invalid-device-code"}'
```

Expected:

- typed JSON error
- no Worker crash
- no HTML/plain stack trace

### Token Refresh Negative

```bash
curl -sS -i -X POST https://orun-api.sourceplane.ai/v1/auth/cli/token \
  -H "content-type: application/json" \
  --data '{"refreshToken":"definitely-invalid-refresh-token"}'
```

Expected:

- HTTP `401` or equivalent typed unauthorized response
- JSON error envelope
- no Worker crash

### Logout Negative / Idempotent

```bash
curl -sS -i -X POST https://orun-api.sourceplane.ai/v1/auth/cli/logout \
  -H "content-type: application/json" \
  --data '{"refreshToken":"definitely-invalid-refresh-token"}'
```

Expected:

- documented idempotent success or typed unauthorized response, consistent with implementation/tests
- no Worker crash
- no token leakage

## 6. Optional Full Manual Device Login Smoke

If it is acceptable to authorize with the user's GitHub account, run a full device login smoke:

1. Call `/v1/auth/cli/device/start`.
2. Visit the returned verification URL and enter the user code.
3. Poll `/v1/auth/cli/device/poll`.
4. Confirm response includes Orun `accessToken`, `refreshToken`, `githubLogin`, and `allowedNamespaceIds`.
5. Redact tokens in all notes.
6. Immediately call `/v1/auth/cli/logout` with the refresh token.
7. Confirm `/v1/auth/cli/token` with that refresh token no longer mints an access token.

This optional smoke gives strong end-to-end confidence, but do not block if manual GitHub authorization is not appropriate. If skipped, say so explicitly.

## 7. Pipeline Configuration Review

Inspect:

```bash
sed -n '1,220p' .github/workflows/workflow.yml
sed -n '1,180p' apps/worker/component.yaml
sed -n '1,160p' intent.yaml
```

Verify:

- workflow is still using Orun/kiox, not an unrelated hand-written deploy path
- `apps/worker/component.yaml` still uses `cloudflare-worker-turbo`
- migration command includes remote D1 apply for `orun-db`
- production branch is `main`
- `intent.yaml` still pins `oci://ghcr.io/sourceplane/stack-tectonic:0.12.0`
- main branch deploy path includes production worker deployment and migration application
- PR path does not perform unintended live production mutation

# PASS / FAIL Rules

PASS only if:

- PR #27 is merged.
- main branch production pipeline succeeded after merge.
- Wrangler shows the Worker deployment is current and healthy.
- D1 remote schema includes `cli_sessions` from migration 0003.
- Required secrets/vars exist.
- Live API endpoint smoke tests pass.
- Deploy pipeline logs prove production deploy/migration behavior.
- No secret/token values were leaked in logs or report.

FAIL if:

- PR #27 is unmerged but verifier2 was expected to certify live deployment.
- main pipeline did not run or failed after merge.
- Worker deployment is stale or unhealthy.
- D1 migration 0003 is not applied remotely.
- `cli_sessions` schema is missing or wrong.
- new endpoints return 404/500/HTML instead of expected JSON/redirect behavior.
- required secrets/vars are missing.
- deploy pipeline skips production deploy on main.
- any token/secret is leaked.

# When Done Report

Write:

```text
/Users/irinelinson/sourceplane/orun-backend/ai/reports/task-0010-verifier2.md
```

Use this structure:

```md
# Task 0010 Verifier 2 Report

## Result

PASS or FAIL

## PR / Merge State

## Main Pipeline Review

## Wrangler Worker Review

## D1 Migration Review

## Secrets / Vars Review

## Live API Smoke Tests

## Optional Manual Device Login

## Pipeline Config Review

## Issues

## Risk Notes

## Recommended Next Move
```

If PASS, include:

- PR #27 merge commit
- main pipeline run URL
- Worker deployment evidence
- D1 migration evidence
- endpoints tested
- redaction note for any token-bearing responses

If FAIL, include:

- concrete blocker list
- exact command/output summary
- whether the failure is deploy, D1, secret/config, endpoint behavior, or pipeline logic
- recommended remediation task, likely Task 0010.1 if code/config changes are needed
