# Task 0016 — Verifier Report

## Result: PASS

---

## Checks

### 1. PR Scope and Report Consistency

- Files changed in PR #35 exactly match the implementer report (11 files: 4 new, 7 modified).
- Implementer report correctly names PR #35.
- No unrelated product, UI, or auth behavior was changed.
- Dirty worktree: ai/context/*, spec/*, ai/state.json, README.md, SCHEDULE.md have orchestrator/spec edits not part of PR #35. These are expected and were not reverted.

### 2. Storage Router

- `packages/storage/src/router.ts`: `StorageRouter` interface and `D1StorageRouter` class implemented correctly.
- `hashNamespaceId` uses FNV-1a-like hash — deterministic and uniform distribution across numeric IDs.
- `catalogForNamespace`: returns `coreDb` when no shards configured (single-DB fallback) ✓; returns `shards[hash(id) % shards.length]` when shards configured ✓.
- `catalogForNamespaces`: correctly groups namespace IDs by shard without scanning unused shards ✓.
- `hasCatalogQueue` / `enqueueCatalogIngest`: optional queue model, throws without queue binding ✓.
- `apps/worker/src/storage.ts`: `makeStorageRouter(env)` reads `DB_CATALOG_0`, `DB_CATALOG_1`, `CATALOG_INGEST_QUEUE` from env. Handlers use `makeStorageRouter(env)` — they do not choose shard bindings directly ✓.
- Router unit tests: 15 cases covering deterministic routing, fallback, queue dispatch, message shape. All pass ✓.
- `tenant_routes` table is in `migrations/0006_tenant_routes.sql`. Explicit route lookup is NOT yet implemented in the router (routing is hash-only) — honestly documented as deferred in the implementer report. This is acceptable for this task scope.

### 3. Catalog Sync

- OIDC-only write policy enforced: dashboard sessions and CLI sessions rejected with 403 ✓.
- Envelope validation order: body size, shape, schemaVersion, repoId/repo OIDC match, components array, per-component path validation — all synchronous, all before R2 or D1 writes ✓.
- R2 write (raw envelope) happens in sync path before returning 202 ✓.
- `catalog_uploads` idempotency row written in sync path via `catalogIndex.recordCatalogUpload()` before returning 202 ✓.
- `uploadExists` check prevents duplicate `catalog_uploads` rows and skips re-enqueue on duplicate uploadId ✓.
- Queue messages: `CatalogIngestMessage` contains only `namespaceId`, `repoId`, `repoFullName`, `uploadId`, `envelopeRef`, `commitSha`, `receivedAt` — no full envelopes, component states, plans, logs, or tokens ✓.
- Fallback path: calls `ctx.waitUntil(normalizeComponents(...))` when no queue binding ✓.
- `normalizeComponents` is shared between queue and fallback paths ✓.
- Idempotency on queue path: duplicate uploadId returns 202 without re-enqueuing (0 messages enqueued) ✓.

### 4. Catalog Read Behavior

- All read handlers use session auth; OIDC rejected with 403 ✓.
- `resolveVisibleCatalogNamespaceIds` queries `account_repos JOIN namespaces` on core DB, filtering `namespace_kind IS NULL OR namespace_kind = 'repo'` — local namespaces are excluded ✓.
- `catalogForNamespaces` used by all read handlers to group by shard — no full shard scan ✓.
- `listCatalogComponentsFromRouter`: single-shard shortcut avoids unnecessary merge; multi-shard path documented as approximate pagination ✓.
- `getCatalogComponentFromRouter`: stops at first shard match ✓.
- Tests cover: session-only reads, local namespace exclusion, empty component list, 404 for missing component, history and repo component endpoints ✓.

### 5. Cross-Shard JOIN Proposal

**Accepted as non-blocking. Tracked as a hard pre-requisite for multi-shard deployment.**

The read queries (`listCatalogComponents`, `getCatalogComponent`, `listCatalogComponentEvents`, `listCatalogComponentRecentRuns`) all do `catalog_* JOIN namespaces`. In multi-shard mode, `namespaces` is in core D1 while catalog tables are in shard D1s — these JOINs would fail.

The write/sync path does NOT JOIN namespaces (`recordCatalogUpload`, `getCatalogComponentRow`, `upsertCatalogComponent`, `replaceCatalogRelations`, `appendCatalogComponentEvent` are all pure catalog-table operations). The sync path is safe in multi-shard mode.

Acceptance rationale:
1. `DB_CATALOG_0`/`DB_CATALOG_1` are NOT declared in `wrangler.jsonc`. No multi-shard deployment exists.
2. Task 0016's "bounded shard support" requirement is about the routing seam, not about multi-shard reads working end-to-end today.
3. The single-DB fallback is the only active deployment path, and it works correctly.
4. The proposal (Option 3: denormalized `namespace_slug` column) is clearly defined and low-risk to implement.
5. Requiring full multi-shard read support in this task would scope-creep beyond the routing seam into D1 schema changes.

**Risk: Any future PR that adds `DB_CATALOG_0`/`DB_CATALOG_1` to `wrangler.jsonc` MUST first implement the cross-shard fix from `ai/proposals/task-0016-spec-update.md`.**

### 6. Migrations and Deployment

- `migrations/0006_tenant_routes.sql`: correct schema, matches spec exactly.
- Migration tested in `packages/storage/src/d1.test.ts` (readFileSync + parse check).
- No `wrangler.jsonc` binding change required for current single-D1 deployment ✓.
- Optional `DB_CATALOG_0`, `DB_CATALOG_1`, `CATALOG_INGEST_QUEUE` are absent from `wrangler.jsonc` — intentional, operator-configured ✓.
- Worker bundle: 128.85 KiB / gzip 24.85 KiB. Build clean ✓.

### 7. CI and Local Checks

**Local:**
```
pnpm exec turbo run typecheck   → 6 successful, 6 total (cached)
pnpm exec turbo run test        → 10 successful, 10 total (215 worker + 57 dashboard)
pnpm exec turbo run build       → 6 successful, 6 total (128.85 KiB bundle)
```

**CI Run 25537266699 (PR #35):**
- 10/10 checks green.
- Orun Plan ✓, orun-types ×3 (dev/staging/prod) ✓, orun-storage ×3 ✓, orun-api-worker ×3 ✓.
- All jobs ran expected turbo verify/deploy tasks.

---

## Issues

None blocking. No security, persistence, namespace isolation, or deployment blockers.

---

## Risk Notes

1. **Cross-shard JOIN gap**: Read queries join `catalog_*` to `namespaces` in same DB. Multi-shard deployment will fail reads until `ai/proposals/task-0016-spec-update.md` Option 3 is implemented. Must block any PR that activates shard bindings in `wrangler.jsonc`.

2. **Queue consumer deferred**: `CATALOG_INGEST_QUEUE` producer is wired. Consumer (Task 0017) is not. Messages accumulate if queue binding is ever configured before the consumer lands. Not a concern for current deployment (no queue binding).

3. **`tenant_routes` read path deferred**: Router does not consult `tenant_routes` for explicit shard assignments — all routing is hash-based. Acceptable for this task scope; the table is there for future use.

4. **Approximate multi-shard pagination**: `listCatalogComponentsFromRouter` in multi-shard mode fetches all per-shard results then re-paginates. Documented in source. Acceptable deferral.

5. **Repo health remains yellow**: Task 0012 local conformance bookkeeping is unchanged and unrelated to this task.

---

## Spec Proposals

- `ai/proposals/task-0016-spec-update.md` — Cross-shard JOIN limitation. **Accepted as non-blocking** per rationale above. Must be resolved before multi-shard deployment.

---

## Recommended Next Move

Merge PR #35 and advance to Task 0017 (queue consumer). Task 0017 reads `CatalogIngestMessage` from `CATALOG_INGEST_QUEUE`, calls shared `normalizeComponents`, and handles retries. The exported function and message shape are ready.

Before any task that activates `DB_CATALOG_0`/`DB_CATALOG_1` in production, implement Option 3 from the cross-shard JOIN proposal (denormalized `namespace_slug` column on catalog tables).

---

## PR Number

PR #35 — https://github.com/sourceplane/orun-backend/pull/35
