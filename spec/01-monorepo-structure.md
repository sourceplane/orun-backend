# Spec 01 — Monorepo Structure

## Scope

This spec defines the repository layout, package boundaries, tooling, and shared conventions for the `orun-backend` monorepo. All coding agents must produce code that fits within this structure.

---

## Repository Layout

```
orun-backend/
├── apps/
│   └── worker/                 # Cloudflare Worker: API gateway + auth + routing + DO binding
├── packages/
│   ├── types/                  # Shared TypeScript interfaces & enums
│   ├── coordinator/            # Durable Object: RunCoordinator class
│   ├── storage/                # R2 + D1 access utilities (shared helpers)
│   └── client/                 # Auto-generated or hand-written HTTP client SDK
├── migrations/
│   └── *.sql                   # D1 migrations (numbered, immutable)
├── spec/                       # This folder — implementation specs
├── .github/
│   └── workflows/
│       └── workflow.yml        # orun-based CI/CD (see spec/10-devops.md)
├── intent.yaml                 # Composition sources, discovery roots, and environments
├── kiox.yaml                   # Pins the orun runtime version
├── pnpm-workspace.yaml         # pnpm workspace declaration
├── turbo.json                  # Turborepo task pipeline
├── tsconfig.base.json          # Shared TypeScript config
└── README.md
```

Each deployable unit (anything with a `wrangler.jsonc`) and each shared package that participates in tectonic stack delivery **must** have a `component.yaml` at its root.

---

## Package Descriptions

### `apps/worker`

**Purpose**: The Cloudflare Worker entrypoint. Handles HTTP routing, authentication, rate limiting, and delegates to DO/R2/D1. Thin API gateway — no business logic. Binds and exports the `RunCoordinator` Durable Object.

**Depends on**: `@orun/types`, `@orun/coordinator` (DO class binding), `@orun/storage`

**Exports**: A single default `fetch` handler and `scheduled` handler for Cloudflare Workers.

**Tectonic component type**: `cloudflare-worker-turbo`

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

**Tectonic component type**: `turbo-package`

### `packages/coordinator`

**Purpose**: The `RunCoordinator` Durable Object class. Implements atomic job coordination: claim, update, dependency checking, heartbeat.

**Depends on**: `@orun/types`

**Rules**:
- Must be exported as a named class (`RunCoordinator`) for `wrangler.jsonc` binding
- Contains no HTTP routing logic — just DO methods exposed via `fetch`
- All state mutations are synchronous within the DO's single-threaded context

**Tectonic component type**: `turbo-package`

### `packages/storage`

**Purpose**: Utility functions for R2 and D1 access patterns. Provides typed wrappers around raw Cloudflare bindings.

**Depends on**: `@orun/types`

**Key exports**:
- `R2Storage`: methods for reading/writing logs and plans
- `D1Index`: methods for writing/querying the dashboard index
- Path utilities: `runLogPath(namespaceId, runId, jobId)`, etc.

**Tectonic component type**: `turbo-package`

### `packages/client`

**Purpose**: TypeScript HTTP client for the orun-backend API. Used by the CLI (Go) or browser apps. Documents the exact request/response contract.

**Note**: This package defines the client-side contract. The Go CLI may implement its own HTTP client using this as documentation, or call this via a small Node.js shim. Coding agents should implement this as a clean TypeScript client.

**Depends on**: `@orun/types`

**Tectonic component type**: `turbo-package`

---

## Tectonic Stack Integration

orun-backend uses the [tectonic stack](https://github.com/sourceplane/stack-tectonic) for all CI/CD delivery. The tectonic stack is consumed as an OCI catalog — it is never vendored locally.

### `intent.yaml`

The root `intent.yaml` declares composition sources (tectonic stack), discovery roots, and environment definitions:

```yaml
apiVersion: sourceplane.io/v1
kind: Intent

metadata:
  name: orun-backend
  description: Cloud control plane for the orun CLI

compositions:
  sources:
    - name: stack-tectonic
      kind: oci
      ref: oci://ghcr.io/sourceplane/stack-tectonic:0.11.0

discovery:
  roots:
    - apps/
    - packages/

environments:
  dev:
    defaults:
      lane: dry-run
      namespacePrefix: dev-
    policies:
      requireApproval: "false"

  staging:
    defaults:
      lane: verify
      namespacePrefix: stg-
    policies:
      requireApproval: "true"

  production:
    defaults:
      lane: release
      namespacePrefix: prod-
    policies:
      requireApproval: "true"
```

Bump `ref` in lock-step with `kiox.yaml` when upgrading.

### `kiox.yaml`

Pins the orun runtime version:

```yaml
apiVersion: kiox.io/v1
kind: Workspace
metadata:
  name: orun-backend
providers:
  orun:
    source: ghcr.io/sourceplane/orun:v0.9.6
```

### `component.yaml` per deliverable unit

Every package that participates in tectonic delivery declares a `component.yaml`. The `spec.type` field must match a composition exported by the tectonic stack.

**`apps/worker/component.yaml`** — Cloudflare Worker delivery:

```yaml
apiVersion: sourceplane.io/v1
kind: Component

metadata:
  name: orun-api-worker

spec:
  type: cloudflare-worker-turbo
  domain: orun-backend
  subscribe:
    environments:
      - dev
      - staging
      - production
  inputs:
    nodeVersion: "20"
    pnpmVersion: "10.12.1"
    productionBranch: main
  labels:
    team: platform
    layer: runtime
    surface: api
    runtime: cloudflare
```

**`packages/types/component.yaml`** — shared type package:

```yaml
apiVersion: sourceplane.io/v1
kind: Component

metadata:
  name: orun-types

spec:
  type: turbo-package
  domain: orun-backend
  subscribe:
    environments:
      - dev
      - staging
      - production
  inputs:
    nodeVersion: "20"
    pnpmVersion: "10.12.1"
  labels:
    team: platform
    layer: shared
    surface: types
    runtime: node
```

All other `packages/*` follow the same pattern with `type: turbo-package`.

---

## Tooling Conventions

### TypeScript

- `tsconfig.base.json` at root sets strict mode, target `ES2022`, module `NodeNext`
- Each package extends the base config
- No `any` types — use `unknown` and narrow appropriately

### Package Manager

- **pnpm workspaces** — declared in `pnpm-workspace.yaml`:

  ```yaml
  packages:
    - apps/*
    - packages/*
  ```

- Each package has its own `package.json` with `name: "@orun/<name>"`
- Lock file: `pnpm-lock.yaml` (committed)

### Build Orchestration

- **Turborepo** — task pipeline defined in `turbo.json`:

  ```json
  {
    "$schema": "https://turborepo.com/schema.json",
    "tasks": {
      "build": {
        "dependsOn": ["^build"],
        "outputs": ["dist/**", ".wrangler/**"]
      },
      "typecheck": {
        "dependsOn": ["^typecheck"],
        "outputs": []
      },
      "deploy": {
        "dependsOn": ["build"],
        "cache": false,
        "outputs": []
      }
    }
  }
  ```

- Use `pnpm exec turbo run build --filter=./` per-package, or `turbo run build` from the workspace root.

### Testing

- Unit tests: `vitest`
- Worker/DO integration tests: `vitest` + `@cloudflare/vitest-pool-workers` (Miniflare)
- Test files co-located: `src/**/*.test.ts`

### Linting

- `eslint` with `@typescript-eslint/recommended`
- Enforce no-unused-vars, no-explicit-any, consistent-return

### Build

- `apps/worker` builds via `wrangler build` (produces deployable Worker bundle)
- All other packages build with `tsc`
- Turbo orchestrates dependency order

---

## Wrangler Configuration (`apps/worker/wrangler.jsonc`)

The Worker's `wrangler.jsonc` lives inside `apps/worker/`. Coding agents must not hardcode binding names — use the following names exactly:

```jsonc
{
  "name": "orun-api",
  "main": "src/index.ts",
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

Environments are defined in `intent.yaml` and mapped to wrangler `[env.*]` stanzas:

| Environment | Tectonic Lane | Purpose |
|------------|--------------|---------|
| `dev` | `dry-run` | Local development (wrangler dev / dry-run deploy) |
| `staging` | `verify` | Pre-production testing, requires approval |
| `production` | `release` | Live system, requires approval, deploys only from `main` |
