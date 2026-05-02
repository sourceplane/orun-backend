# Spec 11 — Dashboard UI (`apps/dashboard`)

## Scope

A static React/Vite/TypeScript operational dashboard served from Cloudflare Pages. Provides session-authenticated read access to account, repos, runs, jobs, and logs.

---

## Stack

- Vite (build + dev server)
- React 18 (UI)
- TypeScript (strict)
- Vitest (tests)
- `@orun/client` (typed HTTP client)
- Cloudflare Pages (hosting via `cloudflare-pages-turbo` component)

---

## Authentication Flow

1. User clicks "Sign in with GitHub" on the login screen.
2. Browser navigates to `${API_BASE}/v1/auth/github?returnTo=${dashboardCallbackURL}`.
3. Backend validates `returnTo` against `ORUN_DASHBOARD_URL` and initiates GitHub OAuth.
4. After GitHub callback, backend issues a session JWT and redirects to `returnTo#sessionToken=...&githubLogin=...&allowedNamespaceIds=...`.
5. Dashboard parses the URL fragment, stores the session in `sessionStorage`, and replaces browser history to remove the fragment.
6. Subsequent API calls use `Authorization: Bearer <sessionToken>`.

### Security Constraints

- Session tokens live in `sessionStorage` (not `localStorage`) — cleared on tab close.
- URL fragments are removed from history immediately after parsing.
- GitHub OAuth access tokens are **never** returned to or stored by the dashboard.
- The dashboard **does not** call mutable execution routes (claim/update/heartbeat) — those remain OIDC-only.

---

## Views

### Login Screen

- Compact, centered sign-in card.
- Single "Sign in with GitHub" action.

### Authenticated Dashboard

- **Toolbar**: brand, user info, refresh action, sign-out action.
- **Account state**: auto-create if missing (POST /v1/accounts), display current account.
- **Linked repos bar**: display `namespaceSlug` chips from GET /v1/accounts/repos.
- **Runs list**: table showing runId, repo slug, status, trigger, actor, job counts, timestamps.
- **Filter/search**: text input filtering by repo slug, status, or run ID.
- **Run detail**: metadata + jobs grouped by component + log viewer panel.
- **Job items**: status dot, jobId, status text, runner, error indicator.
- **Log viewer**: monospaced text pane with loading/empty/error states.

---

## API Endpoints Used

| Endpoint | Purpose |
|----------|---------|
| `GET /v1/accounts/me` | Current account |
| `POST /v1/accounts` | Create account |
| `GET /v1/accounts/repos` | Linked repos |
| `DELETE /v1/accounts/repos/:id` | Unlink repo |
| `GET /v1/runs` | Recent runs |
| `GET /v1/runs/:runId` | Run detail |
| `GET /v1/runs/:runId/jobs` | Jobs for run |
| `GET /v1/runs/:runId/jobs/:jobId/status` | Job detail |
| `GET /v1/runs/:runId/logs/:jobId` | Job log text |

---

## Configuration

| Variable | Scope | Description |
|----------|-------|-------------|
| `VITE_ORUN_API_BASE_URL` | Build-time | API Worker origin |
| `ORUN_DASHBOARD_URL` | Worker env | Dashboard origin for `returnTo` validation |

---

## Deferred Features

- Browser repo-link creation (requires safe token/install model — separate proposal needed).
- Real-time updates (WebSocket/SSE).
- Multi-page routing.
- Advanced filtering (date range, actor, trigger type).

---

## Delivery

- Component type: `cloudflare-pages-turbo` (stack-tectonic v0.12.0)
- Project name: `orun-dashboard`
- Production URL: `https://orun-dashboard.pages.dev`
- Build output: `dist/`
