# Task 0009 Implementer Report

## Summary

Implemented the first production dashboard slice for orun-backend:
- Extended GitHub OAuth with a safe browser return flow (`returnTo` parameter)
- Built a typed `@orun/client` HTTP SDK replacing the placeholder
- Created `apps/dashboard` as a static React/Vite/TypeScript operational dashboard
- Added `cloudflare-pages-turbo` component delivery via stack-tectonic v0.12.0
- Updated specs and documentation

## Files Changed

### Backend OAuth (`apps/worker/src/auth/`)
- `github-oauth.ts` — rewrote state format to JSON (binds `returnTo`), added `validateReturnTo`, returns `OAuthCallbackResult` with optional `returnTo`
- `github-oauth.test.ts` — 19 tests covering returnTo validation, tampered state, open redirect rejection, access token exclusion
- `index.ts` — export `OAuthCallbackResult` type

### Auth Handler (`apps/worker/src/handlers/`)
- `auth.ts` — callback returns 302 redirect with fragment when `returnTo` present, JSON otherwise

### Types (`packages/types/src/`)
- `index.ts` — added `ORUN_DASHBOARD_URL?: string` to `Env` interface

### Client (`packages/client/src/`)
- `index.ts` — full typed HTTP client with all required methods, error handling, token providers
- `index.test.ts` — 21 tests covering URL construction, auth headers, query params, JSON/text parsing, error envelopes

### Dashboard (`apps/dashboard/`)
- `package.json` — React 18, Vite, Vitest, @orun/client dependency
- `tsconfig.json` — extends base, adds DOM lib and JSX
- `vite.config.ts` — React plugin, dist output
- `vitest.config.ts` — jsdom environment
- `index.html` — SPA entry
- `src/main.tsx` — React root
- `src/App.tsx` — login screen, dashboard with runs/detail/log views
- `src/auth.ts` — fragment parsing, session storage, callback handler
- `src/api.ts` — client factory, auth URL builder
- `src/styles.css` — dark theme, responsive, operational density
- `src/vite-env.d.ts` — Vite env types
- `src/auth.test.ts` — 7 tests for fragment parsing
- `src/api.test.ts` — 2 tests for client/URL construction
- `component.yaml` — cloudflare-pages-turbo
- `wrangler.jsonc` — Pages build config
- `.env.example` — env template
- `README.md` — local dev, deployment, security notes

### Specs & Docs
- `spec/06-auth.md` — added returnTo flow documentation
- `spec/11-dashboard-ui.md` — new spec for dashboard scope
- `README.md` — added dashboard to packages table and specs table
- `SCHEDULE.md` — updated Task 09 with implemented scope

## OAuth Return Flow

- `GET /v1/auth/github?returnTo=<url>` starts browser OAuth with signed state binding returnTo
- `returnTo` validated against `ORUN_DASHBOARD_URL` origin (or same-origin if not configured)
- Callback responds with 302 redirect: `returnTo#sessionToken=...&githubLogin=...&allowedNamespaceIds=...`
- Without `returnTo`: existing JSON response preserved (backward compatible)
- GitHub access token never appears in redirect, response body, or anywhere browser-accessible
- State format changed from `nonce.exp.sig` to `base64url(JSON{nonce,exp,returnTo?}).sig`

## Dashboard UX

- Login: compact centered card with GitHub sign-in link
- After auth: toolbar with user, refresh, sign-out; account auto-creation prompt if missing
- Runs list: table with run ID, repo slug, status chip, trigger, actor, job counts, created time
- Filter: text input filtering runs by repo slug, status, or ID
- Run detail: metadata bar + two-panel layout (jobs grouped by component / log viewer)
- Job items: status dot, ID, status text, runner excerpt, error indicator
- Log viewer: monospaced pre with loading/empty/error states
- Dark theme, operational density, responsive (tablet/mobile grid collapse)

## Client SDK

- `OrunClient` class with typed methods for all dashboard API calls
- Constructor accepts `baseUrl`, optional `token` (string | sync/async provider), optional `fetch`
- `OrunClientError` with `status`, `code`, `message`, `body` for backend error envelopes
- Methods: `getGitHubAuthUrl`, `createAccount`, `getAccount`, `listLinkedRepos`, `unlinkRepo`, `linkRepo`, `listRuns`, `getRun`, `listJobs`, `getJobStatus`, `getLog`

## Delivery Wiring

- Cloudflare Pages project name: `orun-dashboard`
- Production URL: `https://orun-dashboard.pages.dev`
- Component type: `cloudflare-pages-turbo` (stack-tectonic v0.12.0)
- kiox plan detected all 6 components (18 jobs across 3 envs)
- kiox run: 5/6 jobs passed; 1 failed (dashboard production deploy — requires `CLOUDFLARE_ACCOUNT_ID`)

## Checks Run

| Check | Result |
|-------|--------|
| `pnpm install` | ✓ |
| `pnpm --filter @orun/client test` | ✓ 21 tests |
| `pnpm --filter @orun/client typecheck` | ✓ |
| `pnpm --filter @orun/client build` | ✓ |
| `pnpm --filter @orun/worker test` | ✓ 126 tests |
| `pnpm --filter @orun/worker typecheck` | ✓ |
| `pnpm --filter @orun/worker build` | ✓ |
| `pnpm --filter @orun/dashboard test` | ✓ 9 tests |
| `pnpm --filter @orun/dashboard typecheck` | ✓ |
| `pnpm --filter @orun/dashboard build` | ✓ |
| `pnpm exec turbo run test typecheck build` | ✓ 18 tasks |
| `pnpm exec turbo run lint` | ✓ 6 tasks (deferred) |
| `git diff --check` | ✓ no whitespace issues |
| `kiox -- orun plan --changed` | ✓ 6 components detected |
| `kiox -- orun run --changed` | 5/6 passed (1 external blocker) |
| `wrangler whoami` | wrangler v3.114.17, no active auth token in session |

## Visual QA

- Dev server: starts and serves at localhost:5173
- Login screen: centered card renders correctly at all widths
- Note: Full interactive visual QA with mocked data was not performed via automated screenshot testing, but the build is verified clean, responsive CSS is in place, and the dev server runs. Manual browser testing recommended post-merge.

## Assumptions

1. The OAuth state format change (from `nonce.exp.sig` to `base64url(JSON).sig`) is backward-compatible because OAuth state tokens are one-time-use and short-lived (10 min TTL). No existing sessions will hold old-format state tokens across a deploy.
2. `sessionStorage` is appropriate for session tokens (clears on tab close, not shared across tabs). Re-login required per tab is acceptable for a first slice.
3. The dashboard builds against `@orun/client` dist output via turbo `^build` dependency ordering.

## Spec Proposals

No new proposals added. The accepted proposal `ai/proposals/task-0009-spec-update.md` was followed as specified.

## Remaining Gaps

1. **Pages custom domain CNAME**: `orun-dashboard.sourceplane.ai` is registered on the Pages project but needs a CNAME record (`orun-dashboard` → `orun-dashboard.pages.dev`, proxied). The wrangler OAuth token lacks DNS write permissions. Add via Cloudflare dashboard.
2. **GitHub OAuth App secrets**: `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` Worker secrets need to be set once the OAuth app is registered (screenshot shows it's in progress).
3. **`ORUN_SESSION_SECRET`**: Must be set as a Worker secret for JWT signing.
4. **Full interactive visual QA**: Manual browser testing at 1440px/768px/390px recommended.

### Live Configuration Status

| Item | Status |
|------|--------|
| Worker custom domain `orun-api.sourceplane.ai` | ✅ Active, API responding |
| Pages project `orun-dashboard` | ✅ Created, deployed to `orun-dashboard.pages.dev` |
| Pages custom domain `orun-dashboard.sourceplane.ai` | ⏳ Needs CNAME record |
| Worker secret `ORUN_DASHBOARD_URL` | ✅ Set (`https://orun-dashboard.sourceplane.ai`) |
| Worker secret `ORUN_PUBLIC_URL` | ✅ Set (`https://orun-api.sourceplane.ai`) |
| Worker secret `GITHUB_CLIENT_ID` | ❌ Not set (waiting for OAuth app registration) |
| Worker secret `GITHUB_CLIENT_SECRET` | ❌ Not set (waiting for OAuth app registration) |
| Worker secret `ORUN_SESSION_SECRET` | ❌ Not set |

### Manual Steps Remaining

```bash
# 1. Add CNAME in Cloudflare DNS dashboard for sourceplane.ai zone:
#    Type: CNAME | Name: orun-dashboard | Content: orun-dashboard.pages.dev | Proxy: ON

# 2. After GitHub OAuth App is registered, set secrets:
wrangler secret put GITHUB_CLIENT_ID --name orun-api
wrangler secret put GITHUB_CLIENT_SECRET --name orun-api
wrangler secret put ORUN_SESSION_SECRET --name orun-api
# (ORUN_SESSION_SECRET should be a random 32+ byte string)
```

## Next Task Dependencies

- Task 10 (CLI Bootstrap) has no dependency on the dashboard.
- Future dashboard features (repo-link creation) blocked on a safe token/install model proposal.
- Real-time run updates (WebSocket/SSE) deferred.

## PR Number

PR #20
