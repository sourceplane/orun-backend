# Task 0006 Verification

# Agent
Verifier

# Current Repo Context
Task 0006 implemented the core Worker API gateway in `apps/worker`.

GitHub PR to verify:

- PR: #13
- URL: `https://github.com/sourceplane/orun-backend/pull/13`
- Title: `feat: implement Worker API gateway`
- Branch: `codex/task-0006-worker-api`
- Base: `main`
- State at prompt creation: open, ready for review
- Mergeability at prompt creation: `MERGEABLE`
- Head SHA at prompt creation: `19d54e85d7477de74c856c5fb09bd8d267e5fae1`
- Surface CI at prompt creation: green
- Workflow run to inspect: `25244619107`

Changed files in PR #13 at prompt creation:

- `ai/reports/task-0006-implementer.md`
- `apps/worker/src/api.test.ts`
- `apps/worker/src/auth/github-oauth.test.ts`
- `apps/worker/src/auth/index.test.ts`
- `apps/worker/src/auth/oidc.test.ts`
- `apps/worker/src/coordinator.ts`
- `apps/worker/src/handlers/auth.ts`
- `apps/worker/src/handlers/jobs.ts`
- `apps/worker/src/handlers/logs.ts`
- `apps/worker/src/handlers/runs.ts`
- `apps/worker/src/http.ts`
- `apps/worker/src/index.ts`
- `apps/worker/src/rate-limit.ts`
- `apps/worker/src/router.ts`
- `apps/worker/src/scheduled.ts`
- `apps/worker/wrangler.jsonc`
- `packages/types/src/index.test.ts`
- `packages/types/src/index.ts`

Important local state:

- The current checkout may already be on `codex/task-0006-worker-api`.
- The Task 0006 prompt file `ai/tasks/task-0006.md` exists locally but is not in PR #13 at prompt creation. If verification passes, include it in the PR so task history is complete.
- This verifier prompt file, `ai/tasks/task-0006-verifier.md`, may also be untracked at handoff. Include it only if you are intentionally keeping verifier prompt history.
- Older unrelated untracked files may exist: `ai/tasks/task-0002-verifier.md`, `ai/tasks/task-0003-verifier.md`, and `ai/tasks/task-0004-verifier.md`. Do not include those unless you intentionally decide to backfill prior task history.
- Do not destructively reset local branches.

Orchestrator local baseline at prompt creation:

- `pnpm exec turbo run typecheck` passed for 5 packages.
- `pnpm exec turbo run build` passed for 5 packages; Worker dry-run bundle succeeded and showed `COORDINATOR` and `RATE_LIMITER` Durable Object bindings.
- `pnpm --filter @orun/worker test` passed: 7 test files, 86 tests.
- `pnpm exec turbo run test` passed: types 16, coordinator 35, storage 42, worker 86.
- `pnpm exec turbo run lint` passed, but lint scripts are still `lint deferred`.
- `/Users/irinelinson/.local/bin/kiox -- orun plan --changed` reported `2 components x 3 envs -> 6 jobs`: `orun-api-worker`, `orun-types`, plan `e650fe499483`.
- `/Users/irinelinson/.local/bin/kiox -- orun run --changed` passed: 6 jobs succeeded, exec id `orun-backend-20260502-b55afd`.
- CI logs for run `25244619107` show `kiox -- orun plan --changed` and `kiox -- orun run --changed`; changed components were `orun-api-worker` and `orun-types`. CI built/typechecked/dry-ran the Worker, but did not appear to run Vitest unit tests. Verify this yourself and document it.

# Objective
Verify Task 0006 end to end against the task prompt, specs, implementation report, PR diff, local quality gates, local kiox/orun behavior, and PR CI logs.

If PASS, write the verifier report, update state for Task 0007, push the report/state and any approved verification-only fixes to PR #13, wait for CI, inspect logs, merge the PR, and sync local `main` safely.

If FAIL, do not merge. Write a verifier report with concrete blockers and leave clear PR feedback.

# Read First
Read these before running checks:

1. `ai/tasks/task-0006.md`
2. `ai/reports/task-0006-implementer.md`
3. `ai/reports/task-0003-verifier.md`
4. `ai/reports/task-0004-verifier.md`
5. `ai/reports/task-0005-verifier.md`
6. `agents/orchestrator.md`
7. `SCHEDULE.md`
8. `spec/00-constitution.md`
9. `spec/03-types-package.md`
10. `spec/04-worker-api.md`
11. `spec/05-coordinator-do.md`
12. `spec/06-auth.md`
13. `spec/07-storage.md`
14. `spec/08-account-repo-linking.md` account/rate-limit notes
15. `spec/09-cli-integration.md` backend API support section
16. `spec/10-rate-limiting.md`
17. `apps/worker/src/index.ts`
18. `apps/worker/src/router.ts`
19. `apps/worker/src/http.ts`
20. `apps/worker/src/coordinator.ts`
21. `apps/worker/src/rate-limit.ts`
22. `apps/worker/src/handlers/auth.ts`
23. `apps/worker/src/handlers/runs.ts`
24. `apps/worker/src/handlers/jobs.ts`
25. `apps/worker/src/handlers/logs.ts`
26. `apps/worker/src/scheduled.ts`
27. `apps/worker/src/api.test.ts`
28. `apps/worker/wrangler.jsonc`
29. `packages/types/src/index.ts`
30. `packages/types/src/index.test.ts`
31. `packages/coordinator/src/coordinator.ts`
32. `packages/storage/src/d1.ts`
33. `packages/storage/src/r2.ts`

Inspect PR #13 metadata and diff:

```bash
gh pr view 13 --repo sourceplane/orun-backend --json number,title,url,state,isDraft,headRefName,baseRefName,mergeable,body,commits,files,reviews,statusCheckRollup,headRefOid
gh pr diff 13 --repo sourceplane/orun-backend --name-only
gh pr diff 13 --repo sourceplane/orun-backend --patch --color=never
```

# Required Verification Work
Verify every Task 0006 acceptance criterion:

1. `apps/worker/src/index.ts` exposes a real Worker API with `fetch` and `scheduled` handlers.
2. `RunCoordinator` export is preserved.
3. `RateLimitCounter` is exported and configured in `wrangler.jsonc`.
4. `/v1/auth/github` and `/v1/auth/github/callback` are wired.
5. All in-scope run/job/log endpoints route correctly.
6. Protected routes use `authenticate(request, env, ctx)` and do not reimplement auth.
7. Namespace access is enforced for OIDC and session contexts.
8. Deploy-token context is rejected from general run/job/log endpoints.
9. `POST /v1/runs` supports optional deterministic `runId` and idempotent create/join.
10. `POST /v1/runs` initializes the Coordinator DO and writes non-authoritative D1/R2 mirrors.
11. Job claim/update/heartbeat/runnable endpoints forward to the Coordinator DO with correct bodies.
12. Update forwarding preserves `runnerId`.
13. D1 mirrors are updated after successful job updates and log uploads without corrupting existing indexed fields.
14. Log upload and retrieval use `R2Storage`.
15. Rate limiting can produce HTTP 429 in tests and includes expected headers.
16. Scheduled GC handles expired runs without deleting unrelated namespaces/accounts/account_repos.
17. `CreateRunRequest.runId?: string` is added to `@orun/types` and covered by type tests.
18. Tests cover happy paths, auth failures, cross-namespace denial, rate limit, coordinator unclaimed response, log upload/retrieval, and scheduled GC.
19. No account/repo-linking endpoints are implemented.
20. No Go CLI code is modified.
21. Local checks pass.
22. Local kiox/orun validation passes or any changed-detection oddity is explained.
23. PR CI logs prove meaningful validation ran.

# Local Commands To Run
Start from the PR branch:

```bash
git fetch origin main codex/task-0006-worker-api
git switch codex/task-0006-worker-api
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
pnpm --filter @orun/storage test
pnpm --filter @orun/coordinator test
cd apps/worker && pnpm exec wrangler deploy --dry-run --outdir=dist && cd ../..
```

Run focused inspection checks:

```bash
rg -n "\\bBuffer\\b|from ['\\\"]node|require\\(|process\\.|console\\.|jwt|access_token|sessionToken|Authorization" apps/worker/src --glob '!*.test.ts'
rg -n "\\bany\\b|@ts-ignore|as any" apps/worker/src packages/types/src
rg -n "component: \"\"|status: \"running\"|logRef: null|waitUntil|alreadyExists|different plan|namespace_slug|RATE_LIMITER|RateLimitCounter" apps/worker/src apps/worker/wrangler.jsonc
rg -n "accounts|account_repos|tier|billing|repos" apps/worker/src
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
gh pr checks 13 --repo sourceplane/orun-backend --watch
gh run view 25244619107 --repo sourceplane/orun-backend --json databaseId,status,conclusion,headBranch,headSha,jobs
gh run view 25244619107 --repo sourceplane/orun-backend --log
```

Confirm in logs:

- `sourceplane/kiox-action@v2.1.2` initialized the workspace.
- The PR run used PR head SHA `19d54e85d7477de74c856c5fb09bd8d267e5fae1`, or a newer pushed verifier SHA if you add commits. If logs mention a pull-request merge commit, map it back to the PR head before accepting it.
- `kiox -- orun plan --changed` ran in the Review Plan job.
- `kiox -- orun run --changed` ran in the Build & Deploy job.
- The changed component set includes `orun-api-worker` and `orun-types`.
- Worker dry-run build and typecheck ran for `@orun/worker`.
- Type package build and typecheck ran for `@orun/types`.
- Wrangler dry-run output includes both `COORDINATOR: RunCoordinator` and `RATE_LIMITER: RateLimitCounter`.
- Determine whether Worker unit tests ran in CI. At prompt creation, they did not appear to run; if still true, note the CI limitation clearly and rely on local test output.
- No live Cloudflare production deploy occurred unexpectedly. Pull request logs should show production deploy skipped and dev deploy dry-run only.
- No warning invalidates the result. The current Node.js 20 action deprecation and Wrangler version warnings are known but should still be recorded.

# Code Review Focus
Review the actual implementation, not just tests.

## Routing and HTTP

- `GET /` remains unauthenticated and returns a simple health response.
- `OPTIONS /*` returns CORS headers without requiring auth.
- All `/v1` success/error responses include CORS headers, except redirects where standard redirect behavior is acceptable.
- Errors use `{ error, code }` and never expose stack traces.
- Unknown routes return 404 JSON.
- Wrong method on a known route returns deterministic 405 or `INVALID_REQUEST`.
- Route matching is exact enough that `/v1/runs/:runId/jobs` does not catch `/status`, `/runnable`, or `/logs`.
- Path params are decoded safely, and internal coordinator requests re-encode `jobId`.
- Auth-free routes do not accidentally receive deploy context in a way that affects rate limiting or authorization.

## Authentication and Namespace Access

- Protected routes call `authenticate(request, env, ctx)`.
- OIDC-only routes reject session and deploy contexts.
- Session-only routes reject OIDC and deploy contexts.
- OIDC/session routes reject deploy context.
- OIDC access is scoped to `authCtx.namespace.namespaceId`.
- Session access is scoped to `authCtx.allowedNamespaceIds`.
- For session routes that only have `runId`, D1 lookup does not leak whether a run exists in a disallowed namespace.
- Cross-namespace OIDC and session denial are tested meaningfully. Watch for tests that expect 404 by querying a different DO rather than proving explicit namespace enforcement.
- Session-created runs, if supported, require `namespaceId` and reject unknown namespaces rather than inventing slugs.

## Rate Limiting

- `RATE_LIMITER` is added to `Env`, `wrangler.jsonc`, and tests.
- `RateLimitCounter` is exported from `apps/worker/src/index.ts`.
- The rate limit is per canonical namespace ID for OIDC execution endpoints.
- Session rate limiting has a deliberate keying choice. Current code appears to use `allowedNamespaceIds[0]` or actor; decide whether this is acceptable for list/read routes and document the tradeoff.
- 429 responses include `Retry-After`, `X-RateLimit-Limit`, and `X-RateLimit-Remaining`.
- The advertised limits are internally consistent: spec says free tier 5 req/s, burst 20. The implementation may return the burst value as `X-RateLimit-Limit`; decide whether that header should instead represent the per-window limit.
- The DO token bucket behaves correctly over time and cannot go negative.
- Verify whether the `wrangler.jsonc` Durable Object configuration is production-deployable for a new DO class. Wrangler dry-run passes, but Cloudflare Durable Object deployments often require migrations/new class declarations; treat missing production deploy configuration as at least a risk note, and as a blocker if this repo convention requires it.

## Runs API

### `POST /v1/runs`

- Validates JSON and plan shape strongly enough before forwarding and before D1/R2 mirror writes.
- Supports deterministic `runId`; rejects empty or non-string values.
- Uses OIDC namespace for OIDC creates and rejects mismatched body `namespaceId`.
- Session creates require a body `namespaceId`, enforce `allowedNamespaceIds`, and require an existing namespace slug.
- Calls Coordinator `/init` with `plan`, `runId`, `namespaceId`, and `namespaceSlug`.
- Repeated create/join with same namespace/run/plan returns 200 and does not conflict.
- Same namespace/run with different plan checksum returns 409.
- Important risk to probe: if `/init` returns `alreadyExists` but coordinator `/state` fails, does the Worker skip plan checksum verification and incorrectly return 200?
- Important risk to probe: idempotent join should return existing run metadata. Current code appears to return `status: "running"` and a new `createdAt` even if the existing coordinator state has different status/timestamps. Decide whether this violates Task 0006/Task 0008 requirements.
- D1 `Run` row has valid `triggerType`, `actor`, `dryRun`, `jobTotal`, `expiresAt`, and counters. Probe whether unvalidated `triggerType`, non-string `actor`, or `Boolean(body.dryRun)` coercion can persist invalid metadata.
- D1 initial job rows are written for all plan jobs and keep namespace isolation.
- Plan snapshot is saved to R2 under the namespace plan path.
- D1/R2 mirror failures are handled intentionally. If mirror writes use `ctx.waitUntil`, tests should flush and catch failures where important.

### `GET /v1/runs`

- Session auth only.
- Uses bounded `limit` and `offset`.
- Lists only runs from `allowedNamespaceIds`.
- Handles empty `allowedNamespaceIds` safely.

### `GET /v1/runs/:runId`

- OIDC path prefers Coordinator `/state` and falls back to D1.
- Session path should, once D1 identifies the namespace, prefer Coordinator `/state` for freshness if feasible. Current code appears to return only D1 for session reads; decide whether this is acceptable or a blocker for dashboard/status freshness.
- Response shape is consistent and sufficient. Current coordinator-backed run mapping appears to return a `Partial<Run>` missing fields such as `triggerType`, `actor`, `finishedAt`, `dryRun`, and `expiresAt`; decide whether this violates the API contract.
- `namespaceSlug` is not silently blank in responses when D1 has a real slug available, unless documented.

## Jobs API

- Claim forwards `{ runnerId }` to `/jobs/:jobId/claim`.
- Claim returns coordinator JSON and preserves HTTP 200 for `{ claimed: false }`.
- Claim preserves extended `depsWaiting` / `depsBlocked` flags.
- Update validates and forwards the full `CoordinatorUpdateJobRequest`, including `runnerId`.
- Update mirrors run counters and job status into D1 after successful coordinator response.
- Important risk to probe: update mirror currently appears to upsert only the updated job with `logRef: null`, which can erase a previously uploaded log reference. Treat confirmed logRef loss as a blocker unless fixed.
- Heartbeat validates and forwards `{ runnerId }`.
- Runnable forwards Coordinator `/runnable`.
- OIDC job list/status prefer Coordinator state.
- Session job list/status should avoid stale D1 when Coordinator state is available. Current code appears to use only D1 after finding the run; decide whether this is acceptable.
- Public job responses are complete enough for Task 0008 `orun status --remote-state`. Coordinator-backed job mapping appears to omit `runId` and may set `logRef: null`; decide whether this violates the shared `Job` contract or remote-state needs.

## Logs API

- Log upload is OIDC-only.
- Log upload uses `R2Storage.writeLog(namespaceId, runId, jobId, request.body ?? "", { expiresAt })`.
- Log upload uses D1 run expiry when available and otherwise a safe default.
- Log upload should not corrupt existing indexed job fields.
- Important risk to probe: current code appears to upsert the D1 job row with `component: ""`, `status: "running"`, `runnerId: null`, and null timestamps. This can overwrite a completed/failed job and erase real component/runner/timestamps. Add or run a focused test. Treat confirmed D1 mirror corruption as a blocker.
- Log upload should either verify the run/job exists or clearly document accepting logs for unknown jobs in the authenticated namespace. Decide whether accepting arbitrary job IDs is acceptable for Task 0008.
- Log retrieval enforces namespace access for OIDC/session.
- Log retrieval returns 404 JSON when missing.
- Log retrieval streams `text/plain; charset=utf-8` with CORS headers.

## Scheduled GC

- Scheduled handler selects expired `(namespace_id, run_id)` pairs before deleting D1 rows.
- It best-effort cancels each Coordinator DO using `/cancel`.
- It deletes R2 run objects through `R2Storage.deleteRun(namespaceId, runId)`.
- It calls `D1Index.deleteExpiredRuns(now)` and does not delete namespaces/accounts/account_repos.
- Important risk to probe: cleanup promises are placed in `ctx.waitUntil` while D1 rows are deleted immediately. If R2/DO cleanup fails after D1 deletion, there may be no indexed retry source. Decide whether this is acceptable best-effort GC or should await cleanup before deleting rows.
- Tests should prove both coordinator cancel and R2 delete are attempted, not only one of them.

## Types and Wrangler Config

- `CreateRunRequest.runId?: string` is added and tested.
- `Env.RATE_LIMITER` is added and all test Env mocks are updated.
- `wrangler.jsonc` remains valid JSONC and dry-run compatible.
- Cron trigger is present if intended.
- No secrets are committed.
- No account/repo-linking endpoints, account migrations, billing tier columns, or Go CLI code are added.

## Tests

- Worker tests are meaningful and not only happy-path mocks.
- The implementer report says "86 tests in worker" and "86 new tests"; verify exact counts. At prompt creation, `api.test.ts` had 31 tests and the worker package had 86 total including prior auth tests.
- Fakes are strong enough to catch path, namespace, D1, R2, and coordinator body mistakes.
- Mocked auth is acceptable for router tests only because Task 0005 auth has its own tests; still ensure integration boundaries are tested.
- Add focused tests or require fixes for:
  - log upload preserving existing D1 job fields/logRef,
  - update preserving existing `logRef`,
  - session GET run/jobs/status freshness or documented D1-only behavior,
  - idempotent join returning existing metadata or documented status,
  - plan checksum verification when `/state` fails after `alreadyExists`,
  - scheduled GC attempting R2 delete.

# Pass / Fail Rules
PASS only if:

- All Task 0006 acceptance criteria are met.
- Local typecheck, build, test, lint, focused Worker tests, and focused package tests pass.
- Local kiox/orun validation passes or any changed-detection oddity is explained and CI covers the gap.
- PR CI logs prove `orun-api-worker` and `orun-types` validation actually ran.
- CI limitations, especially lack of unit test execution if still true, are documented and offset by local test runs.
- No live production deploy occurred.
- No secrets or tokens are logged or committed.
- D1 mirrors do not corrupt existing job status, component, runner, timestamps, or logRef.
- Worker exposes enough fresh run/job/log data for Task 0008 remote-state status/logs.
- Any verifier report/state update, missing task prompt, and any verification-only fix are committed to PR #13, CI reruns green, and logs are inspected again.

FAIL if:

- Any in-scope endpoint is missing or materially wrong.
- Auth/namespace enforcement allows cross-namespace access or deploy-token access to general endpoints.
- `POST /v1/runs` does not support deterministic idempotent create/join safely.
- Same run ID with different plan checksum can be accepted.
- Update drops `runnerId` or corrupts D1 mirrors.
- Log upload can overwrite a real job's component/status/runner/timestamps/logRef with placeholder data.
- Read endpoints are too stale or incomplete for remote-state status/logs and no acceptable rationale exists.
- Scheduled GC can delete D1 retry source before attempting required cleanup in a way you judge unsafe.
- Local quality gates fail.
- CI does not validate the changed Worker/types components and the gap is not otherwise fixed.

# Verifier Report
Write:

```text
ai/reports/task-0006-verifier.md
```

Use this shape:

```markdown
# Task 0006 Verifier Report

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

- `current_task`: `7`
- `completed`: `[1, 2, 3, 4, 5, 6]`
- `repo_health`: `green`
- `next_focus`: `task-0007-account-repo-linking`
- `last_verified`: `2026-05-02`
- Add concise notes for Task 0006, PR #13, local checks, CI run ID, and accepted risks such as Worker unit tests being local-only.

If FAIL, keep `current_task` at `6`, set `repo_health` to a failing or blocked value, and note the blockers.

# Merge Protocol
If verification passes:

1. Commit the verifier report, state update, and missing `ai/tasks/task-0006.md` prompt file to `codex/task-0006-worker-api`.
2. Include this verifier prompt only if you are intentionally maintaining verifier prompt history.
3. Do not include unrelated old untracked verifier prompts unless deliberately backfilling.
4. Push the branch.
5. Wait for PR checks to complete.
6. Inspect the new CI logs, not only statuses.
7. Merge PR #13 only if local checks and CI logs are acceptable.
8. After merge, checkout `main` locally and fast-forward pull from `origin/main`.

If verification requires a small verification-only fix, commit it to the PR branch, push, wait for CI again, and inspect logs before merging.

Never merge PR #13 with unresolved verification blockers.
