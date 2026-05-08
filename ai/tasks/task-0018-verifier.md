# Task ID

task-0018-verifier

# Agent

Verifier

# Current Repo Context

Task 0018 implementer work is open as PR #37:

- PR: https://github.com/sourceplane/orun-backend/pull/37
- Branch: `codex/task-0018-queue-provisioning`
- Head: `7f4b948dbec46128b730a648c1d147892a45517f`
- Base: `main`
- Implementer report: `ai/reports/task-0018-implementer.md`

The implementer reports:

- `CATALOG_INGEST_QUEUE` producer/consumer config added to
  `apps/worker/wrangler.jsonc`
- queue hardening added for `namespaceId !== repoId`
- envelope hardening added for `envelope.uploadId !== message.uploadId`
- local E2E coverage added for POST sync -> queue message -> consumer -> D1/R2
- local typecheck, tests, build, and `kiox -- orun plan --changed` passed
- `kiox -- orun run --changed` was partial in the implementer environment
  because Cloudflare credentials were unavailable
- live Cloudflare queue resource provisioning and endpoint smoke were not run

The user explicitly asked that this verifier include Cloudflare resource
verification and endpoint verification. Do not mark PASS until the Cloudflare
resources and live endpoints are verified, unless the user explicitly waives
live verification. If credentials are unavailable, report FAIL/BLOCKED with the
missing credential or permission, not PASS.

# Objective

Verify PR #37 end to end: code, tests, CI logs, Cloudflare Queue resources,
Worker producer/consumer wiring, and live catalog endpoints.

If everything passes, merge PR #37, sync local `main`, and write
`ai/reports/task-0018-verifier.md`.

# Read First

- `ai/tasks/task-0018.md`
- `ai/reports/task-0018-implementer.md`
- `ai/context/current.md`
- `ai/context/task-ledger.md`
- `ai/context/decisions.md`
- `ai/context/open-risks.md`
- `ai/state.json`
- `ai/proposals/task-0016-spec-update.md`
- `spec/00-constitution.md`
- `spec/01-monorepo-structure.md`
- `spec/02-devops.md`
- `spec/03-types-package.md`
- `spec/04-worker-api.md`
- `spec/07-storage.md`
- `spec/12-catalog-index.md`
- `apps/worker/wrangler.jsonc`
- `apps/worker/src/index.ts`
- `apps/worker/src/storage.ts`
- `apps/worker/src/handlers/catalog.ts`
- `apps/worker/src/handlers/catalog-queue.ts`
- `apps/worker/src/handlers/catalog-queue.test.ts`
- `apps/worker/src/handlers/catalog.test.ts`
- `packages/types/src/index.ts`
- `packages/storage/src/router.ts`

Also check current Cloudflare docs before running live resource checks:

- Wrangler Queues commands:
  https://developers.cloudflare.com/workers/wrangler/commands/queues/
- Queue producer/consumer Wrangler config:
  https://developers.cloudflare.com/queues/configuration/configure-queues/
- Queues API list response, including consumers/producers:
  https://developers.cloudflare.com/api/resources/queues/methods/list/

# Required Verification

## 1. PR Scope and Diff

Inspect `origin/main...HEAD` for PR #37. Expected scope is limited to:

- `ai/reports/task-0018-implementer.md`
- `apps/worker/src/handlers/catalog-queue.ts`
- `apps/worker/src/handlers/catalog-queue.test.ts`
- `apps/worker/src/handlers/catalog.test.ts`
- `apps/worker/wrangler.jsonc`

Flag any unrelated auth, dashboard, storage, migration, CLI, or deployment
change unless it is clearly required by Task 0018 and explained in the report.

Confirm no production catalog shard D1 bindings are added:

- no `DB_CATALOG_0`
- no `DB_CATALOG_1`
- no `CATALOG_SHARD_*`
- no Hyperdrive/Postgres binding
- no one-D1-per-tenant binding pattern

## 2. Queue Config Review

Inspect `apps/worker/wrangler.jsonc` and verify:

- `queues.producers[]` includes binding `CATALOG_INGEST_QUEUE`
- producer queue name is `orun-catalog-ingest`
- `queues.consumers[]` includes queue `orun-catalog-ingest`
- consumer settings are intentional and documented:
  - `max_batch_size: 10`
  - `max_batch_timeout: 30`
  - `max_retries: 3`
  - `dead_letter_queue: "orun-catalog-ingest-dlq"`
- JSONC syntax is accepted by Wrangler
- comments do not contain secrets or misleading deployment instructions

## 3. Queue Consumer Safety Review

Inspect `apps/worker/src/handlers/catalog-queue.ts` and tests. Verify:

- malformed messages are acked/dropped, not retried forever
- `namespaceId !== repoId` is acked/dropped before R2 fetch or D1 writes
- `envelope.uploadId !== message.uploadId` is acked/dropped before D1 writes
- transient R2/D1 failures still retry
- successful messages ack after normalization
- queue messages remain pointer-only metadata plus `envelopeRef`
- no full envelopes, component arrays, logs, plans, raw artifact payloads, JWTs,
  session tokens, or secrets are sent to Queue
- logs contain only safe metadata and safe reason codes
- no user-controlled component paths or raw envelope fields are logged
- the consumer continues using shared `normalizeComponents`
- single-DB fallback behavior remains intact when no queue binding is present

Pay close attention to safe drop reasons. If a reason interpolates arbitrary
user payload, schema fields, component paths, raw JSON, or tokens into logs,
treat that as a blocker or fix it on the PR branch before merge.

## 4. Local Checks

Run these locally from repo root:

```bash
pnpm exec turbo run typecheck
pnpm exec turbo run test
pnpm exec turbo run build
```

Run targeted tests if the full suite output is noisy:

```bash
pnpm --filter @orun/worker exec vitest run src/handlers/catalog-queue.test.ts src/handlers/catalog.test.ts
```

Because `wrangler.jsonc` changed, run local delivery validation:

```bash
/Users/irinelinson/.local/bin/kiox -- orun plan --changed
/Users/irinelinson/.local/bin/kiox -- orun run --changed
```

If `kiox -- orun run --changed` fails only because Cloudflare credentials are
missing, do not ignore it. This task requires Cloudflare verification; obtain
credentials or report FAIL/BLOCKED.

# 5. CI Verification

Use `gh` to inspect PR #37 checks and logs. Do not rely only on summary status.

Required:

- `gh pr view 37 --json statusCheckRollup,headRefOid,mergeStateStatus`
- inspect successful GitHub Actions logs for PR #37
- confirm CI ran the expected changed Worker deploy verification
- confirm logs show the queue binding in Worker build/dry-run output if the
  deploy verifier prints bindings
- confirm no dashboard/package jobs were skipped incorrectly for changed Worker
  code
- confirm no hidden failures are masked by cached tasks

If verification adds a small fix or `ai/reports/task-0018-verifier.md` to the PR
branch, commit and push it, then wait for CI to go green again before merge.

# 6. Cloudflare Resource Verification

Required environment:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN` with at least Queues Read/Write and Workers Scripts
  Read/Write permissions for the target account

Verify the resources in the same Cloudflare account used by
`https://orun-api.sourceplane.ai`.

From `apps/worker`, create missing queues if they do not already exist:

```bash
npx wrangler queues info orun-catalog-ingest
npx wrangler queues info orun-catalog-ingest-dlq
npx wrangler queues create orun-catalog-ingest
npx wrangler queues create orun-catalog-ingest-dlq
```

Use `info` first. Only run `create` for a missing queue. Do not delete or purge
existing queues during verification.

Deploy or redeploy the Worker with PR #37 code so Cloudflare attaches the
producer binding and consumer:

```bash
npx wrangler deploy --config wrangler.jsonc
```

Verify the consumer attachment:

```bash
npx wrangler queues consumer list orun-catalog-ingest --json
npx wrangler queues consumer worker list orun-catalog-ingest --json
```

Wrangler has supported both `consumer list` and `consumer worker list` forms
across versions. Use the form supported by the installed Wrangler, and record
which command was used.

Also verify through the Cloudflare Queues API:

```bash
curl -sS \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/queues"
```

Record evidence that:

- `orun-catalog-ingest` exists
- `orun-catalog-ingest-dlq` exists
- `orun-catalog-ingest` has producer script `orun-api`
- `orun-catalog-ingest` has worker consumer script `orun-api`
- consumer `dead_letter_queue` is `orun-catalog-ingest-dlq`
- consumer settings match or are equivalent to:
  - batch size 10
  - wait/batch timeout 30 seconds
  - max retries 3
- no unexpected second consumer is attached to the same queue

If the API field names differ by Wrangler/API version, record the raw field names
and explain the mapping in the verifier report.

# 7. Live Endpoint Smoke

Run a live smoke against:

```bash
export ORUN_API_URL="https://orun-api.sourceplane.ai"
```

Use a unique smoke ID:

```bash
export SMOKE_ID="task18-$(date +%s)"
```

## OIDC Token for POST `/v1/catalog/sync`

`POST /v1/catalog/sync` requires a GitHub Actions OIDC token for the repo whose
catalog envelope is being uploaded. Preferred path: run the smoke from an
OIDC-enabled GitHub Actions job on `sourceplane/orun-backend` with
`id-token: write` and audience `orun`.

Inside that job, mint the token with:

```bash
OIDC_TOKEN="$(curl -sS \
  -H "Authorization: bearer ${ACTIONS_ID_TOKEN_REQUEST_TOKEN}" \
  "${ACTIONS_ID_TOKEN_REQUEST_URL}&audience=orun" | jq -r '.value')"
```

Build a small envelope whose `source.repo`, `source.repoId`, and
`source.commit` match the GitHub Actions context:

```bash
if [ -z "${GITHUB_REPOSITORY_ID:-}" ]; then
  GITHUB_REPOSITORY_ID="$(gh repo view "${GITHUB_REPOSITORY}" --json databaseId --jq '.databaseId')"
fi

jq -n \
  --arg uploadId "task18-${SMOKE_ID}" \
  --arg repo "${GITHUB_REPOSITORY}" \
  --arg repoId "${GITHUB_REPOSITORY_ID}" \
  --arg commit "${GITHUB_SHA}" \
  --arg compId "github:${GITHUB_REPOSITORY_ID}:task18-${SMOKE_ID}" \
  --arg compName "task18-${SMOKE_ID}" \
  --arg now "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" \
  '{
    apiVersion: "orun.io/v1",
    kind: "CatalogSyncEnvelope",
    uploadId: $uploadId,
    schemaVersion: "1",
    source: {
      provider: "github",
      repo: $repo,
      repoId: $repoId,
      commit: $commit
    },
    components: [
      {
        apiVersion: "orun.io/v1",
        kind: "ComponentState",
        source: {
          provider: "github",
          repository: $repo,
          repoId: $repoId,
          commit: $commit
        },
        component: {
          id: $compId,
          name: $compName,
          type: "verification-smoke",
          path: "apps/worker",
          tags: ["task-0018", "smoke"]
        },
        environments: [
          { name: "production", status: "healthy" }
        ],
        relations: [],
        generatedAt: $now
      }
    ],
    generatedAt: $now
  }' > /tmp/task18-catalog-envelope.json
```

POST it:

```bash
curl -sS -D /tmp/task18-sync.headers \
  -H "Authorization: Bearer ${OIDC_TOKEN}" \
  -H "Content-Type: application/json" \
  -X POST "${ORUN_API_URL}/v1/catalog/sync" \
  --data-binary @/tmp/task18-catalog-envelope.json \
  -o /tmp/task18-sync.json
```

Verify:

- HTTP status is `202`
- response JSON includes the smoke `uploadId`
- `componentCount` is `1`
- no token or envelope content is printed to logs

## Session Token for Catalog Read Endpoints

Use a valid dashboard or CLI session token for an account linked to the
`sourceplane/orun-backend` canonical repo. Do not print the token.

If using the local CLI from `sourceplane/orun`, the current workaround is:

```bash
export ORUN_BACKEND_URL="https://orun-api.sourceplane.ai"
orun auth login
orun cloud link
SESSION_TOKEN="$(orun auth token --audience orun-backend)"
```

If the CLI token path is unavailable, use a dashboard session token for the same
linked account. Record which path was used without exposing the token.

Wait for queue delivery. The configured consumer timeout is up to 30 seconds, so
poll for up to 2 minutes:

```bash
COMPONENT_ID="github:${GITHUB_REPOSITORY_ID}:task18-${SMOKE_ID}"
ENCODED_COMPONENT_ID="$(printf '%s' "${COMPONENT_ID}" | jq -sRr @uri)"

for i in $(seq 1 24); do
  curl -sS \
    -H "Authorization: Bearer ${SESSION_TOKEN}" \
    "${ORUN_API_URL}/v1/catalog/components?q=${SMOKE_ID}" \
    -o /tmp/task18-components.json

  if jq -e --arg id "${COMPONENT_ID}" '.components[]? | select(.componentId == $id)' /tmp/task18-components.json >/dev/null; then
    break
  fi
  sleep 5
done
```

Verify these endpoints return expected 2xx responses and include the smoke
component where applicable:

```bash
curl -sS -H "Authorization: Bearer ${SESSION_TOKEN}" \
  "${ORUN_API_URL}/v1/catalog/components?q=${SMOKE_ID}" \
  -o /tmp/task18-components.json

curl -sS -H "Authorization: Bearer ${SESSION_TOKEN}" \
  "${ORUN_API_URL}/v1/repos/${GITHUB_REPOSITORY_ID}/components" \
  -o /tmp/task18-repo-components.json

curl -sS -H "Authorization: Bearer ${SESSION_TOKEN}" \
  "${ORUN_API_URL}/v1/catalog/components/${ENCODED_COMPONENT_ID}" \
  -o /tmp/task18-component-detail.json

curl -sS -H "Authorization: Bearer ${SESSION_TOKEN}" \
  "${ORUN_API_URL}/v1/catalog/components/${ENCODED_COMPONENT_ID}/history" \
  -o /tmp/task18-component-history.json

curl -sS -H "Authorization: Bearer ${SESSION_TOKEN}" \
  "${ORUN_API_URL}/v1/catalog/components/${ENCODED_COMPONENT_ID}/dependencies" \
  -o /tmp/task18-component-dependencies.json

curl -sS -H "Authorization: Bearer ${SESSION_TOKEN}" \
  "${ORUN_API_URL}/v1/catalog/components/${ENCODED_COMPONENT_ID}/runs" \
  -o /tmp/task18-component-runs.json
```

Required endpoint evidence:

- `POST /v1/catalog/sync` returns `202`
- `GET /v1/catalog/components?q=<smoke>` returns the smoke component
- `GET /v1/repos/<repoId>/components` includes the smoke component or otherwise
  proves the repo endpoint returns valid authenticated results for that repo
- `GET /v1/catalog/components/<componentId>` returns the smoke component detail
- `GET /v1/catalog/components/<componentId>/history` returns at least one event
  for the smoke upload
- `GET /v1/catalog/components/<componentId>/dependencies` returns `outgoing` and
  `incoming` arrays, even if empty
- `GET /v1/catalog/components/<componentId>/runs` returns a valid `runs` array,
  even if empty
- an unauthenticated catalog read returns `401` or `403`

The live smoke must demonstrate that queue-backed ingestion is active. Since the
HTTP handler only enqueues when `CATALOG_INGEST_QUEUE` is bound, a live POST that
returns `202`, followed by the component appearing after queue delivery while the
Cloudflare queue consumer is attached to `orun-api`, is sufficient evidence.

# 8. Merge Protocol

If all checks pass:

1. Write `ai/reports/task-0018-verifier.md` on the PR branch with PASS and all
   local, CI, Cloudflare resource, and endpoint evidence.
2. Commit and push the verifier report if it is not already on the PR branch.
3. Wait for CI on the updated PR branch.
4. Merge PR #37.
5. Checkout `main` locally and fast-forward pull from `origin/main`.
6. If merge to main triggers a production deployment, wait for it and repeat the
   live endpoint smoke against the post-merge deployment unless the manual
   deploy already deployed the exact merged commit.

If any required check fails:

- do not merge
- write `ai/reports/task-0018-verifier.md` with `Result: FAIL`
- list blockers with exact files, commands, CI logs, Cloudflare resource output,
  and endpoint responses
- leave clear remediation instructions

# When Done Report

Write `ai/reports/task-0018-verifier.md` with:

- Result: PASS or FAIL
- PR / Commit Verified
- Local Checks
- CI Checks and Log Evidence
- Cloudflare Resources Verified
- Live Endpoint Smoke
- Issues
- Risk Notes
- Spec Proposals
- Recommended Next Move
- Merge Result

For Cloudflare evidence, include queue names, consumer script name, settings, and
endpoint status summaries. Do not include secrets, tokens, full OIDC JWTs,
session tokens, full envelope bodies, or raw user payloads.
