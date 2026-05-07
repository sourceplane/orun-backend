# Task 0013 Implementer Report

## Summary

Implemented the backend/shared/client foundation for the catalog dashboard. Orun Cloud now accepts GitHub Actions OIDC catalog sync envelopes, stores raw payloads in R2, normalizes searchable component metadata into D1, and exposes session-read catalog APIs for the dashboard UI.

## Files Changed

### New Files
- `migrations/0005_catalog_index.sql` — Catalog D1 tables and indexes
- `apps/worker/src/handlers/catalog.ts` — All 7 catalog route handlers
- `apps/worker/src/handlers/catalog.test.ts` — 21 catalog handler tests

### Modified Files
- `packages/types/src/paths.ts` — Added `catalogEnvelopePath`, `catalogComponentStatePath`
- `packages/types/src/index.ts` — Added all catalog types from spec/03-types-package.md
- `packages/types/src/paths.test.ts` — Added catalog path helper tests
- `packages/storage/src/d1.ts` — Added catalog input types and D1 methods
- `packages/storage/src/r2.ts` — Added `writeCatalogEnvelope`, `writeCatalogComponentState`
- `packages/storage/src/index.ts` — Exported new catalog input types
- `packages/storage/src/d1.test.ts` — Added migration 0005 shape check
- `apps/worker/src/router.ts` — Registered 7 catalog routes
- `packages/client/src/index.ts` — Added 7 typed catalog client methods
- `packages/client/src/index.test.ts` — Added 9 catalog client method tests

## API Routes Added

```
POST /v1/catalog/sync                                — OIDC only
GET  /v1/catalog/components                          — Session
GET  /v1/catalog/components/:componentId             — Session
GET  /v1/catalog/components/:componentId/history     — Session
GET  /v1/catalog/components/:componentId/runs        — Session
GET  /v1/catalog/components/:componentId/dependencies — Session
GET  /v1/repos/:repoId/components                    — Session
```

## Migration Notes

- `migrations/0005_catalog_index.sql` adds 4 tables: `catalog_uploads`, `catalog_components`, `catalog_component_relations`, `catalog_component_events`
- All tables have `FOREIGN KEY (namespace_id) REFERENCES namespaces(namespace_id)`
- `relation_id` is deterministic via SHA-256 hash of key relation fields (computed in catalog handler using `crypto.subtle.digest`)
- `event_id` is also deterministic via the same hash function, preventing duplicate events on replay
- Tags and environments stored as JSON in D1 per spec

## Security Checks

- `POST /v1/catalog/sync` requires OIDC auth; session tokens (dashboard and CLI) are rejected with 403
- OIDC `repository_id` claim must match `envelope.source.repoId`; OIDC `repository` claim must match `envelope.source.repo`
- Component paths validated: empty, absolute, and `..` traversal paths all rejected with 400
- Body size limited to 1 MiB (checked both via Content-Length header and after read)
- `schemaVersion` must be `"1"` (supported version); others return `INVALID_REQUEST`
- Catalog reads resolved through `resolveVisibleCatalogNamespaceIds` which excludes `namespace_kind = 'local'` rows, enforcing canonical-repo-only catalog visibility
- Duplicate `uploadId` is idempotent — checked before any D1/R2 writes

## Tests Run

```
pnpm test     — All 205 tests pass (20 types, 48 storage, 38 coordinator, 30 client, 205 worker, 9 dashboard)
pnpm typecheck — 6 packages, 0 errors
pnpm build    — 6 successful builds, 0 errors
git diff --check — clean
```

New test coverage:
- 7 path helper tests (paths.test.ts)
- 1 migration shape test (d1.test.ts)
- 21 catalog handler tests (catalog.test.ts)
- 9 catalog client method tests (index.test.ts)

## Assumptions

1. **Schema version `"1"`** is the only supported version for the first slice. Future versions should be added to a supported-versions set rather than a single constant.
2. **`schemaVersion` on `CatalogSyncEnvelope`** is validated as a string; the spec does not define the canonical set of allowed values, so `"1"` is used as the sole supported value.
3. **Normalization is synchronous via `ctx.waitUntil`** — the 202 response is returned before D1/R2 writes complete. The idempotency check (`uploadExists`) runs before `waitUntil` so duplicate requests get the correct response immediately.
4. **`latest_status` derivation**: derived from component environments array (failing > stale > healthy > unknown). Does not yet incorporate live run/job data — that would require a join to the `jobs` table per component.
5. **Component recent runs** (`GET /v1/catalog/components/:componentId/runs`) queries by `component.name` field in the `jobs` table. This matches jobs where `component = name`. If the component name doesn't match the job component field exactly, results may be empty. Documented as best-effort per spec.
6. **`resolveVisibleCatalogNamespaceIds`** joins `account_repos` with `namespaces` and filters `namespace_kind IS NULL OR namespace_kind = 'repo'`. The SQL column is `namespace_kind` (from migration 0004). This correctly excludes local CLI namespaces.

## Spec Proposals

None required. The task followed spec/12-catalog-index.md closely. One minor clarification worth noting:

The spec says `relation_id` must be deterministic but doesn't specify the algorithm. The implementation uses SHA-256 via `crypto.subtle.digest` with fields joined by `\x1f` (ASCII unit separator). This is stable, collision-resistant, and avoids the need for async alternatives.

## Remaining Gaps

1. `GET /v1/catalog/components/:componentId/runs` — best-effort match by component name only. Does not handle components whose name differs from their job component field.
2. Incoming component relations query (`listCatalogComponentRelations`) uses `target_ref` to match the componentId — this assumes relations use the component ID as `target_ref`. The orun CLI `catalog export` command (not yet implemented in `sourceplane/orun`) will need to follow this convention.
3. Full-text search (`q` parameter) uses `LIKE '%term%'` — not indexed. For large catalogs this will be slow. A future task should add FTS5 or a search index.
4. `latestStatus` does not yet reflect live run/job health — it derives from the last sync envelope's environment statuses. A future task should update this from the runs/jobs tables.
5. No rate limiting tuning for catalog sync — uses the default namespace-keyed rate limiter.

## Next Task Dependencies

- `orun catalog export` command in `sourceplane/orun` (generates `CatalogSyncEnvelope` from plan + repo state)
- `orun cloud sync` CLI command to post the envelope with OIDC auth
- Dashboard UI update to use catalog APIs (`GET /v1/catalog/components`, component detail page)
- Task 0013 Verifier: run acceptance criteria checks

## PR Number

See PR opened with this report.
