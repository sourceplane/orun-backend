# Spec V2-04 - Storage, Ingestion, And Runtime State

## Scope

This spec defines how V2 stores and moves data across Postgres, R2, Durable
Objects, Queues, and D1/KV projections.

## Worker Environment

V2 Worker environment adds:

```typescript
interface EnvV2 {
  COORDINATOR: DurableObjectNamespace;
  RATE_LIMITER: DurableObjectNamespace;
  STORAGE: R2Bucket;

  // V1 compatibility and optional projections
  DB?: D1Database;
  DB_CATALOG_0?: D1Database;
  DB_CATALOG_1?: D1Database;

  // V2 database
  HYPERDRIVE?: Hyperdrive;
  DATABASE_URL?: string; // local/dev fallback only

  // Supabase Auth verification
  SUPABASE_URL: string;
  SUPABASE_JWKS_URL: string;
  SUPABASE_JWT_AUDIENCE?: string;

  // GitHub workload auth
  GITHUB_JWKS_URL: string;
  GITHUB_OIDC_AUDIENCE: string;

  // Queues
  CATALOG_INGEST_QUEUE?: CatalogQueueV2;
  PROJECTION_QUEUE?: ProjectionQueue;

  // Secrets
  ORUN_SESSION_SECRET?: string; // CLI and V1 compatibility
  ORUN_DEPLOY_TOKEN?: string;
  GITHUB_APP_ID?: string;
  GITHUB_APP_PRIVATE_KEY?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
}
```

Use actual Cloudflare Worker binding types where available. Do not hardcode
Cloudflare secrets in config files.

`SUPABASE_API_KEY` is not a Worker runtime secret. It is a GitHub Actions
provisioning secret used by Terraform/Tactonic and Supabase Management API
workflows. Runtime Workers verify Supabase sessions with `SUPABASE_URL`,
`SUPABASE_JWKS_URL`, and optional `SUPABASE_JWT_AUDIENCE`.

## Database Access

All Postgres access goes through `packages/db`.

Rules:

- no SQL in React dashboard
- no ad hoc SQL spread across Worker handlers
- no unscoped tenant queries
- every tenant query includes `organization_id`
- transactions are used for multi-row onboarding and ingestion state changes
- service methods return typed domain objects

Suggested store methods:

```typescript
organizations.createOrganization(input)
organizations.listForUser(userId)
authz.requireOrgPermission(ctx, orgId, permission)
repositories.resolveGitHubOidcRepository(githubRepositoryId)
runs.createRun(input)
runs.updateFromCoordinator(input)
catalog.recordUpload(input)
catalog.normalizeEnvelope(input)
audit.append(input)
```

## R2 Path Layout

V2 writes new objects under organization/project/repository prefixes:

```text
orgs/{organizationId}/projects/{projectId}/repositories/{repositoryId}/runs/{runId}/logs/{jobId}.log
orgs/{organizationId}/projects/{projectId}/repositories/{repositoryId}/plans/{checksum}.json
orgs/{organizationId}/projects/{projectId}/repositories/{repositoryId}/catalog/uploads/{uploadId}/catalog-sync-envelope.json
orgs/{organizationId}/projects/{projectId}/repositories/{repositoryId}/catalog/commits/{commitSha}/components/{componentName}.json
orgs/{organizationId}/projects/{projectId}/repositories/{repositoryId}/snapshots/runs/{runId}.json
```

V1 R2 keys under `{namespaceId}/...` must remain readable during migration.

R2 object refs stored in Postgres should be opaque strings. API consumers should
not build R2 keys themselves.

## Durable Object Key

V2 Durable Object key:

```text
{organizationId}:{projectId}:{repositoryId}:{runId}
```

This prevents run ID collision across organizations and projects.

During V1 compatibility, existing DO key behavior can remain:

```text
{namespaceId}:{runId}
```

The Worker must route `/v1` and `/v2` consistently and avoid mixing DO keys for
the same live run.

## Run Lifecycle

### Create run

1. Authenticate.
2. Resolve org/project/repository scope.
3. Authorize run creation or CI write.
4. Validate plan.
5. Initialize DO.
6. Save plan JSON to R2.
7. Insert Postgres run and job rows.
8. Enqueue projection update if enabled.
9. Return created response.

The DO remains live source of truth. Postgres is the historical/query source of
truth.

### Update job

1. Authenticate as workload/CLI runner.
2. Resolve run scope.
3. Forward update to DO.
4. If DO accepts update, persist summary to Postgres in `ctx.waitUntil`.
5. Enqueue projection update.

If Postgres update fails after DO update, retry through a queue or scheduled
reconciler. Do not roll back DO state based on index write failure.

### Finish run

When DO reaches terminal state:

- Postgres run row is updated.
- optional run snapshot is written to R2.
- usage event is appended.
- projection update is enqueued.

## Catalog Sync Flow

### Producer route

`POST /v2/catalog/sync`:

1. Verify GitHub OIDC.
2. Resolve repository binding in Postgres.
3. Validate envelope:
   - API version
   - schema version
   - upload ID
   - repo ID matches OIDC and repository binding
   - repo slug matches current or accepted previous slug
   - commit SHA
   - component IDs
   - component names
   - relative paths only
   - max body size
4. Store raw envelope in R2.
5. Insert or observe `catalog_uploads` idempotency row.
6. Enqueue `CatalogIngestMessageV2`.
7. Return `202`.

### Message shape

```typescript
interface CatalogIngestMessageV2 {
  organizationId: string;
  projectId: string;
  repositoryId: string;
  githubRepositoryId: string;
  repoFullName: string;
  uploadId: string;
  envelopeRef: string;
  commitSha: string;
  receivedAt: string;
}
```

Queue messages must not contain full envelopes, component states, logs, plans,
or tokens.

### Consumer behavior

1. Validate message shape.
2. Fetch envelope from R2.
3. Parse JSON.
4. Re-validate envelope against message and repository binding.
5. Normalize into Postgres:
   - components
   - component snapshots
   - relations
   - events
6. Mark upload normalized.
7. Enqueue projection update.
8. Ack message.

Transient Postgres/R2 failures retry. Poison messages are acked after safe
metadata logging and the upload row is marked failed where possible.

## Projection Flow

D1/KV projections are optional. They are written after authoritative Postgres
changes.

Projection messages:

```typescript
interface ProjectionMessage {
  organizationId: string;
  projectId?: string;
  resourceType: "catalog" | "project_summary" | "run_summary";
  resourceId?: string;
  reason: string;
  createdAt: string;
}
```

Projection workers must:

- query Postgres as source of truth
- write denormalized D1/KV rows
- be idempotent
- tolerate missing rows
- never authorize requests

## Scheduled Work

Scheduled Worker responsibilities:

- revoke expired invites
- revoke expired CLI sessions
- clean expired run artifacts according to retention policy
- reconcile Postgres run rows with terminal DO snapshots when needed
- retry failed projection updates
- emit usage rollups

Scheduled cleanup must query Postgres for authoritative retention policy.

## D1 Compatibility

Current D1 tables remain during migration. They serve:

- V1 endpoint fallback
- backfill input
- optional projection output
- local bootstrap support until V2 bootstrap exists

New V2 code must not add authoritative tenant state to D1.

Known V1 issue: catalog D1 queries join `namespaces` in the same DB. Do not
activate D1 catalog shards or build V2 on that pattern. In V2, Postgres joins
are authoritative and D1 projections should denormalize display fields.

## Observability

Log safe metadata only:

- organization ID
- project ID
- repository ID
- upload ID
- run ID
- error code
- duration

Never log:

- raw JWTs
- GitHub tokens
- Supabase tokens
- refresh tokens
- catalog envelope bodies
- job logs
- secrets

Metrics to add:

- catalog upload accepted count
- catalog normalization success/failure count
- queue retry count
- run created count
- run terminal status count
- Postgres query error count
- R2 write/read error count
- auth failure count by reason

## Local Development

Local development should support:

- local Postgres or Supabase project
- Supabase CLI already logged in for linked-project workflows
- Miniflare Worker
- R2/D1 mocks or local Miniflare equivalents
- migration reset command
- seed script for user/org/project/repo

Do not require a live Supabase project for unit tests.

Provisioned shared environments must come from the Tactonic Terraform component
in `spec/v2/07-provisioning-and-operations.md`; local-only workflows may use
Supabase CLI project linkage directly.

## Acceptance Criteria

- V2 writes authoritative catalog/run data to Postgres.
- V2 artifacts are written under org/project/repository R2 paths.
- V2 DO keys include org/project/repository/run.
- Catalog ingestion queue messages include org/project/repo scope.
- D1 is used only for compatibility or projections.
- Scheduled cleanup reads retention policy from Postgres.
- Safe logging rules are followed.
