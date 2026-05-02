# Spec 02 — orun-based DevOps

## Scope

This spec defines how orun-backend uses the orun toolchain and the [stack-tectonic](https://github.com/sourceplane/stack-tectonic) composition catalog for its own CI/CD pipeline. It is placed immediately after the monorepo structure spec because tectonic stack files (`intent.yaml`, `kiox.yaml`, `component.yaml`) are required scaffolding — agents building the repo must produce them in Task 01, not as a late addition.

---

## Overview

orun-backend adopts the orun DevOps model end-to-end:

- `kiox.yaml` pins the orun runtime version used for local and CI execution
- `intent.yaml` declares the stack-tectonic OCI catalog as the composition source and configures environments and discovery roots
- Each deliverable unit declares a `component.yaml` with the appropriate composition type
- `.github/workflows/workflow.yml` uses `kiox-action` to initialize the orun workspace and run plan/execute

The repo uses the `cloudflare-worker-turbo` composition for the Worker — the turbo variant is required because orun-backend is a pnpm + Turborepo monorepo.

---

## Required Files

### `kiox.yaml`

Pins the orun runtime. Located at the repo root.

```yaml
apiVersion: kiox.io/v1
kind: Workspace
metadata:
  name: orun-backend
providers:
  orun:
    source: ghcr.io/sourceplane/orun:v1.11.0
```

Update the `source` tag when upgrading the orun runtime and regenerate/commit `kiox.lock` in the same change. As of the current repo state, `kiox.yaml` and `kiox.lock` are both pinned to `ghcr.io/sourceplane/orun:v1.11.0`.

---

### `intent.yaml`

Declares the stack-tectonic OCI catalog, discovery roots, and environment policies. Located at the repo root.

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

Pin the `oci://...` ref to a specific stack-tectonic release. Bump it in lock-step with any composition changes.

---

### `component.yaml` per deliverable unit

Every `apps/*` and `packages/*` directory that participates in tectonic delivery declares its own `component.yaml`. There is **no root-level `component.yaml`** — discovery roots point orun at `apps/` and `packages/`.

**`apps/worker/component.yaml`** — the Cloudflare Worker:

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

**`packages/types/component.yaml`** — shared types package (representative; other packages follow the same pattern):

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

All `packages/coordinator`, `packages/storage`, and `packages/client` follow the same `turbo-package` pattern.

---

### `.github/workflows/workflow.yml`

The GitHub Actions CI/CD workflow. Uses `kiox-action` to initialize the orun workspace, then runs `orun plan` and `orun run`.

```yaml
name: CI/CD

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read
  id-token: write  # required for GitHub OIDC token (orun remote coordination)

jobs:
  review-plan:
    name: Review Plan
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Initialize orun workspace
        uses: sourceplane/kiox-action@v2.1.2
        with:
          version: v0.4.3

      - name: Compile review-scoped plan
        run: kiox -- orun plan --changed

  build-deploy:
    name: Build & Deploy
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Initialize orun workspace
        uses: sourceplane/kiox-action@v2.1.2
        with:
          version: v0.4.3

      - name: Execute
        env:
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
        run: kiox -- orun run --changed
```

The `review-plan` job runs only on pull requests and compiles the changed-component plan without executing it. The `build-deploy` job runs on both PRs and pushes to `main`; `orun run` executes by default, so there is no `--execute` flag. GitHub Actions mode is auto-detected by `orun` in CI, so the workflow does not need an explicit `--gha` flag.

Both checkout steps use `fetch-depth: 0` so `orun --changed` has enough git history to resolve the base/head diff. The workflow pins `kiox-action`'s `version` input to `v0.4.3` so CI does not depend on resolving the latest kiox release at runtime. CI logs must be inspected during verification to confirm `kiox -- orun plan --changed` and `kiox -- orun run --changed` actually ran.

---

## How the `cloudflare-worker-turbo` Composition Works

The `cloudflare-worker-turbo` composition from stack-tectonic provides these steps:

| Step | Action |
|------|--------|
| `setup-node` | Installs Node.js at `inputs.nodeVersion` |
| `setup-pnpm` | Installs pnpm at `inputs.pnpmVersion` via `pnpm/action-setup` |
| `install-workspace-dependencies` | Runs `pnpm install --no-frozen-lockfile` from the workspace root |
| `verify-worker-structure` | Asserts `package.json` and `wrangler.jsonc` are present in the component directory |
| `build-worker` | Runs `pnpm exec turbo run build --filter=./` (or `inputs.buildCommand` if overridden) |
| `typecheck-worker` | Runs `pnpm exec turbo run typecheck --filter=./` (or `inputs.typecheckCommand` if overridden) |
| `deploy-worker` | Skips on non-production / non-`productionBranch`; runs `pnpm run deploy` (or `inputs.deployCommand`) on `main` |

The deploy step enforces:
- `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` must be set as environment variables
- Branch must be `refs/heads/<productionBranch>` and environment must be `production`

For `dev` environment, `pnpm exec wrangler deploy --dry-run` is run instead of a live deploy.

---

## Required GitHub Secrets

| Secret | Description |
|--------|-------------|
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID for Worker deployment |
| `CLOUDFLARE_API_TOKEN` | API token with `Workers Scripts:Edit`, `Durable Objects:Edit`, `D1:Edit`, `R2:Edit` |

For local development, `wrangler dev` (from `apps/worker/`) runs the Worker locally with Miniflare — no Cloudflare account required.

---

## Wrangler Configuration

`wrangler.jsonc` lives inside `apps/worker/` — not at the repo root. The `cloudflare-worker-turbo` composition verifies structure relative to the component directory. Refer to `spec/01-monorepo-structure.md` for the full `wrangler.jsonc` template with all required bindings.

---

## Local Development

```bash
# Install all workspace dependencies
pnpm install

# Start local Worker from apps/worker (Miniflare — no Cloudflare account needed)
cd apps/worker && pnpm run dev

# Type-check all packages via Turbo
pnpm exec turbo run typecheck

# Run all tests via Turbo
pnpm exec turbo run test

# Dry-run deploy (validates bundle without uploading)
cd apps/worker && pnpm exec wrangler deploy --dry-run
```

---

## Contributing Back to stack-tectonic

If orun-backend development requires changes to the `cloudflare-worker-turbo` or `turbo-package` composition, raise a PR against [sourceplane/stack-tectonic](https://github.com/sourceplane/stack-tectonic).

### Workflow

1. Identify the composition — e.g. `compositions/cloudflare-worker-turbo/compositions.yaml`
2. Open a PR against `sourceplane/stack-tectonic` with the change and an updated smoke test
3. Verify all stack-tectonic CI checks pass (`verify.yml`, `docs.yml`, `scorecard.yml`)
4. Merge once all checks are green — CI in stack-tectonic is the gating authority
5. Bump the `oci://ghcr.io/sourceplane/stack-tectonic:<version>` ref in `intent.yaml`

### Policy

PRs against stack-tectonic may be merged by the orun-backend team once all required CI checks pass. No additional review gate is required beyond green CI.

### Known gaps to address

| Gap | Composition | Change needed |
|-----|-------------|---------------|
| Structure check accepts only `wrangler.jsonc`, not `wrangler.toml` | `cloudflare-worker-turbo` | Update `verify-worker-structure` step to accept either file |

---

## Upgrading stack-tectonic Version

1. Check [stack-tectonic releases](https://github.com/sourceplane/stack-tectonic/releases) for the new version
2. Update the `ref` in `intent.yaml`:
   ```yaml
   ref: oci://ghcr.io/sourceplane/stack-tectonic:<new-version>
   ```
3. Run `kiox -- orun plan` locally to validate the updated composition is compatible
4. Open a PR with the version bump
