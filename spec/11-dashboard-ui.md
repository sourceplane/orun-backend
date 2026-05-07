# Spec 11 - Dashboard UI (`apps/dashboard`)

## Scope

A static React/Vite/TypeScript dashboard served from Cloudflare Pages. The dashboard starts as a read-oriented operations UI and evolves into Orun's Git-native software catalog plus CI intelligence product.

The product direction comes from `orun-cloud-saas-conversations.tx`: Orun should not copy a generic Backstage-style metadata portal. Orun should derive a catalog from the same plan engine that already understands components, environments, dependencies, jobs, changed files, checksums, run history, and logs.

The dashboard must not become the component source of truth. Git repos remain authoritative. Orun Cloud stores the searchable index, history, relations, run summaries, raw artifacts, and eventually approved automation records.

---

## Stack

- Vite
- React 18
- TypeScript strict mode
- Vitest and React Testing Library
- `@orun/client` typed HTTP client
- `@orun/types` shared response contracts
- Cloudflare Pages via `cloudflare-pages-turbo`

No client-side GraphQL, global state framework, router framework, or charting library should be added until the UI need is real. Prefer small typed API hooks and local component state for the next slices.

---

## Product Architecture

```text
Source of truth     Git repos, component descriptors, intent.yaml, stack.yaml
Compile layer       orun plan / validate / changed-component detection
Cloud index         catalog components, relations, PR/run/job history
Product UI          catalog, component pages, dependency graph, insights
```

The dashboard should answer questions that are hard for generic catalogs:

- Which components exist across my linked repos?
- Who owns this component and what system does it belong to?
- What plan/jobs/environments are affected by this component?
- What changed in the last PR and which jobs ran afterwards?
- Which components, APIs, resources, and jobs depend on this component?
- Where are the latest logs and raw plan artifacts?

---

## Information Architecture

### Global App Shell

The authenticated shell should be an operational product surface, not a marketing page.

Required shell elements:

- Left navigation: Catalog, Runs, Repositories, Settings.
- Top bar: product mark, account/repo scope, global search, refresh, user menu.
- Session state: visible GitHub login, sign out, token-expired handling.
- Error surfaces: typed API errors with retry where appropriate.

The first implementation may keep a single-page state machine instead of full route management. Once Catalog and Component detail both exist, add URL-addressable routes so links can be shared.

### Catalog Home

The catalog home is the primary landing view after login.

Required first-slice capabilities:

- All Components table.
- Filters for repo, owner, type, status, and free-text query.
- Table/card view mode toggle. Table mode is the default.
- Empty states for no linked repos, no synced components, and failed loads.
- Component rows show:
  - component name/title
  - type
  - repo slug
  - owner/team
  - system/domain
  - environments
  - latest plan/run status when available
  - last seen or last changed timestamp
  - tags

Dashboard density should be work-focused: compact rows, clear metadata, strong scanability. Avoid decorative hero layouts and oversized marketing copy.

### Component Detail

Each component gets a detail view with tabs or sections:

- Overview
- Runs
- PR History
- Dependencies
- Environments
- Logs
- Raw Artifacts
- Scorecard (deferred)
- Actions (deferred)

Required first-slice fields:

- name/title
- type
- repo
- path
- owner
- system
- lifecycle
- tags
- environments
- latest plan checksum
- latest commit
- current status
- last synced timestamp
- direct dependencies and dependents
- recent runs touching the component

### Runs

The existing operational run list remains valuable and should stay available.

Required capabilities:

- Recent runs table with repo namespace, status, trigger, actor, job counts, and timestamps.
- Search/filter by repo, status, run ID, actor, and component when backend supports it.
- Run detail with metadata, jobs grouped by component, and log viewer.

### Repositories

Repository view shows linked repos and sync health:

- namespace/repo slug
- linked timestamp
- last catalog sync
- component count
- latest run status
- sync errors when available

Browser repo-link creation remains deferred until the GitHub App or safe token/install model is specified. The dashboard must not ask users to paste GitHub PATs.

### Actions

Actions are deferred beyond the catalog MVP. When introduced, they must dispatch approved Orun capabilities, not arbitrary shell commands.

Examples for later phases:

- run plan
- deploy staging
- promote production
- rollback
- generate component README
- request ownership update
- run policy check

Cloud UI must not directly claim jobs as a dashboard user session. SaaS dispatch requires a separate signed execution-request model plus repo workflow identity.

---

## Data Dependencies

The existing Task 0009 dashboard uses:

- `GET /v1/accounts/me`
- `POST /v1/accounts`
- `GET /v1/accounts/repos`
- `GET /v1/runs`
- `GET /v1/runs/:runId`
- `GET /v1/runs/:runId/jobs`
- `GET /v1/runs/:runId/logs/:jobId`

The catalog dashboard requires the catalog API from `spec/12-catalog-index.md`:

- `GET /v1/catalog/components`
- `GET /v1/catalog/components/:componentId`
- `GET /v1/catalog/components/:componentId/history`
- `GET /v1/catalog/components/:componentId/runs`
- `GET /v1/catalog/components/:componentId/dependencies`
- `GET /v1/repos/:repoId/components`

Do not hard-code mock catalog data into the production app. If the backend is not ready, keep the UI slice behind tests or fixture-only stories until the API exists.

---

## Authentication Flow

1. User clicks "Sign in with GitHub" on the login screen.
2. Browser navigates to `${API_BASE}/v1/auth/github?returnTo=${dashboardCallbackURL}`.
3. Backend validates `returnTo` against `ORUN_DASHBOARD_URL` and initiates GitHub OAuth.
4. After GitHub callback, backend issues an Orun dashboard session JWT and redirects to `returnTo#sessionToken=...&githubLogin=...&allowedNamespaceIds=...`.
5. Dashboard parses the URL fragment, stores the session in `sessionStorage`, and replaces browser history to remove the fragment.
6. Subsequent API calls use `Authorization: Bearer <sessionToken>`.

Security constraints:

- Session tokens live in `sessionStorage`, not `localStorage`.
- URL fragments are removed from history immediately after parsing.
- GitHub OAuth access tokens are never returned to or stored by the dashboard.
- Dashboard sessions are read-oriented.
- Mutable execution routes remain OIDC or CLI-session only.
- Catalog sync writes are OIDC-only for canonical repo namespaces.

---

## Frontend Design Principles

- Build the actual operational surface as the first viewport after login.
- Use quiet, dense, predictable SaaS layout patterns.
- Prefer tables, tabs, filters, segmented controls, and icon buttons where they improve repeated use.
- Use compact cards only for repeated entities or detail panels; do not nest cards inside cards.
- Keep status color semantics consistent across runs, jobs, components, and environments.
- Preserve keyboard and screen-reader access for filters, tabs, tables, and log viewer.
- Ensure long repo names, component IDs, job IDs, and log lines do not break layout on mobile.
- Keep all UI copy product-specific and concise.

---

## UI State Model

Recommended state boundaries:

- `auth.ts`: OAuth fragment parsing, session storage, sign out.
- `api.ts`: `@orun/client` construction and API base URL.
- `App.tsx`: top-level shell, view selection, session gates.
- `features/catalog/*`: catalog list, filters, component detail.
- `features/runs/*`: existing run list/detail/log viewer.

The current single-file `App.tsx` was acceptable for the first slice. Catalog work should split feature modules before the file becomes harder to test.

---

## Testing Requirements

Dashboard tests should cover:

- OAuth callback parsing and fragment cleanup.
- Login link uses `returnTo`.
- Authenticated shell loads account/repo/run data.
- Catalog list renders loading, empty, error, and populated states.
- Filters update query state and call the client with expected parameters.
- Component detail renders overview, dependencies, recent runs, and raw artifact links.
- Run detail still groups jobs by component and loads logs.
- Long component/repo/job strings remain accessible and do not truncate critical identifiers without title/tooltip access.

---

## Delivery

- Component type: `cloudflare-pages-turbo`
- Project name: `orun-dashboard`
- Production URL: `https://orun-dashboard.sourceplane.ai`
- Build output: `dist/`
- API base: `VITE_ORUN_API_BASE_URL`

The dashboard should be manually smoke-tested at desktop and mobile widths before a UI PR is merged. At minimum check sign-in screen, authenticated shell, empty catalog, populated catalog fixture, run detail, and log viewer.

---

## Product Phases

### Phase 1 - Catalog MVP

- catalog sync API and D1/R2 index
- global component catalog
- component detail overview
- repo catalog view
- tags and filters
- latest plan/run status
- PR/change history placeholder backed by sync events
- raw artifact links

### Phase 2 - CI Intelligence

- plan diff viewer
- affected components per PR
- dependency impact graph
- job-level history
- environment promotion timeline
- slowest/flaky job trends

### Phase 3 - Scorecards and Policy

- ownership score
- production readiness score
- observability score
- security score
- deployment safety score
- documentation score

### Phase 4 - Approved Actions

- plan, deploy, promote, rollback, generate, and policy-check actions through approved Orun capabilities.
- no arbitrary shell commands from the UI.

### Phase 5 - AI-Native Platform

- semantic search across component metadata, docs, PR summaries, logs, and runbooks.
- guided answers for "what changed", "what depends on this", and "why did this deploy fail".

---

## Deferred Features

- Browser repo-link creation.
- GitHub App install flow.
- Real-time updates with SSE/WebSockets.
- Advanced saved filters.
- Scorecards.
- Approved actions and SaaS dispatch.
- AI search.
