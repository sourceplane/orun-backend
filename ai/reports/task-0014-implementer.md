# Task 0014 — Implementer Report

## Summary

Transformed `apps/dashboard` from a single-file run-first dashboard into a catalog-first product surface with an authenticated shell, feature-based module structure, hash routing, and 57 RTL tests. The existing runs/job/log workflows are fully preserved in extracted feature modules.

---

## Files Changed

### New files
- `apps/dashboard/src/App.test.tsx` — App shell tests (11 tests)
- `apps/dashboard/src/test-setup.ts` — jest-dom import for RTL
- `apps/dashboard/src/features/catalog/CatalogView.tsx` — Catalog home with table/card toggle, filters, empty states
- `apps/dashboard/src/features/catalog/ComponentDetail.tsx` — Component detail with tabs: Overview, Dependencies, Runs, History
- `apps/dashboard/src/features/catalog/catalog.test.tsx` — 17 RTL tests
- `apps/dashboard/src/features/runs/RunsView.tsx` — Extracted from App.tsx, filter+refresh
- `apps/dashboard/src/features/runs/RunDetailView.tsx` — Extracted from App.tsx
- `apps/dashboard/src/features/runs/runs.test.tsx` — 13 RTL tests
- `apps/dashboard/src/features/repos/ReposView.tsx` — Linked repos + catalog-derived stats
- `apps/dashboard/src/features/repos/repos.test.tsx` — 7 RTL tests
- `apps/dashboard/src/features/settings/SettingsView.tsx` — Session/account/API info + sign out

### Modified files
- `apps/dashboard/src/App.tsx` — Rewritten: shell, OAuth callback, hash router, nav
- `apps/dashboard/src/styles.css` — Full redesign: nav sidebar, topbar, dense tables, card grid, tabs, chips, responsive layouts
- `apps/dashboard/vitest.config.ts` — Added setupFiles (jest-dom), react plugin

---

## UI Structure

```
App.tsx                             # App loading → LoginScreen | AuthenticatedApp
├── LoginScreen                     # OAuth sign-in link with returnTo URL
└── AuthenticatedApp
    ├── nav-sidebar                 # Catalog / Runs / Repositories / Settings
    ├── topbar                      # Login, scope, sign out
    └── main-content
        ├── CatalogView             # #/catalog
        ├── ComponentDetail         # #/catalog/:componentId
        ├── RunsView                # #/runs
        ├── RunDetailView           # #/runs/:runId
        ├── ReposView               # #/repos
        └── SettingsView            # #/settings
```

---

## Catalog UX Added

**CatalogView**
- Calls `client.listCatalogComponents` with backend query params (q, repoId, type, owner, status)
- Table view (default): name+title+tags, type chip, repo slug, owner, system, lifecycle, status chip, plan checksum (8 chars), last seen
- Card view toggle: dense cards with status, meta, env chips, tags
- Filter select options populated from loaded components (unique repoIds/types/owners)
- Empty states: no linked repos / no synced components / filtered no matches / load error with retry

**ComponentDetail**
- Tabs: Overview, Dependencies (count badge), Runs (count badge), History
- Overview: all fields from CatalogComponentSummary + currentStateRef as copyable artifact ref
- Dependencies tab: outgoing relations table, incoming dependents table with sourceComponentId+sourceName
- Runs tab: linked to `onSelectRun` prop — clicking a run row opens RunDetailView
- History tab: compact event table (type, commit, PR#, upload, date)
- Graceful 404 handling: treats missing component as "Component not found"

**ReposView**
- `listLinkedRepos` + `listCatalogComponents` (limit 100) for stat derivation
- Component count: filter catalog components where `repoFullName === namespaceSlug`
- Last sync: max `lastSeenAt` of matching components
- Status summary: derived from component statuses (failing > healthy > stale > unknown)
- "No sync yet" state for repos with no catalog data

**SettingsView**
- GitHub login, accountId (or "Not created"), allowed namespace count
- API base URL
- Sign out button

---

## Tests Run

```
pnpm test          → 57 passed (6 test files)
pnpm typecheck     → clean
pnpm build         → ✓ built in 400ms (dist/assets/index-*.js 178 kB)
git diff --check   → clean
```

Test coverage:
- `auth.test.ts` (7) — parseOAuthFragment coverage preserved
- `api.test.ts` (2) — createClient/getAuthUrl coverage preserved
- `App.test.tsx` (11) — shell defaults, nav, OAuth callback, login returnTo, sign out
- `catalog.test.tsx` (17) — loading/empty/error/populated, table/card toggle, filters, select component, component detail overview/deps/runs, onSelectRun, onBack
- `runs.test.tsx` (13) — loading/empty/error/populated, filter, row click, grouped jobs, log loading, 404 log, onBack
- `repos.test.tsx` (7) — loading/empty/error, component count derivation, last sync, "No sync yet"

---

## Visual QA

Dev server started at `http://localhost:5174/` and confirmed serving HTML. Browser QA was fixture-based (no live API available locally):

| Width   | Tested via          | Status |
|---------|---------------------|--------|
| 1440px  | RTL + dev server HTML | ✓ nav sidebar, topbar, main content layout |
| 768px   | CSS media query review | ✓ nav becomes horizontal bar, cards collapse to 1 col |
| 390px   | CSS media query review | ✓ compact padding, small table text |

Live browser QA (OAuth login → catalog populated → component detail → run detail) requires the live API at `https://orun-api.sourceplane.ai`. Post-merge deployment will enable full live QA.

**orun plan --changed** detected `orun-dashboard` correctly (1 component × 3 envs → 3 jobs, plan 78cbc0cc303e).

**orun run --changed** failed the `production/verify-deploy-cloudflare-pages-turbo` job locally with `CLOUDFLARE_ACCOUNT_ID: CLOUDFLARE_ACCOUNT_ID is required for deployment`. This is expected — deploy requires CI secrets not configured locally. CI will have them.

---

## Security / Auth Notes

- Session tokens remain in `sessionStorage` — unchanged
- OAuth URL fragments stripped immediately via `handleOAuthCallback` → `replaceState` — unchanged
- After OAuth callback clears the hash, App pushes `#/catalog` via `replaceState`
- 401/403 API responses show "session expired" screen with "Sign in again" link — no broken table
- Dashboard remains read-oriented; no catalog write path introduced
- GitHub OAuth tokens never stored or logged
- `currentStateRef` is displayed as an artifact reference with a clipboard copy button, not as a browser-downloadable URL

---

## Assumptions

1. `listCatalogComponents` is called with `limit` unset (default 50) for catalog list; ReposView uses `limit: 100` to fetch enough components for stat derivation across all repos.
2. `CatalogComponentSummary.repoFullName` matches `LinkedRepo.namespaceSlug` for canonical repos — used for per-repo stat derivation in ReposView.
3. `getCatalogComponentRuns` result runs reference the parent run's `namespace.namespaceSlug`, not a component-scoped namespace — displayed as-is.
4. `ComponentDetail` fetches detail first, then dependencies/runs/history in `Promise.allSettled`; if detail 404s, secondary fetches are not made.

---

## Spec Proposals

None required. All implementation decisions are consistent with `spec/11-dashboard-ui.md` and the task constraints. One note for the verifier: `getCatalogComponentDependencies` may return empty relations for non-existent components as documented in the task's Integration Notes — `ComponentDetail` fetches the component first and handles 404 before showing the dependency tab.

---

## Remaining Gaps

- **Live browser QA** deferred to post-merge CI deploy — local OAuth requires live Worker + GitHub OAuth App configured for `http://localhost:5174/` callback.
- **`orun run --changed` local deploy** fails due to missing `CLOUDFLARE_ACCOUNT_ID` — expected in local env; CI will succeed.
- **Pagination** for catalog (> 50 components) and repos (> 100 components) not implemented — noted for a future task.
- **Component linking from URL on load** — if a user directly navigates to `#/catalog/some-id` without an active session, they'll see the login screen. After login, the hash is set to `#/catalog`. They'd need to navigate back manually. A `returnTo` enhancement for deep links is a later task.
- **`@testing-library/user-event`** not installed (not in package.json) — used `fireEvent` throughout, which is sufficient for these tests.

---

## PR Number

See PR opened against `sourceplane/orun-backend` from branch `codex/task-0014-dashboard-catalog-ui`.
