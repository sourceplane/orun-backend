# @orun/dashboard

Static operational dashboard for orun-backend, deployed to Cloudflare Pages.

## Local Development

```bash
pnpm install
pnpm --filter @orun/dashboard dev
```

The dev server runs at `http://localhost:5173` by default.

### Environment Variables

Create `.env.local` (not committed) or configure in your shell:

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_ORUN_API_BASE_URL` | `http://localhost:8787` | API Worker origin |

For local development, start the Worker with `pnpm --filter @orun/worker dev` and the dashboard will connect to it.

## GitHub OAuth Callback

The dashboard uses a browser OAuth return flow:

1. User clicks "Sign in with GitHub"
2. Browser navigates to `${API_BASE}/v1/auth/github?returnTo=${dashboardOrigin}/`
3. Backend redirects to GitHub OAuth
4. GitHub redirects back to `${API_BASE}/v1/auth/github/callback`
5. Backend validates the callback and redirects to the dashboard with a session token in the URL fragment
6. Dashboard parses the fragment, stores the session in `sessionStorage`, and strips the fragment from history

### Required GitHub OAuth App Configuration

- **Authorization callback URL**: `https://orun-api.rahulvarghesepullely.workers.dev/v1/auth/github/callback`
- **Homepage URL**: `https://orun-dashboard.pages.dev`

### Required Worker Secrets

Set these on the live Worker (not committed):

```bash
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET
wrangler secret put ORUN_SESSION_SECRET
```

### Required Worker Environment Variable

Set `ORUN_DASHBOARD_URL` so the backend validates the `returnTo` origin:

```bash
# Add to wrangler.jsonc vars or set as a secret
ORUN_DASHBOARD_URL=https://orun-dashboard.pages.dev
```

## Cloudflare Pages Deployment

This app uses the `cloudflare-pages-turbo` component type from stack-tectonic v0.12.0.

### Manual Deploy

```bash
pnpm --filter @orun/dashboard build
pnpm --filter @orun/dashboard exec wrangler pages deploy dist --project-name orun-dashboard
```

### Production URL

`https://orun-dashboard.pages.dev`

## Scripts

| Script | Description |
|--------|-------------|
| `dev` | Start Vite dev server |
| `build` | Production build to `dist/` |
| `typecheck` | TypeScript type checking |
| `test` | Run Vitest |

## Security Notes

- Session tokens are stored in `sessionStorage` (cleared on tab close)
- OAuth fragments are stripped from browser history immediately after parsing
- GitHub OAuth access tokens are never exposed to the dashboard
- The dashboard uses only session-authenticated read endpoints
- Mutable execution routes (claim/update/heartbeat) remain OIDC-only
