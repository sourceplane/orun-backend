# Task 0017 Implementer Report — Catalog Queue Consumer

## Summary

- Added `queue(batch, env, ctx)` handler to the Worker entry point (`apps/worker/src/index.ts`), delegating to `handleCatalogIngestQueue` in the new handler module.
- Extracted shared normalization helpers (`deriveRelationId`, `validateComponentPath`, `deriveLatestStatus`, `normalizeComponents`, `SUPPORTED_SCHEMA_VERSION`) from `catalog.ts` into `apps/worker/src/catalog-normalize.ts`; both `POST /v1/catalog/sync` fallback path and the queue consumer now use the same normalization logic.
- Implemented `handleCatalogIngestQueue` with per-message ack/retry semantics: malformed messages, missing R2 objects, invalid JSON, and envelope mismatch are all dropped (acked) without retry; transient R2 fetch errors and D1/normalization errors trigger `message.retry()`.
- Added `readCatalogEnvelopeBody(ref)` to `R2Storage` so the consumer can separate transient R2 fetch errors (retry) from missing objects (drop) and JSON parse errors (drop) with two independent `try/catch` blocks.
- 20 new queue consumer tests added; all 235 worker tests pass, typecheck clean, build succeeds.

## Files Changed

### `packages/storage`
- `packages/storage/src/r2.ts` — add `readCatalogEnvelopeBody(envelopeRef): Promise<R2ObjectBody | null>`

### `apps/worker` — shared normalization
- `apps/worker/src/catalog-normalize.ts` — new module: `SUPPORTED_SCHEMA_VERSION`, `deriveRelationId`, `validateComponentPath`, `deriveLatestStatus`, `normalizeComponents`
- `apps/worker/src/handlers/catalog.ts` — remove local duplicates, import from `../catalog-normalize`

### `apps/worker` — queue consumer
- `apps/worker/src/handlers/catalog-queue.ts` — new: `handleCatalogIngestQueue(batch, env, ctx)`
- `apps/worker/src/index.ts` — add `queue` export that delegates to `handleCatalogIngestQueue`

### Tests
- `apps/worker/src/handlers/catalog-queue.test.ts` — 20 new tests covering: success path, per-message batch isolation, poison drops (malformed shape, missing R2, invalid JSON, repoId/repo/commit mismatch, bad paths), transient retry (R2 fetch, D1 normalization)

## Checks Run

```
pnpm exec turbo run typecheck
→ 6/6 packages pass, 0 errors

pnpm exec turbo run test
→ 13 test files, 235 tests pass (including 20 new queue consumer tests)

pnpm exec turbo run build
→ Worker bundle 132.88 KiB / gzip 25.66 KiB, dry-run successful
```

## Assumptions

- `MessageBatch<T>` and `Message<T>` (with `.ack()` / `.retry()`) are available as globals via `@cloudflare/workers-types` in the worker tsconfig — confirmed by successful typecheck.
- No queue binding is added to `wrangler.jsonc` for production in this task (code-only consumer per task constraint). The binding must be provisioned and documented before activating in production.
- Corrupted JSON stored in R2 is treated as a permanent poison (acked/dropped) — re-fetching won't fix it. If R2 fetch itself throws, that is treated as transient.
- Normalization errors (D1 write failures) are treated as transient regardless of cause; the CF Queue retry ceiling bounds looping.

## Spec Proposals

- `ai/proposals/task-0016-spec-update.md` — cross-shard JOIN limitation, must be resolved before activating multi-shard D1 bindings (unchanged from task-0016).

## Remaining Gaps

- No `CATALOG_INGEST_QUEUE` binding in `wrangler.jsonc` — the consumer exists as code only. Activating production queue delivery requires CF Queue resource provisioning and wrangler binding, blocked on multi-shard JOIN resolution per task constraints.
- No dead-letter queue (DLQ) for poison messages — they are dropped; a DLQ would give observability on bad envelopes but is not required for this task.
- No live Cloudflare smoke for queue delivery (no CF credentials in implementer environment).

## Next Task Dependencies

- Task 0018 or equivalent must provision `CATALOG_INGEST_QUEUE` in `wrangler.jsonc` and Cloudflare, then run end-to-end smoke to confirm queue consumer processes envelopes in production.
- Cross-shard JOIN fix (proposal `task-0016-spec-update.md`) remains a prerequisite before activating `DB_CATALOG_0` / `DB_CATALOG_1`.

## PR Number

PR #36: https://github.com/sourceplane/orun-backend/pull/36
