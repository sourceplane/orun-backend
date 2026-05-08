# Task 0016 — Implementer Report

## Summary

- Added a typed `StorageRouter` seam (`packages/storage/src/router.ts`) with deterministic FNV-based hash routing and a single-`DB` fallback when no catalog shard bindings are configured.
- Introduced `CatalogIngestMessage` and `CatalogQueue` types in `@orun/types`; added optional `CATALOG_INGEST_QUEUE`, `DB_CATALOG_0`, `DB_CATALOG_1` bindings to `Env`.
- Refactored `handleCatalogSync` so that namespace upsert, R2 write, and upload idempotency row land in the **sync path** (before 202); component normalization is enqueued when `CATALOG_INGEST_QUEUE` is present or deferred via `ctx.waitUntil` otherwise.
- All catalog read handlers now resolve visible namespaces from the core DB and query only the catalog shards that hold those namespaces, not all shards.
- Added `migrations/0006_tenant_routes.sql` for the core routing table; `pnpm exec turbo run test typecheck build` passes with 215 worker tests and 57 dashboard tests.

## Files Changed

### New files
| File | Purpose |
|---|---|
| `packages/storage/src/router.ts` | `StorageRouter` interface, `D1StorageRouter`, `hashNamespaceId` |
| `packages/storage/src/router.test.ts` | Unit tests: deterministic routing, single-DB fallback, queue dispatch |
| `migrations/0006_tenant_routes.sql` | Core `tenant_routes` table for future explicit shard assignments |
| `apps/worker/src/storage.ts` | `makeStorageRouter(env)` factory — reads optional shard/queue bindings from env |

### Modified files
| File | Change |
|---|---|
| `packages/types/src/index.ts` | Added `CatalogIngestMessage`, `CatalogQueue`; added `CATALOG_INGEST_QUEUE?`, `DB_CATALOG_0?`, `DB_CATALOG_1?` to `Env` |
| `packages/storage/src/index.ts` | Re-exported `D1StorageRouter`, `hashNamespaceId`, `StorageRouter`, `StorageRouterConfig` |
| `apps/worker/src/handlers/catalog.ts` | Full router-based rewrite: sync path (namespace upsert, R2 write, upload record), queue vs fallback dispatch, shard-grouped reads |
| `apps/worker/src/handlers/catalog.test.ts` | Added `makeEnvWithQueue` helper and 6 new queue + router test cases |
| `packages/storage/src/d1.test.ts` | Migration file test now validates `0006_tenant_routes.sql` |

## Checks Run

```
pnpm exec turbo run typecheck
# → 6 successful, 6 total

pnpm exec turbo run test
# → 10 successful, 10 total
#   worker: 215 tests (209 existing + 6 new)
#   dashboard: 57 tests (unchanged)
#   storage/coordinator/client: unchanged

pnpm exec turbo run build
# → 6 successful, 6 total (worker bundle 128.85 KiB / gzip 24.85 KiB)
```

## Assumptions

1. **Single-DB local behavior is fully preserved.** With no `DB_CATALOG_0`/`DB_CATALOG_1` bindings, the router returns `env.DB` for all catalog operations. All existing SQL JOINs (e.g., `catalog_components JOIN namespaces`) continue to work because both tables are in the same database.

2. **Cross-shard JOINs.** In the multi-shard topology, `catalog_components JOIN namespaces` will fail because namespaces live in the core DB and components live in a shard DB. This is a known, documented gap. The single-shard fallback makes it a non-issue today.

3. **Queue consumer is deferred.** This task wires the producer side. The actual queue consumer (reading from `CATALOG_INGEST_QUEUE`, calling `normalizeComponents`) is a separate future task. The shared `normalizeComponents` function in `catalog.ts` is ready to be called by a consumer.

4. **`tenant_routes` table is created in the single `DB`.** When shard bindings are present, this table belongs in the core DB. In single-DB mode it's co-located with everything else. The schema is migration-forward compatible.

5. **Two shard bindings (`DB_CATALOG_0`, `DB_CATALOG_1`) are the initial bounded set.** This gives tests and local dev a clear configuration path without requiring one DB per tenant.

## Spec Proposals

- `ai/proposals/task-0016-spec-update.md` — Cross-shard JOIN limitation: catalog tables currently JOIN namespaces in the same DB; multi-shard deployment will require either duplicating namespace slugs to catalog shards, removing the JOIN, or a two-phase lookup. Deferred.

## Remaining Gaps

- Queue consumer implementation (reads `CATALOG_INGEST_QUEUE` messages, calls `normalizeComponents` from R2).
- `CATALOG_INGEST_QUEUE` and shard D1 bindings not yet declared in `wrangler.jsonc` — intentional, they are optional and operator-configured.
- Cross-shard pagination is approximate in multi-shard deployments (documented in source code).
- `tenant_routes` read path in the router is not implemented — all routing is currently hash-based. Explicit tenant route lookup can be added without changing the `StorageRouter` interface.

## Next Task Dependencies

- Task 0017 (queue consumer): reads `CatalogIngestMessage` from `CATALOG_INGEST_QUEUE`, calls shared `normalizeComponents`, handles retries. The exported function and message shape are ready.
- Any task adding `DB_CATALOG_0`/`DB_CATALOG_1` wrangler bindings can do so without changing application code.

## PR Number

PR #35 — https://github.com/sourceplane/orun-backend/pull/35
