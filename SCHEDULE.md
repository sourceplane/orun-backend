# orun-backend — Development Schedule & Delegation Guide

## Overview

This document defines the order in which implementation work should be delegated to coding agents, the dependencies between tasks, and what each agent needs to know before starting.

The critical design insight driving this order: **build the cloud control plane first, then the CLI client**. The hardest problem is distributed coordination, not CLI UX. Solve it first, validate with curl, then build the CLI on top.

---

## Dependency Graph

```
[01] Monorepo Scaffolding
        │
        ▼
[02] @orun/types package
        │
        ├──────────────────┬──────────────────┐
        ▼                  ▼                  ▼
[03] @orun/coordinator  [04] @orun/storage  [05] Auth (Worker module)
        │                  │                  │
        └──────────────────┴──────────────────┘
                           │
                           ▼
                   [06] Worker API
                           │
               ┌───────────┴───────────┐
               ▼                       ▼
    [07] Account/Repo Linking   [08] orun Remote State Client
               │
               ▼
     [09] Dashboard UI (future)
```

Tasks [03], [04], [05] are independent and can be delegated in parallel after [02] completes.

---

## Phase 1 — Core Control Plane

**Goal**: A working backend that can be tested with curl. No CLI changes yet.

> **DevOps model**: This project uses orun + stack-tectonic for CI/CD. See `spec/02-devops.md` for `kiox.yaml`, `intent.yaml`, `component.yaml`, and the GitHub Actions workflow. Task 01 includes scaffolding these files alongside the monorepo structure.

### Task 01 — Monorepo Scaffolding

**Delegate to**: 1 agent  
**Input spec**: `spec/01-monorepo-structure.md`  
**Deliverables**:
- Directory structure: `apps/worker`, `packages/types`, `packages/coordinator`, `packages/storage`, `packages/client`
- `pnpm-workspace.yaml` declaring `apps/*` and `packages/*`
- `turbo.json` with `build`, `typecheck`, `deploy` tasks
- `tsconfig.base.json`
- `apps/worker/wrangler.jsonc` with correct binding names
- `package.json` for each package (scope `@orun/<name>`)
- Vitest config for each package
- Empty `migrations/` directory with `README`
- `.github/workflows/workflow.yml` stub (see `spec/02-devops.md`)
- Root `intent.yaml` (stack-tectonic OCI source, discovery roots, environments) and `kiox.yaml` (orun runtime pin) — see `spec/01-monorepo-structure.md`
- `component.yaml` per deliverable unit: `apps/worker/component.yaml` (`cloudflare-worker-turbo`) and one per `packages/*` (`turbo-package`) — see `spec/01-monorepo-structure.md`

**Notes for agent**: Do not implement any logic. Create the structure, package configs, tsconfig files, and placeholder `index.ts` exports. The goal is a repo that compiles cleanly.

**Validation**: `pnpm install && pnpm exec turbo run typecheck` completes without error.

---

### Task 02 — `@orun/types` Package

**Delegate to**: 1 agent  
**Input spec**: `spec/03-types-package.md`  
**Depends on**: Task 01  
**Deliverables**:
- `packages/types/src/index.ts` — all type exports
- `packages/types/src/paths.ts` — path utility functions
- Type-only (zero runtime dependencies)

**Validation**: All other packages can import types without errors. No runtime code.

---

### Task 03 — `RunCoordinator` Durable Object

**Delegate to**: 1 agent  
**Input spec**: `spec/05-coordinator-do.md`, `spec/03-types-package.md`  
**Depends on**: Task 02  
**Deliverables**:
- `packages/coordinator/src/coordinator.ts` — `RunCoordinator` class
- Full implementation of `/init`, `/jobs/:jobId/claim`, `/jobs/:jobId/update`, `/jobs/:jobId/heartbeat`, `/jobs/:jobId/status`, `/runnable`, `/state`, `/cancel`
- DO alarm for GC
- Tests in `packages/coordinator/src/coordinator.test.ts`

**Validation**: All test cases from spec pass, including concurrent claim scenarios.

---

### Task 04 — `@orun/storage` Package

**Delegate to**: 1 agent  
**Input spec**: `spec/07-storage.md`, `spec/03-types-package.md`  
**Depends on**: Task 02  
**Deliverables**:
- `packages/storage/src/r2.ts` — `R2Storage` class
- `packages/storage/src/d1.ts` — `D1Index` class
- `migrations/0001_init.sql` — initial D1 schema
- `migrations/0002_namespaces_account.sql` — account/repo tables
- Tests for both classes

**Validation**: R2Storage and D1Index unit tests pass. Path utilities produce correct strings.

---

### Task 05 — Auth Module

**Delegate to**: 1 agent  
**Input spec**: `spec/06-auth.md`, `spec/03-types-package.md`  
**Depends on**: Task 02  
**Deliverables**:
- `apps/worker/src/auth/oidc.ts` — OIDC verification
- `apps/worker/src/auth/session.ts` — session JWT issue/verify
- `apps/worker/src/auth/github-oauth.ts` — OAuth flow helpers
- `apps/worker/src/auth/index.ts` — `authenticate()` main function
- Tests for each module

**Notes for agent**: Use the Web Crypto API (`crypto.subtle`) for JWT verification — no external libraries. The GitHub JWKS endpoint must be fetched with in-memory caching.

**Validation**: Unit tests pass with mocked GitHub JWKS responses.

---

### Task 06 — Worker API

**Delegate to**: 1 agent  
**Input spec**: `spec/04-worker-api.md`, all prior specs  
**Depends on**: Tasks 03, 04, 05  
**Deliverables**:
- `apps/worker/src/index.ts` — main Worker entrypoint with routing
- Handler files for each endpoint group
- Rate limiting module (`spec/10-rate-limiting.md`)
- Scheduled Worker handler
- Integration tests with Miniflare

**Notes for agent**: This is the integration layer. Keep handlers thin — delegate to DO, R2Storage, D1Index. No business logic in handlers.

**Validation**:
1. `wrangler dev` starts without error
2. `curl -X POST .../v1/runs` with a valid OIDC-style JWT returns `201`
3. End-to-end flow (create run → claim job → update → fetch logs) works via curl

---

## Phase 2 — Account Layer & CLI Integration

### Task 07 — Account & Repo Linking

**Delegate to**: 1 agent  
**Input spec**: `spec/08-account-repo-linking.md`  
**Depends on**: Task 06  
**Deliverables**:
- `POST /v1/accounts`, `GET /v1/accounts/me`
- `POST /v1/accounts/repos`, `GET /v1/accounts/repos`, `DELETE /v1/accounts/repos/:namespaceId`
- GitHub API calls for admin verification
- Tests for permission checks

---

### Task 08 — orun Remote State Client Integration (Go)

**Delegate to**: 1 agent  
**Input spec**: `spec/09-cli-integration.md`  
**Depends on**: Task 06 (backend must be deployed or mockable)  
**Deliverables**:
- Work in the cloned `sourceplane/orun` repository for CLI changes.
- `internal/statebackend` or equivalent package defining a `StateBackend` interface.
- `FileStateBackend` that wraps existing `.orun/executions/{execID}` behavior and preserves `orun status`, `orun logs`, resume, and retry compatibility.
- `RemoteStateBackend` and HTTP client for orun-backend, including OIDC token fetching in GitHub Actions.
- `cmd/orun/command_run.go` modification — add `--remote-state` and `--backend-url` without breaking existing `orun run [component|planhash]` behavior.
- `cmd/orun/command_status.go` and `cmd/orun/command_logs.go` remote-state support.
- `intent.yaml` schema/model support for `execution.state.mode: remote` and optional `execution.state.backendUrl`.
- Stable run/job runtime IDs that include the plan ID and expose `ORUN_PLAN_ID`, `ORUN_EXEC_ID`, `ORUN_JOB_ID`, and `ORUN_JOB_RUN_ID` to steps.
- Remote-state conformance examples in `sourceplane/orun`: `examples/remote-state-matrix/`, `examples/github-actions/remote-state-matrix.yml`, optional gated `.github/workflows/remote-state-conformance.yml`, and website docs.
- GitHub Actions matrix proof covering one compiled plan, one-job-per-runner fan-out, duplicate claim handling, dependency waits, environment fan-out, and final `orun status`/`orun logs` verification.
- Backend changes in `sourceplane/orun-backend` if needed: deterministic `CreateRunRequest.runId`, idempotent create/join, runner-owned updates, and run/job read endpoints.
- Unit and integration tests in both repos as applicable.

**Notes for agent**: The Go CLI must remain fully backward-compatible. `orun run` without `--remote-state` must work identically to before. The old `--remote` contract is not the target; use `--remote-state`.

---

## Phase 3 — Dashboard & Bootstrap (Future)

### Task 09 — Dashboard UI

Build a React/Next.js or equivalent web UI served from Cloudflare Pages:
- Component list with job status
- Run history per component
- Log viewer (stream from R2)
- GitHub OAuth login

### Task 10 — CLI Bootstrap (`orun backend init`)

Implement auto-provisioning of Cloudflare resources from the CLI:
- Cloudflare REST API client in Go
- Create Worker, D1, R2 via API
- Embed Worker JS bundle via `//go:embed`
- `orun backend init`, `orun backend status`, `orun backend destroy`

---

## Validation Checklist Before Each Phase Handoff

### Phase 1 complete when:

- [ ] `pnpm exec turbo run typecheck` passes across all packages
- [ ] `pnpm exec turbo run test` passes across all packages
- [ ] `wrangler dev` starts from `apps/worker`
- [ ] Manual curl test flow works (see Task 06 notes)
- [ ] Two concurrent runners can claim different jobs in the same run without conflict
- [ ] Heartbeat timeout causes job takeover correctly
- [ ] `kiox -- orun plan` compiles without error (orun DevOps smoke test)

### Phase 2 complete when:

- [ ] `orun run <plan-id> --remote-state --job <job-id>` succeeds in a GitHub Actions test workflow
- [ ] Multiple GitHub Actions jobs in a matrix run coordinate correctly against the same plan/run ID
- [ ] `orun run <plan-id> --env dev --remote-state` and `orun run <plan-id> --env stage --remote-state` can run separately and wait for dependencies
- [ ] A copyable GitHub Actions matrix example exists and proves fan-out/fan-in remote-state behavior after CLI integration
- [ ] The conformance workflow includes at least one duplicate job target to prove idempotent claim or already-complete handling
- [ ] `orun status --remote-state --exec-id <run-id>` shows correct run state
- [ ] `orun logs --remote-state --exec-id <run-id> --job <job-id>` shows logs

---

## Cloudflare Resources Needed

The implementer needs access to a Cloudflare account with:
- Workers Paid plan (for Durable Objects)
- R2 enabled
- D1 enabled

For development: `wrangler dev` runs everything locally with Miniflare (no account needed).

For deployment: A Cloudflare API token with permissions:
- `Workers Scripts:Edit`
- `Durable Objects:Edit`
- `D1:Edit`
- `R2:Edit`

---

## Common Mistakes to Avoid

1. **Using DO for logs** — Logs go to R2 only. DO stores only job statuses and run metadata.
2. **Using D1 as source of truth** — D1 lags behind DO. Never make execution decisions based on D1.
3. **Using `org/repo` as namespace key** — Use `repository_id` (numeric string). Names change.
4. **Switching storage paths when account is linked** — Always write under `namespace_id`. Never under `account_id`.
5. **Tight polling loops** — Use exponential backoff with jitter. Never poll faster than 2s minimum.
6. **One global DO** — One DO per run, always. Global DOs become bottlenecks.
