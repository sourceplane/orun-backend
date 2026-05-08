# Task 0017 Verifier Report — Catalog Queue Consumer

## Result: PASS

One constraint violation was found and fixed in this verifier pass before merge (see
Issues). All other checks passed.

---

## Checks

### 1. PR Scope

`git diff --name-status origin/main...HEAD` lists exactly:

```
A  ai/reports/task-0017-implementer.md
A  apps/worker/src/catalog-normalize.ts
A  apps/worker/src/handlers/catalog-queue.test.ts
A  apps/worker/src/handlers/catalog-queue.ts
M  apps/worker/src/handlers/catalog.ts
M  apps/worker/src/index.ts
M  packages/storage/src/r2.ts
```

Scope is clean: queue consumer, shared normalizer, R2 helper, Worker entrypoint,
tests, and implementer report. No dashboard/UI/auth/run coordination change.

Dirty worktree contains orchestrator/spec/context edits not in PR #36 scope; none
were reverted.

### 2. Worker Queue Handler Wiring

- `apps/worker/src/index.ts` exports `queue(batch, env, ctx)` using correct
  `MessageBatch<CatalogIngestMessage>` type; delegates to `handleCatalogIngestQueue`.
- `fetch` and `scheduled` handlers are behavior-identical to pre-PR code.
- TypeScript uses Cloudflare Workers queue globals (`MessageBatch<T>`,
  `Message<T>.ack()`, `Message<T>.retry()`) confirmed by successful typecheck.

### 3. Shared Normalization Extraction

- `catalog-normalize.ts` exports `SUPPORTED_SCHEMA_VERSION`, `deriveRelationId`,
  `validateComponentPath`, `deriveLatestStatus`, `normalizeComponents`.
- `catalog.ts` imports from `../catalog-normalize` — no local duplicates remain.
- Both `POST /v1/catalog/sync` fallback path and queue consumer call the same
  `normalizeComponents`. Component path validation, relation ID derivation,
  latest-status derivation, and event generation are not duplicated or changed.
- Synchronous rejection of bad component paths in `catalog.ts` lines 119–130
  is unchanged.

### 4. Queue Message and Envelope Validation

- `isCatalogIngestMessage` guards all six required non-empty string fields:
  `namespaceId`, `repoId`, `repoFullName`, `uploadId`, `envelopeRef`, `commitSha`.
- `receivedAt` is part of `CatalogIngestMessage` type but is not required for
  consumer routing; its absence is non-fatal (not used in validation or writes).
- `validateEnvelopeAgainstMessage` checks: schemaVersion, source.repoId,
  source.repo, source.commit, components array, component id/name/path.
- `validateComponentPath` is called for each component path.

**`message.namespaceId` vs `message.repoId`:** The consumer does not explicitly
assert `message.namespaceId === message.repoId`. In the producer (`catalog.ts`)
both fields are set to `oidcRepoId` (the OIDC-verified canonical repo namespace);
they are structurally equal at production time and the CF Queue is not directly
writable by external actors. This is a defense-in-depth gap that should be
documented as an accepted risk (see Risk Notes).

**`envelope.uploadId` vs `message.uploadId`:** Not explicitly checked. The
structural guarantee is that `envelopeRef = catalogEnvelopePath(namespaceId, uploadId)`
so the R2 object at that key always contains an envelope where `uploadId` matches.
Accepted as structurally safe (see Risk Notes).

### 5. Poison vs Retry Behavior

| Case | Behavior | Correct |
|---|---|---|
| Malformed message shape | `message.ack()` | ✓ |
| Missing R2 object (`null` return) | `message.ack()` | ✓ |
| Transient R2 fetch throw | `message.retry()` | ✓ |
| Invalid envelope JSON | `message.ack()` | ✓ |
| Envelope metadata mismatch | `message.ack()` | ✓ |
| D1/normalization failure | `message.retry()` | ✓ |
| Poison in batch | only that message acked | ✓ |
| Transient failure in batch | only that message retried | ✓ |

CF Queue semantics confirmed: `message.retry()` marks the message for redelivery;
the handler returning normally does not ack the marked message. Per-message
handling prevents batch-level blast.

### 6. Security and Observability

- `logDrop` logs `uploadId`, `namespaceId`, `repoId`, and `reason` only.
- No raw envelope, JWT, token, secret, or component payload is logged.
- **Blocker fixed in this verifier pass:** `validateEnvelopeAgainstMessage` was
  returning `"invalid component.path: ${cs.component.path}"`, which included a
  user-controlled path value in the logged `reason`, violating the "safe metadata
  only / safe error code" constraint. Changed to the opaque code
  `"invalid_component_path"`. See Issues.

### 7. Deployment Safety

- `wrangler.jsonc` build output confirms no `CATALOG_INGEST_QUEUE` queue binding,
  no `DB_CATALOG_0` / `DB_CATALOG_1` D1 bindings.
- No Postgres/Hyperdrive introduced.
- Worker bundle is 132.88 KiB (unchanged from implementer report).
- Cross-shard JOIN proposal (`ai/proposals/task-0016-spec-update.md`) remains a
  hard blocker for multi-shard D1 activation.

### 8. CI and Local Checks

Local:

```
pnpm exec turbo run typecheck → 6/6 packages, 0 errors (FULL TURBO)
pnpm exec turbo run test      → 10/10 tasks, 235 worker + 57 dashboard tests pass
pnpm exec turbo run build     → 6/6 tasks, 132.88 KiB bundle, dry-run OK
```

CI run 25538312392: 7/7 checks green (3 × orun-api-worker, 3 × orun-storage per
env, 1 × Orun Plan). No dashboard check because dashboard source did not change —
expected. All check durations (15–46 s) are normal.

---

## Issues

### FIXED — Path value logged in reason field

**File:** `apps/worker/src/handlers/catalog-queue.ts`  
**Original line 62:**

```typescript
return `invalid component.path: ${cs.component.path}`;
```

**Problem:** User-controlled path value (e.g. `apps/../../../etc/passwd`) appeared
in the `reason` field logged by `logDrop`, violating the task constraint "safe
metadata only: upload ID, namespace ID, repo ID, and safe reason/error code."

**Fix applied by verifier:**

```typescript
return "invalid_component_path";
```

---

## Risk Notes

1. **`message.namespaceId` !== `message.repoId` not enforced in consumer.** In
   theory a crafted message could route writes to a wrong namespace shard. In
   practice the CF Queue is not directly writable externally and the producer
   always sets both fields to the OIDC-verified `oidcRepoId`. Recommend adding
   an explicit guard (`if (body.namespaceId !== body.repoId) { logDrop(...); message.ack(); continue; }`)
   in a future hardening pass to eliminate the dependency on producer behavior.

2. **`envelope.uploadId` not validated against `message.uploadId`.** Structurally
   safe because `envelopeRef = catalogEnvelopePath(namespaceId, uploadId)` —
   the object at that key will always carry a matching `uploadId`. No D1 idempotency
   or routing risk today. Recommend adding the check as defensive validation in a
   future hardening pass.

3. **No DLQ for poison messages.** Dropped messages are gone. Observability on bad
   envelopes is limited to Workers logs. Deferred to a future task.

4. **Cross-shard JOIN limitation remains.** `DB_CATALOG_0` / `DB_CATALOG_1` must not
   be activated before `ai/proposals/task-0016-spec-update.md` Option 3 lands.

5. **No live CF Queue smoke.** Queue consumer is code-only; no `CATALOG_INGEST_QUEUE`
   binding in `wrangler.jsonc`. End-to-end smoke requires Task 0018 provisioning.

---

## Spec Proposals

- `ai/proposals/task-0016-spec-update.md` — cross-shard JOIN limitation,
  prerequisite for multi-shard D1 activation (unchanged from task-0016).

---

## Recommended Next Move

Task 0018: provision `CATALOG_INGEST_QUEUE` in Cloudflare and `wrangler.jsonc`,
run end-to-end queue delivery smoke to confirm the consumer processes envelopes in
production. Also add explicit `message.namespaceId === message.repoId` guard and
`envelope.uploadId === message.uploadId` validation as defense-in-depth before
activating in production.

---

## PR Number

PR #36: https://github.com/sourceplane/orun-backend/pull/36
