# Spec 10 — orun-based DevOps

## Scope

This spec defines how orun-backend itself uses the orun toolchain and the [stack-tectonic](https://github.com/sourceplane/stack-tectonic) composition catalog for its own CI/CD pipeline. The orun-backend is deployed as a Cloudflare Worker using the `cloudflare-worker` composition from stack-tectonic.

---

## Overview

orun-backend adopts the orun DevOps model end-to-end:

- `kiox.yaml` pins the orun runtime version used for local and CI execution
- `intent.yaml` declares the stack-tectonic OCI catalog as the composition source and configures environments
- `component.yaml` at the repo root declares this project as a `cloudflare-worker` component
- `.github/workflows/workflow.yml` uses `kiox-action` to initialize the orun workspace and run plan/execute

This means the same toolchain used for end-user projects is used to build and deploy orun-backend itself.

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
    source: ghcr.io/sourceplane/orun:v0.9.6
```

Update the `source` tag when upgrading the orun runtime.

---

### `intent.yaml`

Declares the stack-tectonic OCI catalog as the composition source, component discovery root, and environment policy. Located at the repo root.

```yaml
apiVersion: sourceplane.io/v1
kind: Intent

metadata:
  name: orun-backend
  description: orun-backend Cloudflare Worker — typecheck, build, and deploy

compositions:
  sources:
    - name: stack-tectonic
      kind: oci
      ref: oci://ghcr.io/sourceplane/stack-tectonic:0.11.0

discovery:
  roots:
    - ./

environments:
  development:
    defaults:
      lane: dry-run
      namespacePrefix: dev-
    policies:
      requireApproval: "false"

  production:
    defaults:
      lane: release
      namespacePrefix: prod-
    policies:
      requireApproval: "true"
```

Pin the `oci://...` ref to a specific stack-tectonic release. Bump it when picking up composition updates.

---

### `component.yaml`

Declares orun-backend as a `cloudflare-worker` component. Located at the repo root (the discovery root is `./`).

```yaml
apiVersion: sourceplane.io/v1
kind: Component

metadata:
  name: orun-backend
  description: orun coordination backend — Cloudflare Worker with Durable Objects

spec:
  type: cloudflare-worker
  subscribe:
    environments:
      - production
      - development
  inputs:
    nodeVersion: "20"
    installCommand: npm install
    buildCommand: npm run build
    typecheckCommand: npm run typecheck
    deployCommand: wrangler deploy
    productionBranch: main
```

**Input notes**:
- `installCommand` uses `npm install` (npm workspaces, no pnpm required)
- `buildCommand` runs `wrangler build` via the npm script; adjust if your `package.json` uses a different script name
- `typecheckCommand` is optional but strongly recommended — the composition skips typecheck gracefully if omitted
- `deployCommand` runs `wrangler deploy`; ensure `wrangler.jsonc` is present at the repo root and configured correctly
- `productionBranch` controls which branch triggers the live deploy; only pushes to `main` deploy to Cloudflare

---

### `.github/workflows/workflow.yml`

The GitHub Actions CI/CD workflow. Uses `kiox-action` to initialize the orun workspace, then executes `orun plan` and `orun run`.

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

      - name: Compile review-scoped plan
        run: |
          kiox -- orun plan

  build-deploy:
    name: Build & Deploy
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Initialize orun workspace
        uses: sourceplane/kiox-action@v2.1.2

      - name: Compile full plan
        run: |
          kiox -- orun plan --view dag

      - name: Execute
        env:
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
        run: |
          kiox -- orun run --execute --gha
```

The `review-plan` job runs only on pull requests and compiles the plan without executing it, giving reviewers a dependency-focused view. The `build-deploy` job runs on both PRs and pushes to `main` — the `cloudflare-worker` composition's deploy step automatically skips execution on non-`main` branches.

---

## How the `cloudflare-worker` Composition Works

The `cloudflare-worker` composition from stack-tectonic provides these steps for each job:

| Step | Action |
|------|--------|
| `setup-node` | Installs Node.js at `inputs.nodeVersion` |
| `install-dependencies` | Runs `inputs.installCommand` (`npm install`) |
| `verify-worker-structure` | Asserts `package.json` and `wrangler.jsonc` are present |
| `build-worker` | Runs `inputs.buildCommand` |
| `typecheck-worker` | Runs `inputs.typecheckCommand` if provided; skips otherwise |
| `deploy-worker` | Skips on non-production / non-`productionBranch`; runs `inputs.deployCommand` on `main` |

The deploy step enforces:
- `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` must be set (checked via `:?` expansion)
- Branch must be `refs/heads/<productionBranch>` and environment must be `production`

For `dev` environment, `wrangler deploy --dry-run` is run instead of a live deploy.

---

## Required GitHub Secrets

| Secret | Description |
|--------|-------------|
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID for Worker deployment |
| `CLOUDFLARE_API_TOKEN` | API token with `Workers Scripts:Edit`, `Durable Objects:Edit`, `D1:Edit`, `R2:Edit` |

For local development, `wrangler dev` (via `npm run dev`) runs the Worker locally with Miniflare — no Cloudflare account required.

---

## Wrangler Configuration

Use `wrangler.jsonc` (the modern Cloudflare Worker config format) at the repo root. The `cloudflare-worker` composition's structure-verification step checks for `wrangler.jsonc`. Refer to `spec/01-monorepo-structure.md` for the full `wrangler.jsonc` template with all required bindings.

---

## Contributing Back to stack-tectonic

If developing orun-backend requires changes to the `cloudflare-worker` composition (e.g. supporting new inputs, fixing build patterns, or adding multi-runtime support), raise a PR against [sourceplane/stack-tectonic](https://github.com/sourceplane/stack-tectonic).

### Workflow

1. Identify the composition that needs updating — e.g. `compositions/cloudflare-worker/compositions.yaml`
2. Open a PR against `sourceplane/stack-tectonic` with the change and an updated smoke test if applicable
3. Verify all stack-tectonic CI checks pass (`verify.yml`, `docs.yml`, `scorecard.yml`)
4. Merge the PR once all checks are green — CI in stack-tectonic is the gating authority
5. Cut or wait for the next stack-tectonic release tag
6. Bump the `oci://ghcr.io/sourceplane/stack-tectonic:<version>` ref in `intent.yaml` to consume the change

### Policy: merge after verification passing

PRs against stack-tectonic may be merged by the orun-backend team once all required CI checks pass. No additional review gate is required beyond green CI, consistent with the stack-tectonic release model.

### Known gaps to address

The following stack-tectonic changes have been identified during orun-backend development and should be raised as PRs:

| Gap | Composition | Change needed |
|-----|-------------|---------------|
| Structure check accepts only `wrangler.jsonc`, not `wrangler.toml` | `cloudflare-worker` | Update `verify-worker-structure` step to accept either file |

---

## Local Development

```bash
# Install dependencies
npm install

# Start local Worker (Miniflare — no Cloudflare account needed)
npm run dev

# Type check
npm run typecheck

# Run tests
npm test

# Dry-run deploy (validates bundle without uploading)
wrangler deploy --dry-run
```

---

## Upgrading stack-tectonic Version

To pick up a new stack-tectonic release:

1. Check [stack-tectonic releases](https://github.com/sourceplane/stack-tectonic/releases) for the new version
2. Update the `ref` in `intent.yaml`:
   ```yaml
   ref: oci://ghcr.io/sourceplane/stack-tectonic:<new-version>
   ```
3. Run `kiox -- orun plan` locally to validate the updated composition is compatible
4. Open a PR with the version bump
