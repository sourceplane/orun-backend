# Task 0005 Verification

# Agent
Verifier

# Current Repo Context
Task 0005 implemented the Worker authentication module under `apps/worker/src/auth/`.

GitHub PR to verify:

- PR: #12
- URL: `https://github.com/sourceplane/orun-backend/pull/12`
- Title: `feat: implement worker auth module`
- Branch: `task-0005-auth`
- Base: `main`
- State at prompt creation: open, ready for review
- Mergeability at prompt creation: `MERGEABLE`
- Head SHA at prompt creation: `cae010e8fa3b59567f000d386b99a9671a9f17ce`
- Surface CI at prompt creation: green
- Workflow run to inspect: `25243269728`

Changed files in PR #12 at prompt creation:

- `ai/reports/task-0005-implementer.md`
- `apps/worker/src/auth/base64url.test.ts`
- `apps/worker/src/auth/base64url.ts`
- `apps/worker/src/auth/errors.ts`
- `apps/worker/src/auth/github-oauth.test.ts`
- `apps/worker/src/auth/github-oauth.ts`
- `apps/worker/src/auth/index.test.ts`
- `apps/worker/src/auth/index.ts`
- `apps/worker/src/auth/jwt.ts`
- `apps/worker/src/auth/namespace.test.ts`
- `apps/worker/src/auth/namespace.ts`
- `apps/worker/src/auth/oidc.test.ts`
- `apps/worker/src/auth/oidc.ts`
- `apps/worker/src/auth/session.test.ts`
- `apps/worker/src/auth/session.ts`
- `packages/types/src/index.test.ts`
- `packages/types/src/index.ts`
- `spec/06-auth.md`

Important local state:

- The current checkout may already be on `task-0005-auth`.
- There are unrelated untracked prior verifier prompts: `ai/tasks/task-0002-verifier.md`, `ai/tasks/task-0003-verifier.md`, and `ai/tasks/task-0004-verifier.md`. Do not include those in this verification unless you intentionally decide to backfill prior task history.
- This prompt file, `ai/tasks/task-0005-verifier.md`, may also be untracked at handoff. If you commit verifier task history, include only this file and do not sweep in older untracked prompts by accident.
- Do not destructively reset local branches or discard user/unrelated work.

Orchestrator local baseline at prompt creation:

- `pnpm exec turbo run typecheck` passed for 5 packages.
- `pnpm exec turbo run build` passed for 5 packages; Worker dry-run bundle succeeded with a Wrangler version warning.
- `pnpm exec turbo run test` passed: 148 tests total, including 55 Worker auth tests.
- `pnpm exec turbo run lint` passed, but lint scripts are currently `lint deferred`.
- `/Users/irinelinson/.local/bin/kiox -- orun plan --changed` reported `2 components x 3 envs -> 6 jobs`: `orun-api-worker`, `orun-types`.
- `/Users/irinelinson/.local/bin/kiox -- orun run --changed` passed: 6 jobs succeeded, exec id `orun-backend-20260502-6d51bf`.
- CI logs for run `25243269728` show `kiox -- orun plan --changed` and `kiox -- orun run --changed`; changed components were `orun-api-worker` and `orun-types`. The CI run built and typechecked those surfaces, but did not appear to run the new Worker unit tests. Verify this yourself and document it.

# Objective
Verify Task 0005 end to end against the task prompt, specs, implementation report, PR diff, local quality gates, local kiox/orun behavior, and PR CI logs.

If PASS, write the verifier report, update state for Task 0006, push the report/state to PR #12, wait for CI, inspect logs, merge the PR, and sync local `main` safely.

If FAIL, do not merge. Write a verifier report with concrete blockers and leave clear PR feedback.

# Read First
Read these before running checks:

1. `ai/tasks/task-0005.md`
2. `ai/reports/task-0005-implementer.md`
3. `ai/reports/task-0003-verifier.md`
4. `ai/reports/task-0004-verifier.md`
5. `agents/orchestrator.md`
6. `SCHEDULE.md`
7. `spec/00-constitution.md`
8. `spec/03-types-package.md`
9. `spec/04-worker-api.md` authentication and namespace enforcement sections
10. `spec/06-auth.md`
11. `spec/08-account-repo-linking.md` repo/admin permission model sections
12. `apps/worker/src/auth/errors.ts`
13. `apps/worker/src/auth/base64url.ts`
14. `apps/worker/src/auth/jwt.ts`
15. `apps/worker/src/auth/oidc.ts`
16. `apps/worker/src/auth/session.ts`
17. `apps/worker/src/auth/github-oauth.ts`
18. `apps/worker/src/auth/namespace.ts`
19. `apps/worker/src/auth/index.ts`
20. `apps/worker/src/auth/*.test.ts`
21. `apps/worker/src/index.ts`
22. `apps/worker/wrangler.jsonc`
23. `packages/types/src/index.ts`
24. `packages/types/src/index.test.ts`
25. `migrations/0001_init.sql`

Inspect PR #12 metadata and diff:

```bash
gh pr view 12 --repo sourceplane/orun-backend --json number,title,url,state,isDraft,headRefName,baseRefName,mergeable,body,commits,files,reviews,statusCheckRollup,headRefOid
gh pr diff 12 --repo sourceplane/orun-backend --name-only
gh pr diff 12 --repo sourceplane/orun-backend --patch --color=never
```

# Required Verification Work
Verify every Task 0005 acceptance criterion:

1. `apps/worker/src/auth/` exists and exports a cohesive auth module.
2. OIDC verification uses GitHub JWKS, validates RS256 signatures, issuer, audience, expiry, iat skew, and required GitHub claims.
3. JWKS is cached in memory for 15 minutes and tests prove cache reuse.
4. `extractNamespaceFromOIDC()` maps `repository_id` to `namespaceId` and `repository` to `namespaceSlug`.
5. Session JWT issuance and verification use HS256 via Web Crypto and reject expired, tampered, malformed, unsigned, unsupported-alg, and wrong-secret tokens.
6. OAuth helpers build GitHub authorize redirects, verify signed CSRF state, exchange code, fetch user/repo/org data with pagination, compute admin namespace IDs, deduplicate IDs, and issue session tokens.
7. `authenticate()` supports deploy token, OIDC, and session modes and returns a typed `RequestContext`.
8. OIDC authentication lazily upserts namespace slug into D1.
9. New auth env fields are added to `@orun/types` and type tests cover them.
10. Tests are deterministic and do not call live GitHub endpoints.
11. No Worker run/job/log/account/rate-limit routing is implemented.
12. `RunCoordinator` export from `apps/worker/src/index.ts` still works.
13. Local quality gates pass.
14. Local kiox/orun validation is run and documented.
15. PR CI passes, and logs prove meaningful validation ran.

# Local Commands To Run
Start from the PR branch:

```bash
git fetch origin main task-0005-auth
git switch task-0005-auth
git status --short --branch
```

Run local quality gates:

```bash
pnpm install
pnpm exec turbo run typecheck
pnpm exec turbo run build
pnpm exec turbo run test
pnpm exec turbo run lint
pnpm --filter @orun/worker test
pnpm --filter @orun/types test
cd apps/worker && pnpm exec wrangler deploy --dry-run --outdir=dist && cd ../..
```

Run focused inspection checks:

```bash
rg -n "\\bBuffer\\b|from ['\\\"]node|require\\(|process\\.|crypto\\.create|jsonwebtoken|jose|jwt-decode|console\\." apps/worker/src/auth
rg -n "\\bany\\b|@ts-ignore|as any" apps/worker/src/auth packages/types/src
rg -n "run|job|log|account|rate|router|route|fetch\\(" apps/worker/src --glob '!auth/github-oauth.ts' --glob '!auth/*.test.ts'
rg -n "ORUN_SESSION_SECRET|ORUN_DEPLOY_TOKEN|GITHUB_CLIENT_ID|GITHUB_CLIENT_SECRET|ORUN_PUBLIC_URL" packages/types/src apps/worker/src apps/worker/wrangler.jsonc spec/06-auth.md
find apps/worker/dist -maxdepth 3 -type f | sort
```

Run local kiox/orun validation:

```bash
/Users/irinelinson/.local/bin/kiox -- orun plan --changed
/Users/irinelinson/.local/bin/kiox -- orun run --changed
```

Expected changed components are `orun-api-worker` and `orun-types`. If local kiox reports `0 components` or `0 jobs`, do not accept that blindly. Determine whether changed detection is expected locally because of branch/base state, and rely on CI logs to prove PR validation ran for the Worker and types components. If CI also reports `0 jobs`, treat that as a blocker or require a workflow/config fix.

# CI Log Verification
Do not trust green checks by status alone. Inspect logs.

```bash
gh pr checks 12 --repo sourceplane/orun-backend --watch
gh run view 25243269728 --repo sourceplane/orun-backend --json databaseId,status,conclusion,headBranch,headSha,jobs
gh run view 25243269728 --repo sourceplane/orun-backend --log
```

Confirm in logs:

- `sourceplane/kiox-action@v2.1.2` initialized the workspace.
- The PR run used PR head SHA `cae010e8fa3b59567f000d386b99a9671a9f17ce`, or a newer pushed verifier SHA if you add commits. If logs mention a pull-request merge commit such as `214193c2863b6d91d953a7591c68eb8678a9735f`, map it back to the PR head before accepting it.
- `kiox -- orun plan --changed` ran in the Review Plan job.
- `kiox -- orun run --changed` ran in the Build & Deploy job.
- The changed component set includes `orun-api-worker` and `orun-types`.
- Worker dry-run build and typecheck ran for `@orun/worker`.
- Type package build and typecheck ran for `@orun/types`.
- Determine whether Worker auth unit tests ran in CI. At prompt creation, they did not appear to run; if still true, note the CI limitation clearly and rely on local test output.
- No live Cloudflare production deploy occurred unexpectedly. Pull request logs should show production deploy skipped and dev deploy dry-run only.
- No warning invalidates the result. The current Node.js 20 action deprecation and Wrangler version warnings are known; decide whether they are acceptable risk notes or blockers.

# Code Review Focus
Review the actual implementation, not just tests.

## Error Shape

- `OrunError` uses the existing `ErrorCode` union from `@orun/types`.
- `UNAUTHORIZED`, `FORBIDDEN`, `INVALID_REQUEST`, and `INTERNAL_ERROR` map to sensible HTTP statuses.
- Auth failures do not leak secrets, tokens, JWT payloads, GitHub access tokens, or session tokens.
- Invalid OAuth input uses `INVALID_REQUEST`/400, not generic 500.
- Missing configuration errors are clear and deliberately classified.

## Base64url and JWT Utilities

- Production code is Workers-compatible and does not use Node-only APIs such as `Buffer`.
- Base64url encode/decode handles padding and binary inputs correctly.
- Malformed JWTs and JSON parse failures become typed `OrunError`s.
- HMAC verification uses Web Crypto verification, not manual string comparison.
- `decodeJwt()` does not trust decoded headers or payloads before later verification.
- Empty tokens, empty signatures, invalid base64url, oversized/malformed segments, and unsupported algorithms are handled safely.

## GitHub OIDC

- JWKS is fetched from `env.GITHUB_JWKS_URL` and cached by URL for 15 minutes.
- Header requires `alg === "RS256"` and a non-empty `kid`.
- The matching key is selected only by `kid`; decide whether missing/incorrect JWK `kty`, `use`, or `alg` metadata needs explicit rejection or whether Web Crypto import is sufficient.
- The signature verifies with `RSASSA-PKCS1-v1_5` SHA-256 over the exact `header.payload` signing input.
- Issuer is exactly `https://token.actions.githubusercontent.com`.
- Audience comparison is exact. If `aud` is an array, it must contain the configured audience. Probe whether returned `OIDCClaims.aud` should be the matched audience rather than the first array entry.
- `exp > now` and `iat <= now + 60` are enforced with no accidental grace period.
- Required claims are non-empty strings: `repository`, `repository_id`, `repository_owner`, `repository_owner_id`, `actor`.
- `looksLikeOIDC()` only routes likely GitHub OIDC tokens and does not authenticate anything by itself.
- Unit tests generate an RSA key pair, mock JWKS fetches, avoid live GitHub calls, and cover wrong issuer/audience, unknown kid, invalid signature, malformed token, unsupported alg, expired token, future iat, missing claims, and cache reuse.

## Session JWT

- Issued tokens use `HS256`, default TTL 3600 seconds, and include `iat` and `exp`.
- Verification rejects expired, tampered, malformed, wrong-secret, unsupported-alg, unsigned/`none`, and empty-secret tokens.
- `sub` is a non-empty string and `allowedNamespaceIds` is an array of strings.
- Probe whether `iat` should also be validated as a number because `SessionClaims` requires it.
- Verify session failures are `UNAUTHORIZED` and do not leak token contents.

## GitHub OAuth

- Redirects include `client_id`, `redirect_uri`, `scope=read:user,read:org`, and signed `state`.
- `ORUN_PUBLIC_URL` callback construction is correct, including trailing-slash behavior.
- Signed state contains a random nonce and expiry, uses `ORUN_SESSION_SECRET`, and rejects invalid, malformed, and expired states.
- OAuth code exchange uses `Accept: application/json` and does not log or expose the access token.
- GitHub API requests use a clear `User-Agent`.
- User fetch validates enough response shape before issuing a session. Do not accept `undefined`/non-string login as a subject.
- Repo and org membership pagination is correct and resistant to malformed `Link` headers.
- Admin repo filtering is correct for direct repo admin permissions.
- Org-admin repo inclusion matches the permission model in `spec/08-account-repo-linking.md`.
- Namespace IDs are canonical GitHub repo IDs as strings and are deduplicated.
- Important risk to probe: `fetchAllPages()` should not silently turn non-OK GitHub repo/org API responses into partial permissions and still issue a session. If confirmed, treat as a blocker unless the behavior is explicitly justified as safe and tested.
- Tests cover token exchange failure, user fetch failure, pagination, org-admin repos, deduplication, missing code/state, invalid state, and expired state. Add a focused test or require a fix if repo/org list failures are silently ignored.

## Request Authentication

- `X-Orun-Deploy-Token` requires configured `ORUN_DEPLOY_TOKEN`, compares exactly, and returns deploy context only on match.
- Missing `Authorization: Bearer <token>` returns `UNAUTHORIZED`.
- OIDC/session selection is deliberate: unverified issuer sniffing may route a token to OIDC, but real verification must still happen.
- OIDC auth extracts namespace from `repository_id`/`repository` and returns `allowedNamespaceIds` containing only the canonical namespace ID.
- OIDC auth upserts namespace slug into D1. With `ctx.waitUntil`, it schedules the write; without `ctx`, it awaits the write for deterministic tests.
- Session auth verifies with `ORUN_SESSION_SECRET` and returns `namespace: null`.
- No authorization decisions beyond identity extraction are implemented. Namespace access enforcement belongs to Task 0006.

## Namespace Slug Upsert

- Uses D1 prepared statements and bound parameters only.
- Inserts or updates `namespaces(namespace_id, namespace_slug, last_seen_at)`.
- Uses ISO timestamps.
- Is idempotent and updates changed slugs.
- Does not introduce circular dependencies on `@orun/storage`.

## Env, Specs, and Package Hygiene

- `packages/types/src/index.ts` adds the required auth env fields without making deployment secrets required at type level.
- Type tests cover the new env fields.
- `apps/worker/wrangler.jsonc` still has the required non-secret vars and does not commit secret values.
- `spec/06-auth.md` changes are honest contract refinements, not retroactive cover for incomplete behavior.
- `apps/worker/src/index.ts` still exports `RunCoordinator` and has not mounted Worker API routes prematurely.
- No changes were made to coordinator, storage, migrations, account APIs, rate limiting, or remote-state client behavior.

## Tests

- Tests should prove behavior, not only calls.
- Mocked `fetch` should fail closed on unexpected URLs.
- No test calls the real GitHub JWKS or GitHub API.
- Fake D1 assertions are strong enough to prove SQL shape and bound params for namespace upsert.
- Avoid production `any` and broad type casts. Test-only `any` should be minimal and justified.

# Pass / Fail Rules
PASS only if:

- All Task 0005 acceptance criteria are met.
- Local typecheck, build, test, lint, focused Worker tests, and focused types tests pass.
- Local kiox/orun validation passes or any local changed-detection oddity is explained and CI logs cover the gap.
- PR CI logs prove `orun-api-worker` and `orun-types` validation actually ran.
- CI limitations, especially lack of unit test execution if still true, are documented and offset by local test runs.
- No live production deploy occurred.
- No secrets or tokens are logged or committed.
- OAuth and JWT edge cases are safe enough for Task 0006 to build on.
- Any verifier report/state update and any verification-only fix are committed to PR #12, CI reruns green, and logs are inspected again.

FAIL if:

- Any required auth flow is missing or materially wrong.
- JWT verification accepts unsigned, wrong-alg, wrong-audience, expired, malformed, or tampered tokens.
- OAuth can issue sessions from malformed GitHub user data or silently ignores GitHub repo/org API failures in a way that creates unsafe or misleading permissions.
- Tests call live GitHub endpoints or do not cover the required edge cases.
- Worker routing, run/job/log/account/rate-limit behavior was added out of scope.
- CI does not validate the changed Worker/types components and the gap is not otherwise fixed.
- Local quality gates fail.

# Verifier Report
Write:

```text
ai/reports/task-0005-verifier.md
```

Use this shape:

```markdown
# Task 0005 Verifier Report

Result: PASS|FAIL

## Checks
- ...

## Issues
- ...

## Risk Notes
- ...

## Recommended Next Move
- ...
```

If PASS, update `ai/state.json`:

- `current_task`: `6`
- `completed`: `[1, 2, 3, 4, 5]`
- `repo_health`: `green`
- `next_focus`: `task-0006-worker-api`
- `last_verified`: `2026-05-02`
- Add concise notes for Task 0005, PR #12, local checks, CI run ID, and any accepted risk such as CI not running unit tests.

If FAIL, keep `current_task` at `5`, set `repo_health` to a failing or blocked value, and note the blockers.

# Merge Protocol
If verification passes:

1. Commit the verifier report and state update to `task-0005-auth`.
2. Push the branch.
3. Wait for PR checks to complete.
4. Inspect the new CI logs, not only statuses.
5. Merge PR #12 only if local checks and CI logs are acceptable.
6. After merge, checkout `main` locally and fast-forward pull from `origin/main`.

If verification requires a small verification-only fix, commit it to the PR branch, push, wait for CI again, and inspect logs before merging.

Never merge PR #12 with unresolved verification blockers.
