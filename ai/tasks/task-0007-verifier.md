# Task 0007 Verification

# Agent
Verifier

# Current Repo Context
Task 0007 implemented the account and repository linking layer in `apps/worker`.

GitHub PR to verify:

- PR: #14
- URL: `https://github.com/sourceplane/orun-backend/pull/14`
- Title: `feat: implement account and repository linking`
- Branch: `task-0007-account-repo-linking`
- Base: `main`
- State at prompt creation: open, ready for review
- Mergeability at prompt creation: `MERGEABLE`
- Head SHA at prompt creation: `1b6160f159b0461ef16880acd6b62d3dac2f3784`
- Surface CI at prompt creation: green
- Workflow run to inspect: `25249486863`

Changed files in PR #14 at prompt creation:

- `ai/reports/task-0007-implementer.md`
- `apps/worker/src/handlers/accounts.test.ts`
- `apps/worker/src/handlers/accounts.ts`
- `apps/worker/src/handlers/jobs.ts`
- `apps/worker/src/handlers/logs.ts`
- `apps/worker/src/handlers/runs.ts`
- `apps/worker/src/http.ts`
- `apps/worker/src/router.ts`

Implementer-reported checks:

- `pnpm --filter @orun/worker test`: 118 tests passed
- `pnpm --filter @orun/worker typecheck`: passed
- `pnpm --filter @orun/worker build`: passed
- `pnpm exec turbo run test typecheck build`: 15/15 tasks passed
- `kiox -- orun plan --changed`: 1 component, 3 envs
- `kiox -- orun run --changed`: 3/3 jobs succeeded

Important local state:

- The current checkout may already be on `task-0007-account-repo-linking`.
- `ai/tasks/task-0007.md` exists locally at prompt creation but is not part of PR #14. If verification passes, include it in the PR so task history is complete.
- This verifier prompt file, `ai/tasks/task-0007-verifier.md`, may be untracked at handoff. Include it only if you intentionally keep verifier prompt history in the PR.
- Older unrelated untracked files may exist:
  - `ai/tasks/task-0002-verifier.md`
  - `ai/tasks/task-0003-verifier.md`
  - `ai/tasks/task-0004-verifier.md`
- Do not include those older verifier prompts unless you intentionally decide to backfill prior history.
- Do not destructively reset local branches or discard user/local files.

Relevant baseline before Task 0007:

- Tasks 0001-0006 are complete and verified.
- `main` at Task 0007 prompt creation was `6d29836`: `feat: implement Worker API gateway (#13)`.
- `ai/state.json` has `current_task: 7`, `completed: [1, 2, 3, 4, 5, 6]`, `repo_health: green`.
- Worker API from Task 0006 had auth, runs, jobs, logs, rate limiting, and scheduled GC but no `/v1/accounts/**` routes.
- Current schema has `accounts` and `account_repos`, but no `accounts.tier`, no token storage, and no denormalized `namespace_slug` on `account_repos`.
- Session JWTs contain `{ sub, allowedNamespaceIds, exp, iat }` and intentionally do not contain GitHub access tokens.

# Objective
Verify Task 0007 end to end against the task prompt, specs, implementation report, PR diff, local quality gates, local kiox/orun behavior, and PR CI logs.

If PASS:

- Write `ai/reports/task-0007-verifier.md`.
- Update `ai/state.json` for Task 0008:
  - Add `7` to `completed`.
  - Set `current_task` to `8`.
  - Keep `repo_health` green unless a meaningful risk should change it.
  - Set `next_focus` to `task-0008-orun-remote-state-client-integration`.
  - Add concise verification notes, including checks and accepted risks.
- Include `ai/tasks/task-0007.md` in the PR if it remains untracked and matches the implemented task.
- Push the verifier report/state and any approved verification-only fixes to PR #14.
- Wait for CI, inspect logs, then merge PR #14 if all criteria are met.
- Sync local `main` safely after merge.

If FAIL:

- Do not merge.
- Write a verifier report with concrete blockers.
- Leave clear PR feedback describing required fixes.

# Read First
Read these before running checks:

1. `ai/tasks/task-0007.md`
2. `ai/reports/task-0007-implementer.md`
3. `ai/reports/task-0006-verifier.md`
4. `agents/orchestrator.md`
5. `SCHEDULE.md`
6. `spec/04-worker-api.md`
7. `spec/06-auth.md`
8. `spec/07-storage.md`
9. `spec/08-account-repo-linking.md`
10. `spec/09-cli-integration.md` backend API support and authentication sections
11. `spec/10-rate-limiting.md`
12. `migrations/0001_init.sql`
13. `migrations/0002_namespaces_account.sql`
14. `apps/worker/src/router.ts`
15. `apps/worker/src/http.ts`
16. `apps/worker/src/rate-limit.ts`
17. `apps/worker/src/auth/index.ts`
18. `apps/worker/src/auth/session.ts`
19. `apps/worker/src/auth/github-oauth.ts`
20. `apps/worker/src/handlers/accounts.ts`
21. `apps/worker/src/handlers/accounts.test.ts`
22. `apps/worker/src/handlers/runs.ts`
23. `apps/worker/src/handlers/jobs.ts`
24. `apps/worker/src/handlers/logs.ts`
25. `apps/worker/src/api.test.ts`
26. `packages/storage/src/d1.ts`
27. `packages/storage/src/d1.test.ts`
28. `packages/types/src/index.ts`

Inspect PR #14 metadata and diff:

```bash
gh pr view 14 --repo sourceplane/orun-backend --json number,title,url,state,isDraft,headRefName,baseRefName,mergeable,body,commits,files,reviews,statusCheckRollup,headRefOid
gh pr diff 14 --repo sourceplane/orun-backend --name-only
gh pr diff 14 --repo sourceplane/orun-backend --patch --color=never
```

# Required Outcomes
Verify every Task 0007 acceptance criterion:

1. Account routes exist under `/v1/accounts/**` and require session auth.
2. `POST /v1/accounts` idempotently creates or returns the account for the GitHub login.
3. Account IDs are generated with `crypto.randomUUID()`.
4. Account creation does not rely on D1 `RETURNING`.
5. `GET /v1/accounts/me` returns existing account details.
6. `GET /v1/accounts/me` returns typed 404 for missing accounts.
7. `POST /v1/accounts/repos` requires `repoFullName` and a GitHub token seam.
8. GitHub token is accepted via `X-GitHub-Access-Token`.
9. `X-GitHub-Access-Token` is allowed by CORS.
10. GitHub token is never stored, logged, returned, or added to a session JWT.
11. Repo full name validation rejects malformed, empty, extra-slash, and traversal-like values.
12. GitHub API path segments are URL-encoded.
13. GitHub repo admin permission allows linking.
14. Org admin fallback allows linking when repo admin is false.
15. Non-admin users are rejected with 403.
16. Repo not found maps to 404.
17. Missing GitHub token maps to the implementer-chosen typed client error, currently `UNAUTHORIZED`.
18. Non-OK GitHub API failures map to 500.
19. GitHub API responses are parsed safely enough that missing `id`, `full_name`, or `owner.login` cannot create corrupt D1 rows.
20. Namespace rows are upserted before account links are inserted.
21. Link creation is idempotent and preserves original `linkedAt`.
22. Linked repos list joins `account_repos` to `namespaces` and sorts newest first.
23. Listing repos for a missing account returns `{ repos: [] }`.
24. Unlink deletes only the account visibility grant.
25. Unlink is idempotent for missing account/link.
26. Unlink does not delete namespaces, runs, jobs, logs, or coordinator state.
27. `resolveSessionNamespaceIds` unions JWT namespaces and D1 linked namespaces.
28. `resolveSessionNamespaceIds` dedupes deterministically.
29. Session read access includes linked repos for:
    - `GET /v1/runs`
    - `GET /v1/runs/:runId`
    - `GET /v1/runs/:runId/jobs`
    - `GET /v1/runs/:runId/jobs/:jobId/status`
    - `GET /v1/runs/:runId/logs/:jobId`
30. Session-created runs can target linked namespaces only if the namespace row exists and access is resolved.
31. Session-created runs still reject unlinked namespaces.
32. OIDC routes continue to use the OIDC namespace from the request token.
33. Deploy-token behavior remains unchanged.
34. Rate limiting remains deterministic for account endpoints and does not query nonexistent account tiers.
35. No billing, premium tier, `accounts.tier`, or token-storage migration is added.
36. No Go CLI changes are made.
37. Existing Task 0006 Worker API behavior does not regress.
38. Task 0006 verifier fixes do not regress:
    - log upload must not overwrite existing job status/runner/timestamps
    - job update must not erase existing `logRef`
    - idempotent create/join must reject when `/state` is unavailable for checksum verification
39. Tests use mocked GitHub API calls and never hit live GitHub.
40. Local checks pass.
41. Local kiox/orun validation passes or any changed-detection oddity is explained.
42. PR CI logs prove meaningful validation ran.

# Local Commands To Run
Start from the PR branch:

```bash
git fetch origin main task-0007-account-repo-linking
git switch task-0007-account-repo-linking
git status --short --branch
```

Run local quality gates:

```bash
pnpm install
pnpm --filter @orun/worker test
pnpm --filter @orun/worker typecheck
pnpm --filter @orun/worker build
pnpm exec turbo run test typecheck build
pnpm exec turbo run lint
```

Run focused package checks if needed:

```bash
pnpm --filter @orun/types test
pnpm --filter @orun/storage test
pnpm --filter @orun/coordinator test
cd apps/worker && pnpm exec wrangler deploy --dry-run --outdir=dist && cd ../..
```

Run inspection searches:

```bash
rg -n "X-GitHub-Access-Token|access[_-]?token|githubAccessToken|Authorization|console\\.|sessionToken|jwt|tier|billing" apps/worker/src --glob '!*.test.ts'
rg -n "accounts|account_repos|resolveSessionNamespaceIds|allowedNamespaceIds|assertNamespaceAccess" apps/worker/src packages/storage/src migrations
rg -n "\\bany\\b|@ts-ignore|as any" apps/worker/src/handlers/accounts.ts apps/worker/src/handlers/accounts.test.ts
rg -n "RETURNING|INSERT OR IGNORE|ON CONFLICT|DELETE FROM namespaces|DELETE FROM runs|DELETE FROM jobs" apps/worker/src/handlers/accounts.ts packages/storage/src/d1.ts
rg -n "fetch\\(|api.github.com|permissions|memberships|full_name|owner.login|randomUUID" apps/worker/src/handlers/accounts.ts apps/worker/src/handlers/accounts.test.ts
git diff --check main...HEAD
```

Run local kiox/orun validation:

```bash
/Users/irinelinson/.local/bin/kiox -- orun plan --changed
/Users/irinelinson/.local/bin/kiox -- orun run --changed
```

Expected changed component at prompt creation is `orun-api-worker` across 3 envs. If local kiox reports `0 components` or `0 jobs`, do not accept that blindly. Determine whether changed detection is expected locally because of branch/base state, and rely on CI logs to prove PR validation ran for the Worker component. If CI also reports `0 jobs`, treat that as a blocker or require a workflow/config fix.

# CI Log Verification
Do not trust green checks by status alone. Inspect logs.

```bash
gh pr checks 14 --repo sourceplane/orun-backend --watch
gh run view 25249486863 --repo sourceplane/orun-backend --json databaseId,status,conclusion,headBranch,headSha,jobs
gh run view 25249486863 --repo sourceplane/orun-backend --log
```

Confirm in logs:

- The workflow used PR #14's head SHA `1b6160f159b0461ef16880acd6b62d3dac2f3784`, or a newer verifier SHA if you add commits.
- `kiox -- orun plan --changed` ran in the Review Plan job.
- `kiox -- orun run --changed` ran in the Build & Deploy job.
- Changed component set includes `orun-api-worker`.
- Worker build, typecheck, and Wrangler dry-run ran.
- Determine whether Worker unit tests ran in CI. At prompt creation, prior tasks showed unit tests do not run in CI; if still true, note the limitation clearly and rely on local test output.
- No live Cloudflare production deploy occurred unexpectedly. Pull request logs should show production deploy skipped and dev deploy dry-run only.
- No warning invalidates the result. Record any Node/Wrangler/action warnings that remain non-blocking.

# Code Review Focus
Review the actual implementation, not just tests.

## Account Routes and HTTP

- Routes are exact and do not shadow existing `/v1/runs/**` or auth routes.
- Session-only account routes reject OIDC and deploy contexts.
- JSON success and error responses preserve the existing CORS/error envelope conventions.
- `OPTIONS` still works without auth and includes the GitHub token header.
- Missing or invalid JSON produces deterministic typed errors.
- `DELETE /v1/accounts/repos/:namespaceId` handles URL-decoded namespace IDs safely.

## D1 Account Helpers

- `getOrCreateAccount` is race-tolerant enough for concurrent calls with the same GitHub login.
- Existing accounts keep their original `account_id` and `created_at`.
- `linkRepo` upserts namespace slug and last-seen timestamp without deleting any run data.
- Existing links keep their original `linked_at`.
- `listLinkedRepos` cannot leak another account's repos.
- `unlinkRepo` is scoped by both `account_id` and `namespace_id`.
- All SQL uses prepared statements with bound parameters.

## GitHub Verification

- Repo full names with `owner/repo/extra`, `/owner/repo`, `owner/repo/`, `owner//repo`, `../repo`, `owner/..`, and empty values are rejected.
- Segments are encoded before building GitHub URLs.
- Required headers are present:
  - `Authorization: Bearer <token>`
  - `Accept: application/vnd.github+json`
  - `User-Agent: orun-backend-account-linking`
- 404 from repo lookup becomes `NOT_FOUND`.
- Non-OK from repo lookup becomes `INTERNAL_ERROR`.
- Missing token becomes the chosen typed client error.
- Org-admin fallback only grants access for `role === "admin"`.
- Non-OK org membership lookup does not accidentally grant access.
- Malformed GitHub repo JSON cannot link `namespaceId: "undefined"` or an empty slug. If this is not handled, decide whether it is a blocker or require a small verifier fix/test.
- Tests assert no live GitHub calls are made.

## Session Namespace Resolution

- Linked repos expand only session read/create behavior, not OIDC execution writes.
- JWT namespaces remain included even if no account exists.
- Account-linked namespaces are deduped.
- Access checks do not leak whether a run exists in a disallowed namespace.
- Session reads over multiple namespaces do not return another user's account links.
- Session-created runs still require `namespaceId` and a known namespace slug.
- There is no hidden account ownership of runs, jobs, logs, or namespaces.

## Rate Limiting

- Account routes remain rate-limited.
- The implemented session key choice is documented in the report. Decide whether `authCtx.allowedNamespaceIds[0] ?? authCtx.actor` is acceptable for account routes; the task preferred `account:{actor}` but permitted documented reuse if deterministic.
- No account tier lookup is introduced.
- No `accounts.tier` query or migration appears.

## Regression Risks

- Existing run/job/log tests still cover Task 0006 behavior.
- New imports from `./accounts` do not create circular runtime problems in Worker builds.
- Adding D1 queries to session reads does not affect OIDC-only execution endpoints.
- CORS header changes do not drop existing allowed headers.
- The PR does not accidentally include unrelated old verifier prompt files.

# Constraints
- Do not merge if any security-critical account linking issue remains.
- Do not merge if GitHub tokens are stored, logged, or embedded in session JWTs.
- Do not merge if repo linking can be performed without admin or org-admin verification.
- Do not merge if linked namespace access can leak across accounts.
- Do not merge if unlink deletes run/job/log/namespace data.
- Do not add billing/tier behavior during verification.
- Do not make broad refactors as verifier fixes.
- Keep verification-only fixes small and directly tied to concrete blockers.
- Never use destructive git commands to reset local work.

# Integration Notes
- Task 0008 is the next scheduled task and should remain unblocked by this account layer.
- Task 0009 dashboard depends on these account endpoints and linked namespace session reads.
- Persistent `account_repos` grants are intended to complement, not replace, OAuth session `allowedNamespaceIds`.
- OIDC lazy namespace slug updates remain the repo rename/transfer refresh path.
- Rate-limit tier upgrades remain future work because the schema has no `tier` column.

# Acceptance Criteria
Task 0007 can PASS only if:

- All required account endpoints behave as specified.
- GitHub admin verification is correct, safe, and fully mocked in tests.
- GitHub token handling follows the no-storage/no-leak rules.
- Linked repo D1 writes are idempotent and scoped to the session account.
- Session namespace reads include linked repos without weakening OIDC isolation.
- Unlink removes only visibility grants.
- Existing Worker API behavior remains intact.
- Local Worker tests, typecheck, build, and full turbo checks pass.
- Local kiox/orun validation passes or is convincingly explained with CI corroboration.
- PR CI logs show the expected changed Worker validation.
- Verifier report and state updates are committed to the PR before merge.

# When Done Report
Write:

```text
ai/reports/task-0007-verifier.md
```

Use this structure:

```text
# Task 0007 Verifier Report

Result: PASS|FAIL

## Checks
- Local commands run and results
- CI run/log inspection results
- PR metadata reviewed

## Issues
- Blockers if FAIL
- Verification-only fixes if any

## Risk Notes
- Accepted limitations, including CI unit-test coverage status
- Any non-blocking GitHub/account/rate-limit tradeoffs

## Recommended Next Move
- If PASS: merged PR #14, local main synced, next task is Task 0008
- If FAIL: leave PR open and list required implementer fixes
```
