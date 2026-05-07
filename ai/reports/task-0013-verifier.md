# Task 0013 Verifier Report

Result: FAIL

## Summary

Task 0013 implements the expected catalog index surface and the standard local/CI checks are green. The Worker routes, shared types, D1 migration, R2 helpers, storage helpers, and client methods are present, and the latest `main` CI deployed `0005_catalog_index.sql` plus the Worker successfully.

Verification still fails because `POST /v1/catalog/sync` does not fully validate required component paths before returning `202`. A malformed envelope with `component.path` omitted is accepted, then the async normalizer attempts to write `repoPath: undefined` into the NOT NULL `catalog_components.repo_path` column. This violates the task's required path validation and can silently lose a catalog sync after the caller has already received an accepted response.

## Code / Commit Context

- Current branch: `main`
- Current commit: `cb345038a684bacee173c940733a4c547ccc5469`
- Commit title: `feat: task-0013 catalog index foundation — sync API, D1/R2 storage, typed client (#33)`
- GitHub PR lookup: `gh pr view 33 --repo sourceplane/orun-backend` failed; PR #33 is not visible in GitHub PR metadata. The commit is present on `origin/main`.
- Latest `main` CI run: `25509822248` — `success`

## Checks

| Check | Result |
|---|---|
| `pnpm test` | PASS — 205 worker tests, 48 storage, 38 coordinator, 30 client, 20 types, 9 dashboard |
| `pnpm typecheck` | PASS |
| `pnpm build` | PASS |
| `git diff --check` | PASS |
| `/Users/irinelinson/.local/bin/kiox -- orun plan --changed` | PASS — 0 changed jobs |
| `/Users/irinelinson/.local/bin/kiox -- orun run --changed` | PASS — 0 changed jobs |
| CI run `25509822248` | PASS |
| Live unauthenticated `GET /v1/catalog/components` | 401 typed JSON |
| Live unauthenticated `POST /v1/catalog/sync` | 401 typed JSON |
| Live wrong-method `GET /v1/catalog/sync` | 405 typed JSON |

## CI Evidence

CI run `25509822248` on commit `cb34503` completed successfully.

Observed in CI logs:

- `orun plan` ran and produced plan `ad7cf366d193`.
- Component verification jobs ran for changed packages.
- Production Worker job applied `0005_catalog_index.sql` successfully.
- Worker deployment succeeded with Version ID `243655dc-65ec-4964-91fc-0e3c15d6593d`.
- No unmasked secrets were visible in inspected logs.

## Acceptance Review

Implemented and present:

- Catalog shared types in `packages/types/src/index.ts`.
- Catalog R2 path helpers in `packages/types/src/paths.ts`.
- `migrations/0005_catalog_index.sql` with upload/component/relation/event tables.
- Catalog storage helpers in `packages/storage/src/d1.ts` and `packages/storage/src/r2.ts`.
- Worker catalog routes in `apps/worker/src/router.ts`.
- Catalog handlers in `apps/worker/src/handlers/catalog.ts`.
- `@orun/client` catalog methods.
- Tests for OIDC/session auth behavior, repo mismatch, path traversal/absolute/empty paths, R2 writes, route registration, and client request construction.

Not satisfied:

1. Component path validation is incomplete.

## Issues

### 1. Missing `component.path` is accepted and fails after `202`

`handleCatalogSync` only validates `cs.component.path` when the property is not `undefined`:

```typescript
if (cs.component?.path !== undefined) {
  validateComponentPath(cs.component.path);
}
```

It then returns `202` before the async normalizer runs. During normalization, `cs.component.path` is assigned to `repoPath`, which maps to `catalog_components.repo_path NOT NULL`.

Impact:

- The API accepts an invalid catalog envelope that lacks a required component path.
- The caller receives `202 Accepted`.
- R2 may store the raw invalid envelope.
- D1 normalization can fail in `ctx.waitUntil`, so the component never becomes queryable.
- The failure is invisible to the uploader, making catalog sync unreliable for a required-field schema error.

Required fix:

- Reject missing or non-string `component.path` synchronously with `INVALID_REQUEST`.
- Add a regression test for omitted `component.path`.
- Consider also validating `envelope.components` is an array and each component has the expected source/repo fields, but the path omission is the blocking acceptance failure.

## Risk Notes

- Duplicate `uploadId` idempotency is implemented for already-recorded uploads. There is still a narrow race because the first upload records the row inside `ctx.waitUntil`; an immediate duplicate before normalization starts could schedule a second normalizer. Event IDs are deterministic and `ON CONFLICT DO NOTHING`, but `catalog_uploads` insertion could still throw in the background. This is worth tightening after the path blocker, though I am not marking it as the primary fail because the task allowed `ctx.waitUntil` normalization.
- `GET /v1/catalog/components/:componentId/dependencies` returns empty relations for an invisible/nonexistent component instead of first proving the component exists and is visible. This is low risk but should be revisited with the UI task.
- Existing `D1Index.upsertNamespace()` ignores `Namespace.kind`. New rows default to `repo` after migration `0004`, so Task 0013 behavior is okay for canonical catalog sync, but a future cleanup should align the helper with the type.

## Recommended Next Move

Open Task 0013.1 as a small implementer fix:

1. Make catalog sync reject missing/non-string `component.path` synchronously.
2. Add tests for omitted path and, ideally, non-array `components`.
3. Tighten duplicate upload recording by reserving the upload row before returning `202`, or document the async race if intentionally deferred.
4. Re-run `pnpm test`, `pnpm typecheck`, `pnpm build`, `git diff --check`, and CI.
