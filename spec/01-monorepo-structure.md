# Spec 01 — Monorepo Structure

## Scope

This spec defines the repository layout, package boundaries, tooling, and shared conventions for the `orun-backend` monorepo. All coding agents must produce code that fits within this structure.

---

## Repository Layout

```
orun-backend/
├── packages/
│   ├── types/                  # Shared TypeScript interfaces & enums
│   ├── worker/                 # Cloudflare Worker: API gateway + auth + routing
│   ├── coordinator/            # Durable Object: RunCoordinator class
│   ├── storage/                # R2 + D1 access utilities (shared helpers)
│   └── client/                 # Auto-generated or hand-written HTTP client SDK
├── migrations/
│   └── *.sql                   # D1 migrations (numbered, immutable)
├── scripts/
│   ├── deploy.sh               # Wrangler deploy for prod
│   └── dev.sh                  # Local dev with wrangler dev
├── spec/                       # This folder — implementation specs
├── .github/
│   └── workflows/
│       └── workflow.yml        # orun-based CI/CD (see spec/10-devops.md)
├── component.yaml              # orun component manifest (cloudflare-worker)
├── intent.yaml                 # orun intent: composition sources + environments
├── kiox.yaml                   # Pins the orun runtime version
├── wrangler.jsonc              # Worker + DO + R2 + D1 binding config
├── package.json                # Root workspace config
├── tsconfig.base.json          # Shared TypeScript config
└── README.md
```

---

## Package Descriptions

### `packages/types`

**Purpose**: Single source of truth for all shared data structures, enums, and API request/response types. No runtime code — type-only exports.

**Key exports**:
- `RunStatus`, `JobStatus` enums
- `Run`, `Job`, `LogRef` interfaces
- `ClaimRequest`, `ClaimResult`, `UpdateRequest` (API payloads)
- `OIDCClaims`, `SessionClaims` (auth types)
- `Namespace` (holds `namespaceId` + `namespaceSlug`)
- `ApiError` response shape

**Rules**:
- Zero runtime dependencies
- No circular imports from other packages
- All other packages import types from here

### `packages/worker`

**Purpose**: The Cloudflare Worker entrypoint. Handles HTTP routing, authentication, rate limiting, and delegates to DO/R2/D1. Thin API gateway — no business logic.

**Depends on**: `@orun/types`, `@orun/coordinator` (DO class binding), `@orun/storage`

**Exports**: A single default `fetch` handler and `scheduled` handler for Cloudflare Workers.

### `packages/coordinator`

**Purpose**: The `RunCoordinator` Durable Object class. Implements atomic job coordination: claim, update, dependency checking, heartbeat.

**Depends on**: `@orun/types`

**Rules**:
- Must be exported as a named class (`RunCoordinator`) for `wrangler.jsonc` binding` binding
- Contains no HTTP routing logic — just DO methods exposed via `fetch`
- All state mutations are synchronous within the DO's single-threaded context

### `packages/storage`

**Purpose**: Utility functions for R2 and D1 access patterns. Provides typed wrappers around raw Cloudflare bindings.

**Depends on**: `@orun/types`

**Key exports**:
- `R2Storage`: methods for reading/writing logs and plans
- `D1Index`: methods for writing/querying the dashboard index
- Path utilities: `runLogPath(namespaceId, runId, jobId)`, etc.

### `packages/client`

**Purpose**: TypeScript HTTP client for the orun-backend API. Used by the CLI (Go) or browser apps. Documents the exact request/response contract.

**Note**: This package defines the client-side contract. The Go CLI may implement its own HTTP client using this as documentation, or call this via a small Node.js shim. Coding agents should implement this as a clean TypeScript client.

**Depends on**: `@orun/types`

---

## Tooling Conventions

### TypeScript

- `tsconfig.base.json` at root sets strict mode, target `ES2022`, module `NodeNext`
- Each package extends the base config
- No `any` types — use `unknown` and narrow appropriately

### Package Manager

- npm workspaces (no additional tools like Turborepo required, but compatible)
- Each package has its own `package.json` with `name: "@orun/<name>"`

### Testing

- Unit tests: `vitest`
- Worker/DO integration tests: `vitest` + `@cloudflare/vitest-pool-workers` (Miniflare)
- Test files co-located: `src/**/*.test.ts`

### Linting

- `eslint` with `@typescript-eslint/recommended`
- Enforce no-unused-vars, no-explicit-any, consistent-return

### Build

- Each package builds independently with `tsc` or `wrangler` (for Worker)
- `wrangler build` produces the deployable Worker bundle

---

## Wrangler Configuration (`wrangler.jsonc`)

The root `wrangler.jsonc` configures all bindings. Coding agents must not hardcode binding names — use the following names exactly:

```jsonc
{
  "name": "orun-api",
  "main": "packages/worker/src/index.ts",
  "compatibility_date": "2024-01-01",
  "durable_objects": {
    "bindings": [
      {
        "name": "COORDINATOR",
        "class_name": "RunCoordinator",
        "script_name": "orun-api"
      }
    ]
  },
  "r2_buckets": [
    {
      "binding": "STORAGE",
      "bucket_name": "orun-storage"
    }
  ],
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "orun-db",
      "database_id": "PLACEHOLDER"
    }
  ],
  "vars": {
    "GITHUB_JWKS_URL": "https://token.actions.githubusercontent.com/.well-known/jwks",
    "GITHUB_OIDC_AUDIENCE": "orun"
  }
}
```

Binding names used throughout code: `COORDINATOR`, `STORAGE`, `DB`.

---

## Environment Interface

All Workers and DOs receive an `Env` object. The interface is defined in `packages/types`:

```typescript
interface Env {
  COORDINATOR: DurableObjectNamespace;
  STORAGE: R2Bucket;
  DB: D1Database;
  GITHUB_JWKS_URL: string;
  GITHUB_OIDC_AUDIENCE: string;
  ORUN_DEPLOY_TOKEN?: string;   // set as secret, not var
}
```

---

## Namespace Convention

All npm packages use the `@orun/` scope. Import paths:

```typescript
import type { Run, Job } from "@orun/types";
import { R2Storage }    from "@orun/storage";
import { RunCoordinator } from "@orun/coordinator";
```

---

## Deployment Environments

| Environment | Purpose | Worker Name |
|------------|---------|-------------|
| `dev` | Local development (wrangler dev) | n/a |
| `staging` | Pre-production testing | `orun-api-staging` |
| `production` | Live system | `orun-api` |

Environments are selected via `wrangler.jsonc` `[env.*]` stanzas.
