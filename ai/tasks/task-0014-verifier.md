# Task 0014 Verifier

# Agent

Verifier

# Current Repo Context

Task 0014 implements the catalog-first dashboard UI in `apps/dashboard` after Task 0013 and Task 0013.1 delivered and verified the catalog backend/client foundation.

Primary PR to verify:

- Repo: `sourceplane/orun-backend`
- PR: #33
- URL: `https://github.com/sourceplane/orun-backend/pull/33`
- Title: `feat: task-0014 catalog-first dashboard UI`
- Branch: `codex/task-0014-dashboard-catalog-ui`
- Base: `main`
- Head at verifier prompt creation: `42bf3d4ebfd6613600a73b850db3f94902e8946c`
- State at verifier prompt creation: open, not draft
- Merge state at verifier prompt creation: `CLEAN`
- Current CI run at verifier prompt creation:
  - Run: `25512977088`
  - URL: `https://github.com/sourceplane/orun-backend/actions/runs/25512977088`
  - Event: `pull_request`
  - Head SHA: `42bf3d4ebfd6613600a73b850db3f94902e8946c`
  - Conclusion: success
  - Jobs:
    - `Orun Plan`
    - `orun-dashboard · dev · Verify deploy cloudflare pages turbo`
    - `orun-dashboard · staging · Verify deploy cloudflare pages turbo`
    - `orun-dashboard · production · Verify deploy cloudflare pages turbo`

Implementation commits:

1. `32e772b4c5e05ade76e4ac970ce726852bbf7e96` — catalog-first dashboard UI.
2. `db132ad04af8f911e4f31e5f8788c2e1414400e3` — implementer report and task file.
3. `42bf3d4ebfd6613600a73b850db3f94902e8946c` — PR number added to report.

Implementation report:

```text
/Users/irinelinson/sourceplane/orun-backend/ai/reports/task-0014-implementer.md
```

At verifier prompt creation, the local working tree is on the PR branch and has an unstaged `ai/state.json` note from orchestrator bookkeeping. Do not discard it. If you add verifier bookkeeping, work with the existing state change rather than reverting it.

# Objective

Verify that PR #33 turns the dashboard into a catalog-first product surface while preserving the existing run/job/log workflow, keeping auth/session security intact, and meeting the frontend quality bar on desktop and mobile.

This is a frontend-heavy verifier. Do not pass on CI status alone. Inspect the code, run checks, inspect CI logs, and perform browser/visual QA.

# Read First

1. `/Users/irinelinson/sourceplane/orun-backend/agents/orchestrator.md`
2. `/Users/irinelinson/sourceplane/orun-backend/ai/tasks/task-0014.md`
3. `/Users/irinelinson/sourceplane/orun-backend/ai/reports/task-0014-implementer.md`
4. `/Users/irinelinson/sourceplane/orun-backend/ai/reports/task-0013.1-verifier.md`
5. `/Users/irinelinson/sourceplane/orun-backend/spec/11-dashboard-ui.md`
6. `/Users/irinelinson/sourceplane/orun-backend/spec/12-catalog-index.md`
7. `/Users/irinelinson/sourceplane/orun-backend/packages/types/src/index.ts`
8. `/Users/irinelinson/sourceplane/orun-backend/packages/client/src/index.ts`
9. `/Users/irinelinson/sourceplane/orun-backend/apps/dashboard/src/App.tsx`
10. `/Users/irinelinson/sourceplane/orun-backend/apps/dashboard/src/features/catalog/CatalogView.tsx`
11. `/Users/irinelinson/sourceplane/orun-backend/apps/dashboard/src/features/catalog/ComponentDetail.tsx`
12. `/Users/irinelinson/sourceplane/orun-backend/apps/dashboard/src/features/runs/RunsView.tsx`
13. `/Users/irinelinson/sourceplane/orun-backend/apps/dashboard/src/features/runs/RunDetailView.tsx`
14. `/Users/irinelinson/sourceplane/orun-backend/apps/dashboard/src/features/repos/ReposView.tsx`
15. `/Users/irinelinson/sourceplane/orun-backend/apps/dashboard/src/features/settings/SettingsView.tsx`
16. `/Users/irinelinson/sourceplane/orun-backend/apps/dashboard/src/styles.css`
17. All new dashboard tests.

# PR and CI Inspection

Inspect PR metadata, files, diff, and current checks:

```bash
gh pr view 33 --repo sourceplane/orun-backend --json number,title,url,state,isDraft,headRefName,headRefOid,baseRefName,mergeStateStatus,reviewDecision,statusCheckRollup,commits,files,updatedAt
gh pr diff 33 --repo sourceplane/orun-backend --name-only
gh pr diff 33 --repo sourceplane/orun-backend
gh run view 25512977088 --repo sourceplane/orun-backend --json databaseId,displayTitle,headSha,status,conclusion,event,createdAt,updatedAt,url,jobs
gh run view 25512977088 --repo sourceplane/orun-backend --log
```

Verify:

- PR head still matches `42bf3d4ebfd6613600a73b850db3f94902e8946c`, or inspect any newer commits before continuing.
- PR is open, not draft, and merge state is clean.
- All current PR checks are green on the current head.
- CI logs show `orun-dashboard` planned as the changed component.
- CI logs show meaningful `cloudflare-pages-turbo` verification for dev, staging, and production.
- The Pages jobs run install/build/typecheck/test or equivalent component steps expected from the stack, not only no-op shell output.
- Logs do not expose Orun session tokens, GitHub OAuth tokens, Cloudflare tokens, Wrangler tokens, or other credentials.

# Required Verification Work

## 1. Scope and Architecture Review

Verify PR scope is appropriate:

- Changes are centered on `apps/dashboard`, Task 14 prompt/report files, and test config.
- No Worker auth, catalog storage, D1 migrations, client API semantics, or mutable execution routes are changed.
- No new production dependencies are added unless clearly justified.
- No router/global-state/UI framework/charting library is introduced.
- No production mock catalog data is hard-coded.
- Feature split is maintainable enough: catalog, runs, repos, settings, and shell are not all jammed into one large component.
- Existing run/job/log code was preserved behaviorally when extracted.

Review the branch diff against `main`, not just individual files.

## 2. Auth and Security Review

Verify:

- OAuth login still uses the backend GitHub auth URL with a dashboard `returnTo`.
- OAuth fragment parsing still stores only the Orun dashboard session in `sessionStorage`.
- URL fragments containing `sessionToken` are removed from browser history immediately.
- Sign out clears the session.
- 401/403 API responses produce a sign-in-again path or clear auth error state.
- The dashboard does not ask for, expose, store, or log GitHub PATs or GitHub OAuth access tokens.
- The dashboard does not add a catalog sync write path or any mutable coordination route.
- `currentStateRef` is displayed as an artifact reference, not treated as a public download URL unless the backend explicitly provides one.
- UI test fixtures do not leak real tokens, repo IDs, or user-specific secrets.

FAIL for any browser GitHub-token prompt, persistent token storage outside `sessionStorage`, or dashboard catalog-write UI.

## 3. Catalog Home Review

Verify `CatalogView`:

- Defaults to table mode.
- Has a table/card segmented toggle.
- Calls `client.listCatalogComponents` with backend query parameters for supported filters.
- Includes filters for free-text query, repo, owner, type, and status.
- Handles loading, error with retry, no linked repos, no synced components, filtered no-match, and populated states.
- Shows required component fields: name/title, type, repo slug, owner, system, lifecycle, environments, latest status, plan checksum when present, last seen, and tags.
- Does not do all filtering only in memory when the backend supports query params.
- Does not crash on missing optional fields.
- Handles long component names, repo slugs, tags, paths, and checksums without overlapping or breaking layout.

Pay attention to whether filter option lists are derived only from the currently loaded page. If so, note the pagination/filter limitation as a risk, but do not fail unless it violates the task's first-slice scope.

## 4. Component Detail Review

Verify `ComponentDetail`:

- Fetches the component detail first and treats a 404 as not found.
- Uses `getCatalogComponent`, `getCatalogComponentDependencies`, `getCatalogComponentRuns`, and `getCatalogComponentHistory`.
- Shows Overview fields required by the task: title/name, type, repo, path, owner, system, lifecycle, tags, environments, latest plan checksum, latest commit, status, first seen, last synced, and artifact ref.
- Shows outgoing dependencies and incoming dependents with empty states.
- Shows recent runs with status, repo, trigger, actor, job counts, and created time.
- Selecting a recent run opens the existing run detail/log workflow.
- Shows catalog history events with event type, commit, PR number, upload ID, and created time where present.
- Handles partial failures in dependencies/runs/history without hiding a successfully loaded component overview.
- Does not assume `currentStateRef` is a public URL.

## 5. Runs Preservation

Verify extracted runs views:

- Runs view still loads real run data through `client.listRuns`.
- Search/filter by repo, status, or run ID still works.
- Run row selection opens run detail.
- Run detail loads `getRun` and `listJobs`.
- Jobs remain grouped by component.
- Log viewer calls `getLog`, displays logs, and handles 404/no-log behavior.
- The run detail view is reachable both from the Runs nav and from Component Detail recent runs.
- Existing statuses/dry-run indicators remain readable and consistent.

## 6. Repositories and Settings Review

Verify `ReposView`:

- Uses `client.listLinkedRepos`.
- Uses catalog rows only to derive component count, last sync, and status summary.
- Handles linked repo with no catalog data.
- Does not add browser repo creation/linking or PAT prompts.
- Handles no linked repos and API errors.

Verify `SettingsView`:

- Shows GitHub login, account state, API base URL, namespace/repo count context, and sign out.
- Does not expose raw session token.
- Does not add mutable execution controls or arbitrary actions.

## 7. Responsive and Visual QA

Start the dashboard locally:

```bash
pnpm --filter @orun/dashboard dev
```

Use the in-app browser/browser automation if available. If live auth is not available locally, use test fixtures, mocked client paths, or a safe local harness to exercise authenticated states. Do not use real tokens in screenshots or logs.

Verify at minimum:

- `1440px` desktop: login screen, authenticated shell, catalog table, catalog card mode, component detail, repos, runs, run detail, log viewer.
- `768px` tablet: navigation, filters, table/card layout, component detail tabs/sections.
- `390px` mobile: no overlapping text, nav usable, filters wrap, tables scroll or reflow cleanly, buttons fit, log viewer usable.

Important frontend checks:

- No text overlaps.
- Buttons and filter controls fit their containers.
- Long identifiers do not break the layout.
- Table/card toggle and tabs have accessible labels/state.
- Focus states are visible enough.
- Palette remains work-focused and not one-note.
- No cards nested inside cards.

If visual/browser QA cannot be fully performed, document exactly why and what was used instead. Do not pass a frontend-heavy task solely on CSS review.

## 8. Local Checks

Run from `/Users/irinelinson/sourceplane/orun-backend`:

```bash
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

Also run targeted dashboard checks:

```bash
pnpm --filter @orun/dashboard test
pnpm --filter @orun/dashboard typecheck
pnpm --filter @orun/dashboard build
```

Because this task changes a deployed Pages component, run:

```bash
/Users/irinelinson/.local/bin/kiox -- orun plan --changed
/Users/irinelinson/.local/bin/kiox -- orun run --changed
```

If local `orun run --changed` fails only because Cloudflare deployment secrets such as `CLOUDFLARE_ACCOUNT_ID` are unavailable locally, record the exact failure and rely on PR CI only after inspecting the CI Pages job logs. FAIL for any local build/test/typecheck failure.

# Acceptance Criteria

Task 0014 may PASS only if:

- Authenticated dashboard defaults to Catalog.
- Catalog table/card views work from real `@orun/client` methods.
- Catalog filters call `listCatalogComponents` with expected query parameters.
- Loading/error/empty/populated states are implemented and tested.
- Component detail renders overview, dependencies, recent runs, and history from catalog methods.
- Selecting a recent run opens run detail.
- Existing Runs and Run Detail workflows still work.
- Repositories view shows linked repos and derived catalog sync/component-count health.
- Settings view shows session/account/API context and sign out.
- OAuth/session security remains intact.
- No PAT prompt, production mock data, catalog write UI, or mutable dashboard execution control is introduced.
- React Testing Library coverage is meaningful and all local checks pass.
- PR CI is green and logs prove Pages component verification ran.
- Browser/visual QA is performed enough to catch obvious layout defects on desktop/tablet/mobile.

# FAIL Criteria

FAIL if any of the following are true:

- The dashboard still lands primarily on Runs instead of Catalog after auth.
- Catalog UI is backed by production hard-coded mock data instead of `@orun/client`.
- Filters do not call backend query params where supported.
- Component detail does not use the backend detail/dependencies/runs/history APIs.
- Existing run/job/log workflows are broken or unreachable.
- OAuth fragments or session tokens are mishandled.
- The UI asks for a GitHub PAT or exposes GitHub tokens.
- Dashboard sessions gain catalog write or mutable execution capabilities.
- The responsive layout has obvious overlap/overflow that blocks normal use.
- Required local checks fail.
- PR CI is stale, failed, or only no-op.
- Non-trivial spec/API/security behavior changes without a proposal.

# Bookkeeping

If PASS:

1. Write `/Users/irinelinson/sourceplane/orun-backend/ai/reports/task-0014-verifier.md` with:
   - `Result: PASS`
   - Summary
   - PR / CI Context
   - Checks
   - Acceptance Review
   - Visual QA
   - Issues
   - Risk Notes
   - Spec Proposals
   - Recommended Next Move
2. Update `/Users/irinelinson/sourceplane/orun-backend/ai/state.json`:
   - add `14` to `completed`
   - keep `repo_health` yellow unless you also resolve the old Task 0012 local conformance note
   - set `next_focus` to the next highest-leverage task, likely `task-0015-cli-bootstrap` unless verification identifies a Task 0014.x remediation
   - add a concise Task 0014 PASS note
3. Commit verifier report/bookkeeping to the PR branch.
4. Push the verifier commit.
5. Wait for CI on the verifier commit and inspect logs again.
6. Merge PR #33 only after local checks, visual QA, and PR CI logs are all acceptable.
7. After merge, checkout `main` locally and fast-forward pull from `origin/main`.

If FAIL:

1. Write `/Users/irinelinson/sourceplane/orun-backend/ai/reports/task-0014-verifier.md` with `Result: FAIL`.
2. Include concrete blockers with file/line references, screenshots if useful, and exact failing commands.
3. Leave PR #33 open.
4. Do not add Task 0014 to `completed`.
5. Leave clear PR feedback or a review comment with the blockers.
6. Recommend a bounded Task 0014.x remediation if the fix is more than a small verifier-approved patch.

# When Done Report

Write:

```text
/Users/irinelinson/sourceplane/orun-backend/ai/reports/task-0014-verifier.md
```

Use the standard verifier report shape:

- Result: PASS|FAIL
- Summary
- PR / CI Context
- Checks
- Acceptance Review
- Visual QA
- Issues
- Risk Notes
- Spec Proposals
- Recommended Next Move
