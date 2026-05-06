# Task 0010 Verifier

# Agent

Verifier

# Current Repo Context

Task 0010 implementation is complete and open for verification.

Primary repo:

```text
/Users/irinelinson/sourceplane/orun-backend
```

Open PR to verify:

- Repo: `sourceplane/orun-backend`
- PR: #27
- URL: `https://github.com/sourceplane/orun-backend/pull/27`
- Title: `feat: add CLI authentication via device flow and OAuth loopback`
- Branch: `default-orun-workflow`
- Base: `main`
- Head SHA: `800224ff029bea4d837d1c64bcd089eb20fde7cb`
- Merge state at verifier prompt creation: `CLEAN`
- CI run: `https://github.com/sourceplane/orun-backend/actions/runs/25437407888`
- CI surface at verifier prompt creation: green

Visible green checks:

- `Orun Plan`
- `orun-api-worker · dev/staging/production · Verify deploy cloudflare worker turbo`
- `orun-storage · dev/staging/production · Verify turbo package`
- `orun-types · dev/staging/production · Verify turbo package`

Changed files in PR #27:

```text
apps/worker/src/api.test.ts
apps/worker/src/auth/device-flow.test.ts
apps/worker/src/auth/device-flow.ts
apps/worker/src/auth/github-oauth.test.ts
apps/worker/src/auth/github-oauth.ts
apps/worker/src/auth/index.ts
apps/worker/src/auth/session.ts
apps/worker/src/handlers/accounts.test.ts
apps/worker/src/handlers/auth.test.ts
apps/worker/src/handlers/auth.ts
apps/worker/src/handlers/jobs.test.ts
apps/worker/src/handlers/jobs.ts
apps/worker/src/handlers/logs.ts
apps/worker/src/router.ts
migrations/0003_cli_sessions.sql
packages/storage/src/d1.test.ts
packages/storage/src/d1.ts
packages/types/src/index.ts
```

Important local bookkeeping state:

- `/Users/irinelinson/sourceplane/orun-backend/ai/reports/task-0010-implementer.md` exists locally at verifier prompt creation but is not in PR #27's file list.
- Preserve that report. If verification passes, either commit it to PR #27 with verifier bookkeeping or include it in a small follow-up bookkeeping PR.
- Local `main` may be stale compared with `origin/main`; after merge, checkout `main` and fast-forward pull from `origin/main`.

# Objective

Verify Task 0010 and decide PASS or FAIL.

Task 0010 is the backend foundation for local human CLI authentication. It must let `sourceplane/orun` later implement:

```bash
orun auth login
orun auth login --device
orun run <planID> --remote-state
```

outside GitHub Actions, using Orun-issued CLI tokens rather than GitHub Actions OIDC or GitHub PATs.

Verification must confirm:

1. CLI browser OAuth loopback is secure.
2. Backend-mediated GitHub device flow is correct.
3. Access/refresh token issuance is safe.
4. Refresh tokens are stored only as hashes.
5. CLI sessions can use mutable remote-state routes.
6. Dashboard sessions remain read-oriented.
7. GitHub Actions OIDC behavior is not weakened.
8. Existing dashboard OAuth remains compatible.
9. Tests, CI, migrations, and docs are acceptable.

If PASS:

- Ensure `ai/reports/task-0010-implementer.md` is preserved in repo history.
- Write `/Users/irinelinson/sourceplane/orun-backend/ai/reports/task-0010-verifier.md`.
- Update `/Users/irinelinson/sourceplane/orun-backend/ai/state.json`:
  - add `10` to `completed`
  - set `current_task` to `11`
  - set `next_focus` to `task-0011-orun-cli-auth-local-remote-state`
  - keep `repo_health` green
  - set `last_verified` to the verification date
  - add concise notes for PR #27, the CLI auth backend, and any accepted residual risks
- Commit verifier bookkeeping either to PR #27 before merge or to a small bookkeeping PR immediately after merge.
- Merge PR #27 only after local checks and CI log inspection are acceptable.
- Checkout local `main` and fast-forward pull from `origin/main`.

If FAIL:

- Do not merge PR #27.
- Write `/Users/irinelinson/sourceplane/orun-backend/ai/reports/task-0010-verifier.md` with concrete blockers.
- Leave clear PR feedback on PR #27.
- Recommend Task 0010.1 remediation scope.

# Read First

Read these files before verification:

1. `/Users/irinelinson/sourceplane/orun-backend/ai/tasks/task-0010.md`
2. `/Users/irinelinson/sourceplane/orun-backend/ai/reports/task-0010-implementer.md`
3. `/Users/irinelinson/sourceplane/orun-backend/spec/04-worker-api.md`
4. `/Users/irinelinson/sourceplane/orun-backend/spec/06-auth.md`
5. `/Users/irinelinson/sourceplane/orun-backend/spec/07-storage.md`
6. `/Users/irinelinson/sourceplane/orun-backend/spec/09-cli-integration.md`
7. `/Users/irinelinson/sourceplane/orun-backend/apps/worker/src/auth/github-oauth.ts`
8. `/Users/irinelinson/sourceplane/orun-backend/apps/worker/src/auth/github-oauth.test.ts`
9. `/Users/irinelinson/sourceplane/orun-backend/apps/worker/src/auth/device-flow.ts`
10. `/Users/irinelinson/sourceplane/orun-backend/apps/worker/src/auth/device-flow.test.ts`
11. `/Users/irinelinson/sourceplane/orun-backend/apps/worker/src/auth/session.ts`
12. `/Users/irinelinson/sourceplane/orun-backend/apps/worker/src/auth/index.ts`
13. `/Users/irinelinson/sourceplane/orun-backend/apps/worker/src/handlers/auth.ts`
14. `/Users/irinelinson/sourceplane/orun-backend/apps/worker/src/handlers/auth.test.ts`
15. `/Users/irinelinson/sourceplane/orun-backend/apps/worker/src/handlers/jobs.ts`
16. `/Users/irinelinson/sourceplane/orun-backend/apps/worker/src/handlers/jobs.test.ts`
17. `/Users/irinelinson/sourceplane/orun-backend/apps/worker/src/handlers/logs.ts`
18. `/Users/irinelinson/sourceplane/orun-backend/apps/worker/src/router.ts`
19. `/Users/irinelinson/sourceplane/orun-backend/packages/storage/src/d1.ts`
20. `/Users/irinelinson/sourceplane/orun-backend/packages/storage/src/d1.test.ts`
21. `/Users/irinelinson/sourceplane/orun-backend/packages/types/src/index.ts`
22. `/Users/irinelinson/sourceplane/orun-backend/migrations/0003_cli_sessions.sql`
23. `/Users/irinelinson/sourceplane/orun-backend/apps/worker/src/api.test.ts`

# PR and CI Inspection

Inspect PR metadata:

```bash
gh pr view 27 --repo sourceplane/orun-backend --json number,title,url,state,isDraft,headRefName,baseRefName,mergeStateStatus,reviewDecision,statusCheckRollup,commits,files,headRefOid
gh pr diff 27 --repo sourceplane/orun-backend --name-only
```

Inspect successful CI logs, not only summaries:

```bash
gh run view 25437407888 --repo sourceplane/orun-backend --log
```

Verify:

- CI ran the expected Orun/kiox plan and changed-component jobs.
- Worker dry-run builds actually happened.
- Storage/type package verification actually happened.
- No logs leak GitHub access tokens, Orun access tokens, refresh tokens, or secret values.
- No generated `dist/`, `.wrangler/`, `.turbo/`, coverage, or `.orun/` output is committed.

# Required Verification Work

## 1. Branch and Worktree Hygiene

Prefer a clean worktree:

```bash
cd /Users/irinelinson/sourceplane/orun-backend
git fetch origin main default-orun-workflow
git status --short --branch
```

If the shared worktree has untracked verifier files or reports, use a clean worktree for local checks:

```bash
git worktree add /tmp/orun-backend-task-0010-verify origin/default-orun-workflow
cd /tmp/orun-backend-task-0010-verify
```

Do not use destructive commands in the shared worktree.

## 2. OAuth Loopback Review

Verify:

- `GET /v1/auth/github?client=cli&returnTo=http://127.0.0.1:<port>/callback/<nonce>` is accepted.
- `http://localhost:<port>` loopback is accepted.
- Non-loopback CLI `returnTo` values are rejected.
- `https://127.0.0.1`, external hosts, malformed URLs, and protocol tricks are rejected unless there is a documented accepted reason.
- `client`, `returnTo`, and nonce-bearing path are bound into signed state.
- Dashboard `ORUN_DASHBOARD_URL` behavior is unchanged.
- No-`returnTo` JSON callback remains backward-compatible.
- CLI callback returns Orun access/refresh tokens only to the loopback URL fragment.
- GitHub OAuth access token is not included in callback body, redirect fragment, logs, D1, R2, or JWT.

Pay special attention to refresh token exposure:

- Returning the raw Orun refresh token once to the CLI loopback fragment is expected.
- It must never be stored raw in D1 or logs.

## 3. Device Flow Review

Verify:

- `POST /v1/auth/cli/device/start` is implemented as POST, not GET.
- `POST /v1/auth/cli/device/poll` is implemented as POST.
- GitHub device authorization response is parsed correctly.
- Poll handles:
  - `authorization_pending`
  - `slow_down`
  - `expired_token`
  - `access_denied`
  - malformed GitHub responses
  - successful approval
- Successful device poll fetches GitHub user/repo permissions using the GitHub access token only inside the request.
- Successful poll issues Orun access token + raw refresh token once, stores only refresh hash.
- Start/poll rate limiting is either implemented or intentionally deferred with a proposal. Task 0010 explicitly required rate-limiting by IP/device code, so absence should be a blocker unless a proposal exists and the risk is accepted.
- `GITHUB_DEVICE_CLIENT_ID` fallback/requirements are documented and safe. If it reuses `GITHUB_CLIENT_ID`, ensure that is deliberate and tested.

## 4. Refresh and Logout Review

Verify:

- `POST /v1/auth/cli/token` accepts only refresh token body and never accepts refresh tokens as bearer auth.
- Refresh token is hashed before D1 lookup.
- Unknown, expired, and revoked refresh tokens cannot mint access tokens.
- Valid refresh mints a new short-lived access token with `sessionKind: "cli"` and `tokenUse: "access"`.
- `last_used_at` is updated on refresh.
- `POST /v1/auth/cli/logout` revokes the stored session.
- Logout is idempotent for unknown tokens only if that does not leak token existence.
- Raw refresh tokens are never logged.

## 5. Storage and Migration Review

Verify:

- `migrations/0003_cli_sessions.sql` matches `spec/07-storage.md`.
- `refresh_token_hash` is unique and indexed.
- Expiry/revocation fields are present.
- Storage helpers bind values safely and parse `allowed_namespace_ids_json` defensively.
- Tests prove create, get by hash, mark used, revoke, and migration presence.
- No schema migration conflicts with existing D1 migrations.

## 6. Mutable Route Authorization Review

Verify mutable routes allow OIDC or CLI sessions:

- `POST /v1/runs/:runId/jobs/:jobId/claim`
- `POST /v1/runs/:runId/jobs/:jobId/update`
- `POST /v1/runs/:runId/jobs/:jobId/heartbeat`
- `GET /v1/runs/:runId/runnable`
- `POST /v1/runs/:runId/logs/:jobId`

Verify dashboard sessions receive `403 FORBIDDEN` on all mutable routes.

Verify OIDC behavior is unchanged.

Verify CLI namespace resolution:

- It only searches namespaces in `allowedNamespaceIds`.
- It cannot infer or access another namespace by guessing `runId`.
- It returns a clear `NOT_FOUND` or `FORBIDDEN` for unauthorized/missing runs.
- It is acceptable for local remote-state performance, or any hot-path risk is noted.

Also check `POST /v1/runs`:

- Task 0010 needs local CLI sessions to create/join remote runs. Ensure session-created runs are safe and namespace-scoped.
- If dashboard sessions can still create runs because the route is `oidc_or_session`, decide whether that is intended. The original Task 0010 focused mutable job/log routes, but local CLI execution needs run creation. If dashboard run creation is newly unsafe, fail or require a proposal/fix.

## 7. Rate-Limit Test / Scope Review

PR #27 touches `apps/worker/src/api.test.ts` and the commit message says it fixes RateLimitCounter tests to match a 300-burst limit from PR #25.

The implementer report also says:

```text
160 tests pass, 2 pre-existing RateLimitCounter DO failures (unrelated to this feature)
```

Resolve this contradiction:

- Run the Worker tests locally from clean PR content.
- Confirm whether there are still rate-limit failures.
- Confirm `apps/worker/src/api.test.ts` changes are limited to adapting to already-merged PR #25 behavior.
- Do not accept hidden rate-limit behavior changes as part of Task 0010 unless they are only test alignment with main.

## 8. Docs and Proposal Discipline

Verify specs/docs match implementation:

- `spec/04-worker-api.md`
- `spec/06-auth.md`
- `spec/07-storage.md`
- `spec/09-cli-integration.md`

If implementation deviates in behavior, security, API shape, persistence model, or roadmap scope, require or create a proposal under `/ai/proposals/` before PASS.

Examples of proposal-worthy drift:

- Device start/poll uses a different method/path than spec.
- Mutable route auth broadens dashboard session powers.
- Raw refresh tokens are stored or accepted on normal API routes.
- GitHub OAuth access tokens are retained beyond the current request.
- Device rate limiting is deferred.

# Required Local Checks

Run from clean PR #27 content:

```bash
pnpm install
pnpm --filter @orun/storage test
pnpm --filter @orun/storage typecheck
pnpm --filter @orun/worker test
pnpm --filter @orun/worker typecheck
pnpm --filter @orun/worker build
pnpm exec turbo run test typecheck build
pnpm exec turbo run lint
git diff --check
/Users/irinelinson/.local/bin/kiox -- orun plan --changed
/Users/irinelinson/.local/bin/kiox -- orun run --changed
```

If `/Users/irinelinson/.local/bin/kiox` is unavailable but `kiox` is on `PATH`, use `kiox`.

If local kiox run deploys to production from a PR branch, stop and inspect the workflow/config before proceeding. It should behave as a changed-component verification path unless intentionally on `main`.

# Acceptance Criteria

PR #27 can PASS only when:

1. CLI loopback OAuth is secure and tested.
2. Device start/poll login is implemented as specified and tested.
3. Refresh/logout are implemented safely and tested.
4. D1 migration and storage helpers store only hashed refresh tokens.
5. CLI sessions can call mutable remote-state routes.
6. Dashboard sessions cannot call mutable remote-state routes.
7. Existing OIDC and dashboard OAuth behavior remains compatible.
8. No GitHub OAuth access token, GitHub PAT, or raw refresh token is persisted or logged.
9. Rate-limit test changes are understood and not hiding an unrelated behavior change.
10. Local checks pass from clean PR content.
11. GitHub Actions logs are inspected and acceptable.
12. Implementer and verifier reports are preserved.
13. State bookkeeping is updated.

# When Done Report

Write:

```text
/Users/irinelinson/sourceplane/orun-backend/ai/reports/task-0010-verifier.md
```

Use this structure:

```md
# Task 0010 Verifier Report

## Result

PASS or FAIL

## PR

## Checks

## CI Log Review

## OAuth Loopback Review

## Device Flow Review

## Refresh / Logout Review

## Storage Migration Review

## Mutable Route Authorization Review

## Rate-Limit Scope Review

## Docs and Spec Review

## Issues

## Risk Notes

## Spec Proposals

## Merge / Sync Actions

## Recommended Next Move
```

If PASS, include:

- PR #27 merge method and merge commit
- local `main` sync evidence
- whether `ai/reports/task-0010-implementer.md` was committed
- any accepted residual risks
- recommendation to proceed to Task 0011

If FAIL, include:

- numbered blockers
- exact files/lines or PR diff areas where possible
- failed commands/checks
- whether the failure is security, API contract, persistence, test, CI, docs, or scope
- recommended Task 0010.1 remediation scope
