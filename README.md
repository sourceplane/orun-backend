# orun-backend

The cloud control plane for the [orun CLI](https://github.com/sourceplane/orun) — a policy-aware workflow compiler that turns CI/CD intents into executable plan DAGs.

When multiple GitHub Actions runners execute `orun run <plan-id> --remote-state` concurrently, they use this backend to coordinate: claim jobs atomically, check dependency status, and report results without race conditions.

Built entirely on Cloudflare: Workers, Durable Objects, R2, and D1.

---

## Architecture

```
GitHub Actions Runner          Browser (UI)
       │                            │
  OIDC JWT                    GitHub OAuth
       │                            │
       └─────────────┬──────────────┘
                     │
             Cloudflare Worker (API)
                     │
        ┌────────────┼────────────┐
        │            │            │
  Durable Object   D1 DB         R2
  (per run)      (index)      (logs/artifacts)
  job state      dashboard
  coordination   queries
```

**Durable Objects** are the source of truth for execution state. One DO per run — single-threaded, no race conditions, atomic job claiming.

**R2** stores logs and artifacts. Append-only, never polled for coordination.

**D1** stores a queryable index for the dashboard. Eventually consistent, derived from DO state.

---

## Key Design Decisions

- **Identity**: `repository_id` (GitHub's numeric ID, not `org/repo`) is the canonical namespace. Survives renames and transfers.
- **Auth**: GitHub OIDC for CI runners (zero config), GitHub OAuth for UI (no passwords).
- **Accounts**: Optional. The system works without accounts via OIDC. Accounts add dashboard visibility and higher rate limits.
- **No zero-trust encryption** in Phase 1. Strong namespace isolation at every storage layer.

---

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm 10+
- Cloudflare account with Workers Paid plan (for Durable Objects)
- `wrangler` CLI

### Install

```bash
pnpm install
```

### Local Development

```bash
pnpm run dev
# Starts wrangler dev with Miniflare — no Cloudflare account needed
```

### Type Check

```bash
pnpm run typecheck
```

### Test

```bash
pnpm test
```

### Deploy

```bash
# Staging
wrangler deploy --env staging

# Production
wrangler deploy --env production
```

---

## Packages

| Package | Description |
|---------|-------------|
| `@orun/types` | Shared TypeScript types — imported by all packages |
| `@orun/coordinator` | RunCoordinator Durable Object |
| `@orun/storage` | R2 + D1 typed utilities |
| `@orun/worker` | Cloudflare Worker: API gateway + auth + routing |
| `@orun/client` | HTTP client SDK for the API |
| `@orun/dashboard` | Static operational dashboard (Cloudflare Pages) |

---

## API Overview

```
POST   /v1/runs                              Create run + init coordinator
GET    /v1/runs                              List runs (dashboard)
GET    /v1/runs/:id                          Get run details

POST   /v1/runs/:id/jobs/:jobId/claim        Claim job (atomic via DO)
POST   /v1/runs/:id/jobs/:jobId/update       Update job status
POST   /v1/runs/:id/jobs/:jobId/heartbeat    Runner heartbeat
GET    /v1/runs/:id/runnable                 List jobs ready to claim

POST   /v1/runs/:id/logs/:jobId              Upload log
GET    /v1/runs/:id/logs/:jobId              Download log

GET    /v1/auth/github                       GitHub OAuth redirect
GET    /v1/auth/github/callback              GitHub OAuth callback

POST   /v1/accounts                          Create account
POST   /v1/accounts/repos                    Link repo (admin-only)
GET    /v1/accounts/repos                    List linked repos
```

---

## CLI Usage

```bash
# Run distributed with backend-backed state
orun run 0b673779a274 --remote-state

# Check run status
orun status --remote-state --exec-id gh-123456789-1-0b673779a274

# View logs
orun logs --remote-state --exec-id gh-123456789-1-0b673779a274 --job api-edge-worker@production.deploy-worker
```

GitHub Actions:
```yaml
- name: Run pipeline
  env:
    ORUN_BACKEND_URL: ${{ vars.ORUN_BACKEND_URL }}
    ORUN_REMOTE_STATE: "true"
  run: orun run 0b673779a274 --job ${{ matrix.job }}
```

---

## Specs

Implementation specs for each component are in `spec/`:

| File | Contents |
|------|---------|
| `spec/00-constitution.md` | Architectural principles — non-negotiables |
| `spec/01-monorepo-structure.md` | Repo layout, tooling, conventions |
| `spec/02-devops.md` | orun/kiox CI/CD model |
| `spec/03-types-package.md` | `@orun/types` shared types |
| `spec/04-worker-api.md` | Worker API endpoints and contracts |
| `spec/05-coordinator-do.md` | RunCoordinator Durable Object |
| `spec/06-auth.md` | OIDC + OAuth auth system |
| `spec/07-storage.md` | R2 + D1 utilities and schema |
| `spec/08-account-repo-linking.md` | Account model and repo linking |
| `spec/09-cli-integration.md` | `orun --remote-state` client integration |
| `spec/10-rate-limiting.md` | Rate limiting |
| `spec/11-dashboard-ui.md` | Dashboard UI and browser OAuth flow |
| `SCHEDULE.md` | Development schedule and delegation order |

---

## Contributing / Delegation

See `SCHEDULE.md` for the implementation order and how to delegate tasks to coding agents. Each spec file is self-contained for a single agent delegation.

**Start with**: `SCHEDULE.md` → Task 01 (scaffolding) → Task 02 (types) → Tasks 03/04/05 in parallel.
