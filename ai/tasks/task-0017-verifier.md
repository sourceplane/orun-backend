# Task ID

Task 0017 - Verifier

# Agent

Verifier

# Current Repo Context

Task 0017 implementation is in PR #36:

- PR: https://github.com/sourceplane/orun-backend/pull/36
- Title: `feat: task-0017 catalog queue consumer`
- Branch: `task-0017-catalog-queue-consumer`
- Base: `main` at `309933ad5dce0ebb1b7bfeae0a18e2818c5f0128`
- Head: `b18c8aad089220080ba2e64a17ec45d70d12c446`
- CI run observed by orchestrator: `25538312392`
- CI status observed by orchestrator: green, 7 listed checks. Verify logs
  yourself before merging.

The implementer report is `ai/reports/task-0017-implementer.md`.

Task 0016 is already verified/merged. Its key residual risk still matters here:
`DB_CATALOG_0` / `DB_CATALOG_1` must not be activated before the cross-shard JOIN
fix in `ai/proposals/task-0016-spec-update.md` lands.

The local worktree may contain uncommitted orchestrator/spec/context edits that
are not part of PR #36. Do not revert unrelated local changes. Verify PR scope
with:

```bash
git diff --name-status origin/main...HEAD
```

and separately note any dirty worktree state in your verifier report.

# Objective

Verify PR #36 against Task 0017. Confirm whether it safely implements the
Cloudflare Queue consumer path for catalog ingestion while preserving the
single-D1 fallback and leaving multi-shard D1 inactive.

If it passes, merge PR #36 and sync local `main`. If it fails, leave the PR open
with precise blockers.

# Read First

- `ai/tasks/task-0017.md`
- `ai/reports/task-0017-implementer.md`
- `ai/reports/task-0016-verifier.md`
- `ai/proposals/task-0016-spec-update.md`
- `ai/context/current.md`
- `ai/context/task-ledger.md`
- `ai/context/decisions.md`
- `ai/context/open-risks.md`
- `ai/state.json`
- `spec/04-worker-api.md`
- `spec/07-storage.md`
- `spec/12-catalog-index.md`
- PR #36 diff and CI logs

# Required Verification

1. Inspect PR scope and report consistency.
   - Confirm the PR changed only the queue consumer, shared catalog normalizer,
     R2 helper, Worker entrypoint, tests, and implementer report.
   - Confirm `ai/reports/task-0017-implementer.md` names PR #36.
   - Confirm no broad dashboard/UI/auth/run coordination behavior changed.

2. Validate Worker queue handler wiring.
   - `apps/worker/src/index.ts` exports `queue(batch, env, ctx)`.
   - The queue handler delegates to a small testable function.
   - Existing `fetch` and `scheduled` handlers are behavior-compatible.
   - TypeScript uses Cloudflare Workers queue types correctly.

3. Validate shared normalization extraction.
   - `POST /v1/catalog/sync` fallback and queue consumer use the same
     `normalizeComponents` logic.
   - Component path validation, relation ID derivation, latest-status derivation,
     and event generation were not subtly changed during extraction.
   - Existing catalog sync validation behavior still rejects bad paths before R2
     writes, queue sends, or fallback normalization.

4. Validate queue message and envelope validation.
   - `CatalogIngestMessage` shape is fully validated, including `receivedAt` if
     it remains part of the contract.
   - Message `namespaceId`, `repoId`, `repoFullName`, `uploadId`, `envelopeRef`,
     and `commitSha` are all non-empty strings.
   - The raw envelope is read from R2 by exact `envelopeRef`.
   - The envelope is defensively validated:
     - supported schema version
     - source repo ID matches message repo ID
     - source repo slug matches message repo slug
     - source commit matches message commit SHA
     - components is an array
     - component IDs, names, and paths are valid
   - Check whether the consumer must also enforce `message.namespaceId ===
     message.repoId` for canonical catalog ingestion, or otherwise prove a
     deliberate safe reason for allowing them to differ. A mismatch could route
     writes into the wrong namespace/shard.
   - Check whether envelope `uploadId` should match message `uploadId`; if not,
     require an explanation or remediation.

5. Validate poison vs retry behavior.
   - Malformed messages are acked/dropped and do not retry forever.
   - Missing R2 object is treated as poison only if that is truly intended. If a
     missing R2 object could be eventual/transient in real Queue delivery, require
     a retry or bounded retry rationale.
   - Invalid envelope JSON and metadata mismatch are acked/dropped.
   - Transient R2 fetch failures retry.
   - D1/R2 normalization failures retry.
   - One poison message does not force valid messages in the same batch to retry.
   - One transient failure does not ack/drop unrelated valid messages.
   - Verify actual Cloudflare Queue semantics: if `message.retry()` is called and
     the handler returns successfully, the message will retry as intended.

6. Validate security and observability.
   - Logs include safe metadata only: upload ID, namespace ID, repo ID, and safe
     reason/error code.
   - No raw envelope, JWT, token, secret, component payload, or log content is
     logged.
   - Poison handling does not leak user-controlled component paths in a way that
     violates the "safe metadata only" task constraint.

7. Validate deployment safety.
   - No `DB_CATALOG_0` / `DB_CATALOG_1` production binding is added.
   - No queue binding is activated in `wrangler.jsonc` unless the PR clearly
     documents/proves safe provisioning behavior. Code-only consumer is
     acceptable.
   - No Postgres/Hyperdrive introduced.
   - Cross-shard JOIN proposal remains a hard blocker before multi-shard D1
     activation.

8. Validate CI and local checks.
   - Run local checks:

```bash
pnpm exec turbo run typecheck
pnpm exec turbo run test
pnpm exec turbo run build
```

   - Run targeted worker tests if needed:

```bash
pnpm --filter @orun/worker test
```

   - Inspect GitHub Actions logs for PR #36, including successful jobs, not just
     status summaries.
   - Confirm CI run `25538312392` or the latest replacement run actually ran the
     expected Orun/tectonic jobs. Note if fewer checks are expected because only
     worker/storage components changed.

# Acceptance Criteria

- PR #36 satisfies every acceptance criterion in `ai/tasks/task-0017.md`.
- Worker exports a queue consumer handler.
- Valid `CatalogIngestMessage` batches are processed from R2 through shared
  normalization.
- Message and envelope validation is defensive enough to prevent wrong-route
  writes.
- Poison messages are dropped without infinite retries.
- Transient failures retry.
- Existing `POST /v1/catalog/sync` fallback behavior remains compatible.
- Existing catalog read authorization remains compatible and still excludes local
  namespaces.
- No multi-shard D1 binding is activated.
- All local quality gates pass.
- PR CI logs are inspected and acceptable.
- No unresolved security, persistence, namespace isolation, or deployment
  blockers remain.

# Merge Protocol

If PASS:

1. If you add a verifier report or tiny verifier-only fix, commit it to the PR
   branch and push.
2. Wait for CI to go green again if you pushed anything.
3. Merge PR #36.
4. Checkout `main`.
5. Fast-forward pull from `origin/main`.
6. Update compact AI context/state if the merge itself does not already include
   that update.

If FAIL:

1. Leave PR #36 open.
2. Write exact blockers with file/line references where possible.
3. Do not merge.

# When Done Report

Write `ai/reports/task-0017-verifier.md` with:

- `Result: PASS|FAIL`
- `Checks`
- `Issues`
- `Risk Notes`
- `Spec Proposals`
- `Recommended Next Move`
- `PR Number`
