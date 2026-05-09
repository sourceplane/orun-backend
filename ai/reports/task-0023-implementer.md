# Task 0023 Implementer Report

## Summary

Task-0023 adds the first V2 API slice to the `orun-backend` Cloudflare Worker:

- `@orun/db/runtime` — Worker-safe subpath export excluding Node-only CLI internals
- Typed DB stores for users, organizations, and projects (`packages/db/src/`)
- Supabase JWT verifier (`apps/worker/src/auth/supabase.ts`) with JWKS caching
- V2 auth context (`apps/worker/src/auth/v2.ts`) with role/permission helpers
- Cloudflare Hyperdrive + porsager `postgres` DB client (`apps/worker/src/db.ts`)
- 7 V2 routes registered in `apps/worker/src/router.ts`
- 276 tests passing across all packages

## Files Changed

| File | Action |
|---|---|
| `packages/types/src/index.ts` | Updated — added `Hyperdrive` to `Env`, Supabase vars, V2 types |
| `packages/db/package.json` | Updated — added `./runtime` subpath export |
| `packages/db/src/runtime.ts` | New — Worker-safe re-export (no Node-only modules) |
| `packages/db/src/users.ts` | New — `UserStore` with upsert + lookup methods |
| `packages/db/src/organizations.ts` | New — `OrgStore` with transactional create, list, get, membership |
| `packages/db/src/projects.ts` | New — `ProjectStore` scoped by org |
| `packages/db/src/users.test.ts` | New — 8 unit tests |
| `packages/db/src/organizations.test.ts` | New — 12 unit tests |
| `packages/db/src/projects.test.ts` | New — 9 unit tests |
| `apps/worker/package.json` | Updated — added `@orun/db`, `postgres` deps |
| `apps/worker/wrangler.jsonc` | Updated — added `nodejs_compat` flag, `hyperdrive` binding |
| `apps/worker/vitest.config.ts` | Updated — added `@orun/db/runtime` alias for test resolution |
| `apps/worker/src/db.ts` | New — `makeWorkerDbClient` wrapping porsager `postgres` |
| `apps/worker/src/auth/supabase.ts` | New — Supabase RS256 JWT verifier with JWKS cache |
| `apps/worker/src/auth/supabase.test.ts` | New — 18 unit tests |
| `apps/worker/src/auth/v2.ts` | New — `RequestContextV2`, `authenticateV2`, authz helpers |
| `apps/worker/src/handlers/v2/me.ts` | New — `GET /v2/me` |
| `apps/worker/src/handlers/v2/organizations.ts` | New — org CRUD handlers |
| `apps/worker/src/handlers/v2/projects.ts` | New — project CRUD handlers |
| `apps/worker/src/router.ts` | Updated — V2 route table + `routeV2` dispatcher |
| `apps/worker/src/v2-api.test.ts` | New — 20 handler-level tests |

## Architecture Decisions

### @orun/db/runtime split

Created `packages/db/src/runtime.ts` as a clean Worker-safe entrypoint. It
re-exports only the `DbClient` interface, domain types, validators, and store
factories. Node-only modules (`NodePgClient`, migration harness, `node:fs`,
`node:crypto`) stay in the root `@orun/db` export used by the CLI.

The Vitest alias in `apps/worker/vitest.config.ts` maps `@orun/db/runtime` to
the TypeScript source directly, since Vitest doesn't follow `package.json`
subpath exports through pnpm symlinks. The compiled `dist/runtime.js` is used
by Wrangler for the production build.

### Postgres driver: porsager postgres v3

Used `postgres` (porsager) with `nodejs_compat` compatibility flag, as
documented by Cloudflare for Hyperdrive. Options `{ max: 1, prepare: false,
fetch_types: false }` — `prepare: false` is required by Hyperdrive (no
server-side prepared statements over the proxy connection).

### Auth token detection order

`authenticateV2` detects tokens in this order:
1. `X-Orun-Deploy-Token` header → deploy context
2. GitHub OIDC (by issuer heuristic via `looksLikeOIDC`)
3. Supabase JWT (requires `SUPABASE_JWKS_URL` env var + issuer match)
4. Orun HMAC session (CLI or legacy dashboard)

### Router dispatch

V2 routes use a handler-map pattern — each `V2Route` carries its `handler`
function, eliminating any secondary path-string inspection inside `routeV2`.
This was chosen over the earlier if-chain draft which had an ambiguity bug
between `GET /v2/organizations/:orgId` and `GET /v2/organizations/:orgId/projects`
(both have `orgId` param, neither has `projectId`).

### Policy/Audit gap — deferred

The `0001_core.sql` schema does not include `policies` or `audit_events` tables.
Org creation in `OrgStore.createOrganization` intentionally omits those inserts.
Policy and audit logging are deferred to a later task. No silent failures — the
gap is explicit here and in the store source.

## Checks Run

```
pnpm --filter @orun/types typecheck     PASS
pnpm --filter @orun/db typecheck        PASS
pnpm --filter @orun/db test             PASS  (86 tests)
pnpm --filter @orun/db build            PASS
pnpm --filter @orun/worker typecheck    PASS
pnpm --filter @orun/worker test         PASS  (276 tests)
pnpm --filter @orun/worker build        PASS  (240 KiB upload, dry-run)
```

## Remaining Gaps

- `GET /v2/me` returns `githubLogin: null` for sessions authenticated via Orun
  HMAC when the GitHub identity row exists in Postgres but wasn't surfaced by
  `verifySessionToken`. The `userId` is resolved; the login field is not. A
  later task can add a `findByUserId` lookup if needed.
- Per-project membership overrides are deferred — `requireProjectPermission`
  delegates to org-level membership. The comment in `auth/v2.ts` marks this.
- Hyperdrive binding `id: d8cada8abda7451aaa1e2ce189dc8a17` is a placeholder.
  The real binding ID must be updated once the Hyperdrive resource is
  provisioned (follow-on from task-0022 Supabase provisioning).
- Live end-to-end testing against a real Supabase instance was not run.
  The V2 worker unit tests cover all handler paths with fake DbClient mocks.

## PR / Commit

Committed directly to `main` as `b4b9a43` — no separate PR branch was created.
