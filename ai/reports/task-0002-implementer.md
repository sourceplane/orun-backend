# Task 0002 Implementer Report

## Summary

Implemented the canonical `@orun/types` package from `spec/03-types-package.md`. The package now exports all shared domain types, API request/response payloads, auth types, error types, the `Env` interface, and path utilities. This establishes the shared contract that Tasks 03–06 will import.

## Files Changed

- `packages/types/src/index.ts` — Full type catalog (was placeholder stubs)
- `packages/types/src/paths.ts` — New: `runLogPath`, `planPath`, `coordinatorKey`
- `packages/types/src/paths.test.ts` — New: unit tests for path utilities
- `packages/types/src/index.test.ts` — New: type-level coverage tests
- `packages/types/package.json` — Updated exports (added `./paths`), version 0.1.0, moved `@cloudflare/workers-types` to `dependencies`
- `packages/types/tsconfig.json` — Exclude test files from build output
- `.gitignore` — Added `.orun/` and `.workspace/`
- `.github/workflows/workflow.yml` — Added `--gha` flag to execute step
- `kiox.lock` — Committed (previously untracked)
- `kiox.yaml` — Preserved v1.7.0 (no change from local state)
- `pnpm-lock.yaml` — Updated lockfile

## Checks Run

| Check | Result |
|-------|--------|
| `pnpm install` | ✅ Pass |
| `pnpm exec turbo run typecheck` | ✅ Pass (5/5 packages) |
| `pnpm exec turbo run build` | ✅ Pass (5/5 packages) |
| `pnpm exec turbo run test` | ✅ Pass (16 tests in @orun/types, others pass with no tests) |
| `pnpm exec turbo run lint` | ✅ Pass (deferred stubs) |
| `pnpm --filter @orun/types test` | ✅ 16 tests pass |

## Kiox/Orun Validation

- `kiox -- orun plan`: Hangs at "Loading compositions..." — the OCI pull of `ghcr.io/sourceplane/stack-tectonic` from `intent.yaml` does not complete locally. Likely a registry auth or network issue. The `kiox.lock` file confirms orun v1.7.0 resolved correctly (`sha256:7edfd13b8402d69f97d55a26440e5d760538e3e0441ab00e80e5718bbc95068a`).
- `kiox -- orun plan --view dag`: Same behavior (hangs on composition load).
- `kiox -- orun run`: Not executed. Requires successful plan compilation + deploy secrets.
- `orun run --help`: Confirms `--gha` flag exists for GitHub Actions compatibility. There is no `--execute` flag — the spec reference was based on a non-existent CLI flag.

## Scaffold Hygiene Decisions

1. **`.orun/` and `.workspace/`**: Added to `.gitignore`. These are kiox/orun runtime caches generated during `kiox -- orun plan/run`. They contain `component-tree.yaml`, `compositions.lock.yaml`, provider binaries, etc.
2. **`kiox.lock`**: Committed. It is the provider lock for `kiox.yaml` and enables reproducible workspace setup. It pins the exact OCI digest for the orun provider.
3. **Workflow `--gha` flag**: Updated the execute step from `kiox -- orun run` to `kiox -- orun run --gha`. Verified via `orun run --help` that `--gha` enables GitHub Actions compatibility mode. There is no `--execute` flag in the CLI.
4. **`kiox.yaml` v1.7.0**: Preserved as-is. This was already the local state from prior work. Not downgraded.
5. **ESLint**: Remains deferred (all packages use `echo 'lint deferred'`). Not in scope for this task.

## Assumptions

- `@cloudflare/workers-types` is listed as a `dependency` (not devDependency) because consumers importing `Env` need the Cloudflare type references to resolve. The spec's package.json example uses `dependencies`.
- Status literals corrected from scaffold placeholders (`"success"/"failure"/"queued"`) to spec values (`"completed"/"failed"`, no `"queued"`).
- The spec says "No build step required — other packages import TypeScript directly." However, the scaffold already had a `tsc` build. Both source-level (`"."` → `./src/index.ts`) and dist imports work. The source-level export is primary; dist is for any tool that needs compiled JS.
- Test files excluded from `tsc` build via `tsconfig.json` exclude pattern.

## Remaining Gaps

- `kiox -- orun plan` cannot be validated locally due to OCI composition pull hanging. This should work in CI where `sourceplane/kiox-action@v2.1.2` handles provider setup.
- ESLint remains deferred across all packages.
- No `.nvmrc` for local Node version pinning.

## Next Task Dependencies

- **Task 0003** (Coordinator): Will import `Job`, `JobStatus`, `Plan`, `ClaimResult`, `UpdateJobRequest`, `HeartbeatResponse`, `RunnableJobsResponse`, `coordinatorKey` from this package.
- **Task 0004** (Storage): Will import `Run`, `Job`, `Plan`, `Namespace`, `runLogPath`, `planPath` from this package.
- **Task 0005** (Auth): Will import `OIDCClaims`, `SessionClaims`, `Env`, `ApiError`, `ErrorCode` from this package.
- **Task 0006** (Worker API): Will import all API request/response payloads and the error envelope from this package.

## PR Number

PR #5: https://github.com/sourceplane/orun-backend/pull/5
