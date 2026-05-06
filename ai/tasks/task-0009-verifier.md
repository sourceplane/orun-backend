# Task 0009 Verifier

# Agent

Verifier

# Current Repo Context

Task 0009 implementation is complete and open for verification.

Primary repo:

```text
/Users/irinelinson/sourceplane/orun-backend
```

Open PR to verify:

- Repo: `sourceplane/orun-backend`
- PR: #20
- URL: `https://github.com/sourceplane/orun-backend/pull/20`
- Title: `feat: task-0009 dashboard UI, browser OAuth, typed client`
- Branch: `task-0009-dashboard-ui`
- Base: `main`
- Head SHA: `60e6675531cd9293f46eee283c8637282fb38622`
- Merge state at verifier prompt creation: `CLEAN`
- GitHub Actions run: `https://github.com/sourceplane/orun-backend/actions/runs/25257936783`
- CI surface at verifier prompt creation: green
  - `Review Plan`: success
  - `Build & Deploy`: success

Important implementation report:

```text
/Users/irinelinson/sourceplane/orun-backend/ai/reports/task-0009-implementer.md
```

The implementer reports:

- browser OAuth `returnTo` flow added
- `@orun/client` placeholder replaced with a typed HTTP client
- `apps/dashboard` added as a static React/Vite/TypeScript app
- `cloudflare-pages-turbo` delivery wiring added for project `orun-dashboard`
- specs/docs updated
- local package checks passed
- PR CI is green

Critical reported gaps to verify carefully:

- Local `kiox -- orun run --changed` reportedly ended 5/6 because the dashboard production deploy required `CLOUDFLARE_ACCOUNT_ID`.
- `wrangler whoami` reportedly had no active auth token in the implementer shell.
- Live Cloudflare Pages deploy was not completed by the implementer.
- `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, and `ORUN_DASHBOARD_URL` were not configured live by the implementer.
- Full interactive visual QA was not performed.

Do not treat those gaps as harmless bookkeeping. The user previously escalated live Cloudflare deployment as high priority. Verification must determine whether PR #20 is production-ready, whether live deploy/config can be completed with available access, or whether this is a FAIL with concrete blockers.

Current local worktree caveat:

- The shared local worktree may contain unrelated uncommitted edits in:

```text
apps/worker/src/api.test.ts
apps/worker/src/rate-limit.ts
```

Those edits are not part of PR #20. Do not stage, revert, merge, or rely on them. For clean verification, prefer a fresh worktree or make sure local test results are produced from PR #20 content plus only deliberate verifier changes.

# Objective

Verify PR #20 against Task 0009 and decide PASS or FAIL.

Task 0009 is complete only if:

1. The OAuth browser return flow is secure and backward-compatible.
2. The typed `@orun/client` correctly covers dashboard calls and error behavior.
3. The dashboard is usable, responsive, and does not expose tokens.
4. Cloudflare Pages delivery wiring is valid for `stack-tectonic:0.12.0`.
5. Live deployment/configuration is either completed and smoke-tested or the remaining blocker is truly external and precisely documented.
6. PR CI and local checks are acceptable.
7. Verifier report and state bookkeeping are accurate.

If PASS:

- Merge PR #20.
- Sync local `main` with `origin/main`.
- Write `/Users/irinelinson/sourceplane/orun-backend/ai/reports/task-0009-verifier.md`.
- Update `/Users/irinelinson/sourceplane/orun-backend/ai/state.json`:
  - add `9` to `completed`
  - set `current_task` to `10`
  - set `next_focus` to `task-0010-cli-bootstrap`
  - set `repo_health` to `green`
  - set `last_verified` to the verification date
  - record concise notes for PR #20, dashboard URL, live deploy/OAuth status, and any accepted residual risk
- If the verifier report/state update is not already on PR #20, create a small bookkeeping PR, merge it, and bring local `main` to latest.

If FAIL:

- Do not merge PR #20.
- Write `/Users/irinelinson/sourceplane/orun-backend/ai/reports/task-0009-verifier.md` with concrete blockers.
- Leave clear PR feedback on PR #20.
- Keep `ai/state.json` at Task 9 or mark repo health blocked only in a bookkeeping PR if you are explicitly doing verifier bookkeeping.
- Recommend Task 0009.1 remediation scope.

# Read First

Read these files before verification:

1. `/Users/irinelinson/sourceplane/orun-backend/ai/tasks/task-0009.md`
2. `/Users/irinelinson/sourceplane/orun-backend/ai/proposals/task-0009-spec-update.md`
3. `/Users/irinelinson/sourceplane/orun-backend/ai/reports/task-0009-implementer.md`
4. `/Users/irinelinson/sourceplane/orun-backend/ai/state.json`
5. `/Users/irinelinson/sourceplane/orun-backend/SCHEDULE.md`
6. `/Users/irinelinson/sourceplane/orun-backend/spec/04-worker-api.md`
7. `/Users/irinelinson/sourceplane/orun-backend/spec/06-auth.md`
8. `/Users/irinelinson/sourceplane/orun-backend/spec/08-account-repo-linking.md`
9. `/Users/irinelinson/sourceplane/orun-backend/spec/11-dashboard-ui.md`
10. `/Users/irinelinson/sourceplane/orun-backend/apps/worker/src/auth/github-oauth.ts`
11. `/Users/irinelinson/sourceplane/orun-backend/apps/worker/src/auth/github-oauth.test.ts`
12. `/Users/irinelinson/sourceplane/orun-backend/apps/worker/src/handlers/auth.ts`
13. `/Users/irinelinson/sourceplane/orun-backend/apps/worker/src/router.ts`
14. `/Users/irinelinson/sourceplane/orun-backend/apps/worker/wrangler.jsonc`
15. `/Users/irinelinson/sourceplane/orun-backend/packages/types/src/index.ts`
16. `/Users/irinelinson/sourceplane/orun-backend/packages/client/src/index.ts`
17. `/Users/irinelinson/sourceplane/orun-backend/packages/client/src/index.test.ts`
18. `/Users/irinelinson/sourceplane/orun-backend/apps/dashboard/package.json`
19. `/Users/irinelinson/sourceplane/orun-backend/apps/dashboard/component.yaml`
20. `/Users/irinelinson/sourceplane/orun-backend/apps/dashboard/wrangler.jsonc`
21. `/Users/irinelinson/sourceplane/orun-backend/apps/dashboard/.env.example`
22. `/Users/irinelinson/sourceplane/orun-backend/apps/dashboard/src/App.tsx`
23. `/Users/irinelinson/sourceplane/orun-backend/apps/dashboard/src/auth.ts`
24. `/Users/irinelinson/sourceplane/orun-backend/apps/dashboard/src/api.ts`
25. `/Users/irinelinson/sourceplane/orun-backend/apps/dashboard/src/styles.css`
26. `/Users/irinelinson/sourceplane/orun-backend/apps/dashboard/README.md`
27. `/Users/irinelinson/sourceplane/orun-backend/intent.yaml`
28. `/Users/irinelinson/sourceplane/orun-backend/kiox.yaml`
29. `/Users/irinelinson/sourceplane/orun-backend/.github/workflows/workflow.yml`

# PR and CI Inspection

Inspect PR metadata:

```bash
gh pr view 20 --repo sourceplane/orun-backend --json number,title,url,state,isDraft,headRefName,baseRefName,mergeStateStatus,reviewDecision,statusCheckRollup,commits,files
gh pr diff 20 --repo sourceplane/orun-backend --name-only
gh pr diff 20 --repo sourceplane/orun-backend --stat
```

Inspect successful CI logs, not only summaries:

```bash
gh run view 25257936783 --repo sourceplane/orun-backend --log
```

Verify:

- `Review Plan` actually ran the expected `kiox -- orun plan --changed` path.
- `Build & Deploy` actually ran the expected `kiox -- orun run --changed` path.
- The production-all-components deploy step was skipped only because this was a PR, not because delivery is broken.
- No logs leak tokens or secrets.
- No generated `dist/`, `.wrangler/`, `.turbo/`, coverage, or local `.orun/` output is committed.
- The unrelated local rate-limit edits are not included in PR #20.

# Required Verification Work

## 1. Branch and Worktree Hygiene

Prefer verifying from a clean checkout/worktree:

```bash
cd /Users/irinelinson/sourceplane/orun-backend
git fetch origin main task-0009-dashboard-ui
git status --short --branch
```

If local unrelated dirty files are present, do not include them in verification results. Use a separate clean worktree if needed:

```bash
git worktree add /tmp/orun-backend-task-0009-verify origin/task-0009-dashboard-ui
cd /tmp/orun-backend-task-0009-verify
```

Do not use destructive commands such as `git reset --hard` in the shared worktree.

## 2. OAuth Return Flow Security

Review implementation and tests for:

- `GET /v1/auth/github` without `returnTo` still works.
- Callback without `returnTo` still returns the existing JSON payload.
- `returnTo` is bound inside signed state and cannot be altered.
- State expiration and tamper rejection still work.
- `returnTo` validation rejects malformed URLs and open redirects.
- `ORUN_DASHBOARD_URL` origin validation is implemented as specified.
- Local/dev fallback is not permissive enough to become an open redirect.
- Session token is placed only in the fragment, not query string.
- GitHub OAuth access token is never returned, persisted, logged, or included in the session JWT.
- Error responses use the existing typed JSON error envelope.
- Existing OAuth users/sessions are not broken beyond short-lived in-flight OAuth states.

Run or inspect tests proving:

- JSON compatibility with no `returnTo`
- valid dashboard redirect with fragment
- disallowed `returnTo`
- tampered state
- access token exclusion from redirect URL/body

## 3. `@orun/client` Verification

Review `packages/client` for:

- base URL normalization
- token string and token provider support
- no token logging
- correct `Authorization: Bearer` behavior only when a token exists
- correct URL encoding for path params and query params
- JSON response parsing
- text log response parsing
- typed `OrunClientError` for backend `ApiError` envelopes
- useful non-JSON error behavior
- missing token behavior for anonymous auth URL construction
- method coverage required by Task 0009

Tests should use injected fake `fetch` and cover meaningful request/response behavior, not only construction.

## 4. Dashboard UX and Token Handling

Review `apps/dashboard` for:

- login link uses `VITE_ORUN_API_BASE_URL` and sends a dashboard callback URL in `returnTo`
- callback parser validates `sessionToken`
- session token goes to `sessionStorage`
- token fragments are stripped from browser history
- raw tokens are never rendered
- sign-out clears session
- account missing state is handled through account creation
- linked repos, runs, run detail, jobs, and logs have loading/empty/error states
- filters/search do not crash on partial run data
- run/job/log fetch errors do not collapse the whole dashboard
- dashboard tolerates `Partial<Run>` and `Partial<Job>`
- no repo-link creation UI asks users to paste a GitHub token
- no browser code exposes or expects GitHub OAuth access tokens
- layout is responsive and text does not visibly overflow at desktop/tablet/mobile widths

Run local visual QA:

```bash
pnpm --filter @orun/dashboard dev -- --host 127.0.0.1
```

Inspect at least:

- 1440px desktop
- 768px tablet
- 390px mobile

Use a mocked or session-seeded state if needed. Do not require live OAuth for visual QA, but do verify the callback route/fragment handling with a local fragment URL.

## 5. Cloudflare Pages and Live Configuration

Review delivery wiring:

- `apps/dashboard/component.yaml` uses `spec.type: cloudflare-pages-turbo`.
- `projectName` is `orun-dashboard` unless the implementer documented a deterministic alternative.
- `outputDir` is `dist`.
- `nodeVersion` is `"20"`.
- `pnpmVersion` is `"10.12.1"`.
- `productionBranch` is `main`.
- `smokeCommand` checks the correct Pages URL.
- `apps/dashboard/wrangler.jsonc` matches the Pages project and `pages_build_output_dir`.
- `intent.yaml` remains pinned to `oci://ghcr.io/sourceplane/stack-tectonic:0.12.0`.

Attempt to verify Cloudflare access and live state:

```bash
pnpm --filter @orun/dashboard exec wrangler whoami
pnpm --filter @orun/dashboard build
pnpm --filter @orun/dashboard exec wrangler pages project list
```

If authenticated and safe to do so, complete or verify the live Pages deployment:

```bash
pnpm --filter @orun/dashboard exec wrangler pages deploy dist --project-name orun-dashboard --branch main
curl -fsSL https://orun-dashboard.pages.dev | head
```

Check Worker configuration without leaking secrets:

```bash
pnpm --filter @orun/worker exec wrangler secret list --name orun-api
```

Verify whether these exist live:

- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `ORUN_SESSION_SECRET`

Verify how `ORUN_DASHBOARD_URL=https://orun-dashboard.pages.dev` is configured. If it is a plain variable, it should be in committed Worker config or set by deployment. If it is a secret, it should appear in secret listing without value disclosure.

If GitHub OAuth app credentials are unavailable and cannot be created non-interactively, record that clearly. Do not mark live login as verified unless you actually verify it.

PASS requires one of these:

- live dashboard is deployed, `ORUN_DASHBOARD_URL` is configured, OAuth secrets exist, and at least the login redirect path is smoke-tested; or
- you determine the remaining OAuth app credential step is genuinely external, documented precisely, and not required to merge this code slice. If choosing this second path, record the residual risk prominently in the verifier report.

FAIL if Pages deployment is impossible due to code/config problems, if the smoke URL does not serve the dashboard, if OAuth redirect validation is misconfigured, or if missing secrets make the claimed feature misleading without an accepted external blocker.

## 6. Specs, Docs, and Proposal Discipline

Verify docs/specs match implementation:

- `spec/06-auth.md` documents `returnTo` accurately.
- `spec/11-dashboard-ui.md` describes only the implemented first slice.
- `README.md` spec/package tables are updated.
- `SCHEDULE.md` reflects the accepted first dashboard slice and deferred repo-link creation.
- `apps/dashboard/README.md` includes local dev, env vars, Cloudflare Pages deployment, GitHub OAuth callback URL, and Worker secret/origin setup.

If implementation deviates from specs in a way that changes behavior, security, API contracts, persistence, or roadmap scope, require or create a proposal under `/ai/proposals/` before PASS.

# Required Local Checks

Run from a clean PR #20 worktree:

```bash
pnpm install
pnpm --filter @orun/client test
pnpm --filter @orun/client typecheck
pnpm --filter @orun/client build
pnpm --filter @orun/worker test
pnpm --filter @orun/worker typecheck
pnpm --filter @orun/worker build
pnpm --filter @orun/dashboard test
pnpm --filter @orun/dashboard typecheck
pnpm --filter @orun/dashboard build
pnpm exec turbo run test typecheck build
pnpm exec turbo run lint
git diff --check
```

Run kiox/orun validation:

```bash
/Users/irinelinson/.local/bin/kiox -- orun plan --changed
/Users/irinelinson/.local/bin/kiox -- orun run --changed
```

If `/Users/irinelinson/.local/bin/kiox` is unavailable but `kiox` is on `PATH`, use `kiox`.

If `kiox -- orun run --changed` fails only because local Cloudflare account env is missing, verify PR CI logs and available Cloudflare auth carefully. Do not waive this automatically; explain why it is or is not acceptable.

# Acceptance Criteria

PR #20 can PASS only when:

1. All Task 0009 acceptance criteria are validated or a narrow accepted external blocker is documented.
2. OAuth `returnTo` is secure and backward-compatible.
3. `@orun/client` is typed, tested, and does not leak tokens.
4. Dashboard UI is usable, responsive, and handles empty/error/partial states.
5. Dashboard does not expose GitHub OAuth access tokens or ask users to paste GitHub tokens.
6. Cloudflare Pages delivery wiring is valid and changed-component plan/run behavior is acceptable.
7. Live Pages/OAuth configuration status is verified, not guessed.
8. Local checks pass from clean PR content.
9. GitHub Actions logs are inspected and acceptable.
10. Specs/docs match code or required proposals exist.
11. No unrelated local rate-limit edits are included.
12. Verifier report is written.

# When Done Report

Write:

```text
/Users/irinelinson/sourceplane/orun-backend/ai/reports/task-0009-verifier.md
```

Use this structure:

```md
# Task 0009 Verifier Report

## Result

PASS or FAIL

## PR

## Checks

## CI Log Review

## OAuth Review

## Client SDK Review

## Dashboard UX Review

## Cloudflare Pages / Live Config Review

## Docs and Spec Review

## Issues

## Risk Notes

## Spec Proposals

## Merge / Sync Actions

## Recommended Next Move
```

If PASS, include:

- PR #20 merge method and merge commit
- local `main` sync evidence
- live dashboard URL and what was actually smoke-tested
- whether OAuth secrets and `ORUN_DASHBOARD_URL` exist
- any accepted residual risk

If FAIL, include:

- numbered blockers
- exact files/lines or PR diff areas where possible
- commands/checks that failed
- whether the failure is code, delivery, live config, docs, or external access
- recommended Task 0009.1 scope
