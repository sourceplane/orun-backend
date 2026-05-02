# Proposal

Define the first dashboard UI slice and add a safe browser OAuth callback contract.

# Found By

Orchestrator during Task 0009 planning.

# Related Task

Task 0009 - Dashboard UI

# Current Spec Text / Contract

`SCHEDULE.md` defines Task 0009 only at a high level:

- Build a React/Next.js or equivalent web UI served from Cloudflare Pages.
- Include component list with job status, run history per component, log viewer, and GitHub OAuth login.

`spec/04-worker-api.md` and `spec/06-auth.md` define:

- `GET /v1/auth/github` redirects to GitHub OAuth.
- `GET /v1/auth/github/callback` exchanges the OAuth code and returns JSON containing `sessionToken`, `githubLogin`, and `allowedNamespaceIds`.
- Session-authenticated dashboard reads call `/v1/runs`, `/v1/runs/:runId`, `/v1/runs/:runId/jobs`, and `/v1/runs/:runId/logs/:jobId`.
- Repo linking uses `POST /v1/accounts/repos` with a caller-supplied `X-GitHub-Access-Token`.

# Repo Reality / New Information

There is no `apps/dashboard` app yet. `packages/client/src/index.ts` is only a placeholder:

```ts
export class OrunClient {
  constructor(private readonly baseUrl: string) {}
}
```

The current OAuth callback is workable for tests and API clients, but not for a static browser app served from Cloudflare Pages. A user who starts OAuth from the dashboard is redirected to the API callback and receives a JSON response on the API origin. The Pages app never receives the session token.

The current repo-linking mutation also cannot be safely implemented in a browser dashboard as written. `POST /v1/accounts/repos` requires a GitHub access token header, but the backend callback intentionally does not return or persist GitHub access tokens. Returning a GitHub access token to the browser or storing it durably would alter the security model.

# Proposed Spec Change

For Task 0009, define a bounded first dashboard slice:

1. Add `apps/dashboard` as a Vite + React + TypeScript static dashboard app intended for Cloudflare Pages.
2. Build `packages/client` into a typed browser-friendly API client for the existing read/session endpoints.
3. Extend GitHub OAuth with an optional dashboard return flow:
   - `GET /v1/auth/github?returnTo=<url>` includes the return URL inside the signed OAuth state.
   - `returnTo` must be restricted to a configured dashboard origin, such as `ORUN_DASHBOARD_URL`, or rejected with `INVALID_REQUEST`.
   - The callback keeps the existing JSON response when no `returnTo` is present.
   - When `returnTo` is present, the callback redirects to the dashboard callback URL with the orun `sessionToken`, `githubLogin`, and `allowedNamespaceIds` in the URL fragment, not the query string.
   - The backend must never include the GitHub OAuth access token in the redirect, logs, errors, D1, R2, or session JWT.
4. Dashboard UI scope for Task 0009 is read-oriented:
   - GitHub login and callback handling.
   - Session storage and sign out.
   - Account create/current-account display.
   - Linked repo listing.
   - Recent run history.
   - Run detail with jobs grouped by component/status.
   - Job log viewer.
5. Defer browser repo-link creation until a separate token/install model is specified. The dashboard may show linked repos and may support unlinking if implemented safely with only the session token, but it must not ask users to paste GitHub access tokens and must not expose GitHub OAuth access tokens to browser JavaScript.
6. Add or update specs/docs to capture the dashboard OAuth redirect and first-slice UI scope.
7. Cloudflare Pages delivery should use a Tectonic component if one exists. If the current stack catalog lacks a Pages component, the implementer must not invent an invalid component type or custom workflow; they should keep CI build/typecheck/test wired through Turbo and add a follow-up proposal for Pages delivery wiring.

# Why This Is Needed

The dashboard cannot log users in without a safe way to hand the backend-issued session token back to the static app. The existing JSON callback would strand the session token on the API origin.

The repo-link mutation needs a separate decision because the current contract expects a GitHub access token but the security model avoids storing or exposing GitHub tokens. Treating that as a dashboard feature without a spec decision would either fail in practice or weaken the auth boundary.

# Impacted Files / Tasks

Likely impacted files:

- `spec/04-worker-api.md`
- `spec/06-auth.md`
- `SCHEDULE.md`
- `README.md`
- `packages/types/src/index.ts`
- `packages/client/src/index.ts`
- `packages/client/src/*.test.ts`
- `apps/worker/src/auth/github-oauth.ts`
- `apps/worker/src/auth/github-oauth.test.ts`
- `apps/worker/src/handlers/auth.ts`
- `apps/worker/src/api.test.ts`
- `apps/dashboard/**`

Task impacts:

- Task 0009 should include the OAuth return flow and read-only dashboard.
- A later task should decide the safe repo-link creation model.
- A later task may add Cloudflare Pages deployment wiring if the current Tectonic stack does not expose a supported Pages component.

# Compatibility / Migration Notes

- Existing `/v1/auth/github` and `/v1/auth/github/callback` JSON behavior must remain backward-compatible when `returnTo` is absent.
- Session JWT shape can remain unchanged.
- No existing Worker execution endpoints should accept session tokens for mutable job operations.
- No persisted data migration is required for the first dashboard slice.

# Recommendation

Accept for Task 0009.

Implement the safe OAuth return flow and read-only dashboard now. Defer browser repo-link creation unless the implementer writes a separate proposal and the orchestrator accepts it.
