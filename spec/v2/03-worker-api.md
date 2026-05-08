# Spec V2-03 - Worker API

## Scope

This spec defines V2 HTTP APIs. V2 routes are organization-scoped and backed by
Postgres as the source of truth.

V1 routes remain for compatibility and migration. New product capabilities must
use `/v2`.

## API Principles

- All tenant-owned resources are scoped by organization.
- Project resources are scoped by organization and project.
- Authorization is checked before storage access.
- Response shapes are typed in `@orun/types` or a future generated contract
  package.
- API errors keep the existing error envelope:

```json
{
  "error": "Message",
  "code": "INVALID_REQUEST"
}
```

## Route Groups

```text
/v2/me
/v2/organizations
/v2/organizations/:orgId
/v2/organizations/:orgId/members
/v2/organizations/:orgId/invites
/v2/organizations/:orgId/projects
/v2/organizations/:orgId/projects/:projectId
/v2/organizations/:orgId/projects/:projectId/repositories
/v2/organizations/:orgId/catalog
/v2/organizations/:orgId/runs
/v2/github
/v2/invites
```

## Me And Organization Switching

### GET /v2/me

Auth: dashboard or CLI session.

Returns current user and memberships:

```json
{
  "user": {
    "id": "uuid",
    "email": "a@example.com",
    "displayName": "A User",
    "githubLogin": "octocat"
  },
  "organizations": [
    {
      "id": "uuid",
      "slug": "sourceplane",
      "name": "Sourceplane",
      "role": "owner",
      "permissions": ["org.view", "catalog.view"]
    }
  ]
}
```

The dashboard uses this for org switcher and initial route selection.

## Organizations

### POST /v2/organizations

Auth: dashboard session.

Body:

```json
{
  "name": "Sourceplane",
  "slug": "sourceplane"
}
```

Behavior:

1. Create organization.
2. Create owner membership for caller.
3. Create billing account placeholder.
4. Create default policy set.
5. Create audit event.

Response: `201`.

### GET /v2/organizations

Auth: dashboard or CLI session.

Returns organizations visible to caller.

### GET /v2/organizations/:orgId

Requires `org.view`.

Returns organization detail, billing plan summary, and onboarding state.

### PATCH /v2/organizations/:orgId

Requires `org.update`.

Updates name, slug, and safe settings. Does not update billing.

## Members And Invites

### GET /v2/organizations/:orgId/members

Requires `members.view`.

Returns active members.

### PATCH /v2/organizations/:orgId/members/:userId

Requires `members.manage`.

Updates role or disables member.

Rules:

- Last owner cannot be downgraded or removed.
- A user cannot grant a role above their own grant capability.

### POST /v2/organizations/:orgId/invites

Requires `members.manage`.

Body:

```json
{
  "email": "teammate@example.com",
  "role": "member"
}
```

Returns invite metadata. The raw token may be returned once if the product does
not send email yet. Only token hash is stored.

### POST /v2/invites/:inviteId/accept

Auth: dashboard session.

Body:

```json
{
  "token": "raw-token"
}
```

Creates membership and marks invite accepted.

## Projects

### POST /v2/organizations/:orgId/projects

Requires `project.create`.

Body:

```json
{
  "name": "Platform",
  "slug": "platform",
  "description": "Core platform services"
}
```

Creates project.

### GET /v2/organizations/:orgId/projects

Requires `org.view`.

Returns visible projects.

### GET /v2/organizations/:orgId/projects/:projectId

Requires `project.view`.

Returns project detail, repository count, component count, latest run summary.

### PATCH /v2/organizations/:orgId/projects/:projectId

Requires `project.update`.

## GitHub App And Repositories

### GET /v2/organizations/:orgId/github/install

Requires `github.connect`.

Starts GitHub App installation flow. Returns or redirects to GitHub install URL.

### GET /v2/github/callback

Auth: state verification.

Records GitHub installation and redirects dashboard to repository selection.

### GET /v2/organizations/:orgId/github/installations

Requires `github.connect`.

Returns installations linked to organization.

### GET /v2/organizations/:orgId/github/installations/:installationId/repositories

Requires `github.connect`.

Lists repositories visible to installation.

### POST /v2/organizations/:orgId/projects/:projectId/repositories

Requires `github.connect`.

Body:

```json
{
  "githubInstallationId": "uuid",
  "githubRepositoryId": "123456789",
  "fullName": "sourceplane/orun"
}
```

Behavior:

1. Verify installation belongs to organization.
2. Verify repository belongs to installation.
3. Create or update repository row.
4. Attach repository to project.
5. Create audit event.

### GET /v2/organizations/:orgId/projects/:projectId/repositories

Requires `project.view`.

Returns repositories for project.

## Catalog

### POST /v2/catalog/sync

Auth: GitHub Actions OIDC.

Body: `CatalogSyncEnvelope`.

Behavior:

1. Verify OIDC.
2. Resolve `repository_id` to active repository binding.
3. Resolve organization and project.
4. Validate envelope repo ID and repo slug.
5. Store raw envelope to R2 under V2 path.
6. Insert `catalog_uploads` row in Postgres.
7. Enqueue pointer message for normalization.
8. Return `202`.

Response:

```json
{
  "uploadId": "upl_01hx",
  "acceptedAt": "2026-05-08T00:00:00.000Z",
  "componentCount": 3
}
```

Compatibility:

- `/v1/catalog/sync` can continue to use namespace-only behavior during the
  migration window.
- `/v2/catalog/sync` must require repository binding.

### GET /v2/organizations/:orgId/catalog/components

Requires `catalog.view`.

Query:

- `projectId`
- `repositoryId`
- `q`
- `type`
- `owner`
- `system`
- `tag`
- `status`
- `limit`
- `cursor`

Returns components visible inside the organization.

### GET /v2/organizations/:orgId/catalog/components/:componentId

Requires `catalog.view`.

Returns component detail.

### GET /v2/organizations/:orgId/catalog/components/:componentId/history

Requires `catalog.view`.

Returns catalog events and snapshots.

### GET /v2/organizations/:orgId/catalog/components/:componentId/dependencies

Requires `catalog.view`.

Returns incoming and outgoing relations.

### GET /v2/organizations/:orgId/catalog/components/:componentId/runs

Requires `run.view`.

Returns recent runs touching the component.

## Runs

### POST /v2/runs

Auth: GitHub OIDC or CLI session.

This route creates a run and initializes the Durable Object.

For GitHub OIDC:

- resolve repository binding from OIDC claims
- use repository's organization/project

For CLI:

- require explicit `organizationId`, `projectId`, and repository context when
  creating org/project scoped runs
- allow V1 local namespace compatibility only through `/v1/runs`

Body:

```json
{
  "organizationId": "uuid",
  "projectId": "uuid",
  "repositoryId": "uuid",
  "runId": "optional-client-id",
  "plan": {},
  "dryRun": false,
  "triggerType": "ci"
}
```

Behavior:

1. Authorize actor.
2. Initialize DO with V2 scope.
3. Write plan to R2.
4. Insert run and job rows in Postgres.
5. Optionally write D1 projection.

Response: `201`.

### GET /v2/organizations/:orgId/runs

Requires `run.view`.

Query:

- `projectId`
- `repositoryId`
- `componentId`
- `status`
- `actor`
- `limit`
- `cursor`

### GET /v2/organizations/:orgId/runs/:runId

Requires `run.view`.

Returns Postgres history. If live DO state exists, response may include
`liveState`.

### GET /v2/organizations/:orgId/runs/:runId/jobs

Requires `run.view`.

### GET /v2/organizations/:orgId/runs/:runId/logs/:jobId

Requires `run.view`.

Streams R2 log object after authorization.

### Runner mutation routes

Runner mutation routes must stay workload/CLI-only:

```text
POST /v2/runs/:runId/jobs/:jobId/claim
POST /v2/runs/:runId/jobs/:jobId/update
POST /v2/runs/:runId/jobs/:jobId/heartbeat
POST /v2/runs/:runId/logs/:jobId
```

They must resolve the run scope first, then call the DO keyed by V2 scope.

Dashboard sessions are forbidden.

## Billing

### GET /v2/organizations/:orgId/billing

Requires `billing.manage` or owner. First implementation may return placeholder
plan/status.

### POST /v2/organizations/:orgId/billing/checkout

Deferred until billing integration task.

## Policies

### GET /v2/organizations/:orgId/policies

Requires `policy.view`.

### PUT /v2/organizations/:orgId/policies/:policyKey

Requires `policy.edit`.

## Audit

### GET /v2/organizations/:orgId/audit-events

Requires owner/admin.

Returns audit events.

## V1 Compatibility Adapter

During migration:

- `/v1/accounts/me` maps to user profile and default/personal org.
- `/v1/accounts/repos` maps to repositories visible through default org or
  migrated account overlay.
- `/v1/runs` can read Postgres if backfilled, else D1 fallback.
- `/v1/catalog/components` can read Postgres if backfilled, else D1 fallback.

Do not add new features to V1. Compatibility routes should shrink over time.

## Acceptance Criteria

- V2 route handlers never infer tenant scope from repo namespace alone.
- Every V2 tenant route checks org permission through centralized authz.
- Catalog and run reads are org-scoped.
- CI writes fail if repository is not linked to an organization/project.
- Dashboard sessions cannot claim/update/heartbeat jobs.
- V1 routes keep existing behavior during migration.
