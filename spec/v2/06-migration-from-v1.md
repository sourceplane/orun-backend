# Spec V2-06 - Migration From V1

## Scope

This spec defines the migration from the current V1 implementation to the V2
Supabase/Postgres multi-organization architecture.

Migration must preserve:

- existing CI remote-state behavior
- existing local CLI remote-state behavior during transition
- existing catalog sync behavior during transition
- existing R2 artifacts
- run IDs and job IDs
- GitHub repository IDs

## Current V1 Reality

V1 has:

- D1 primary-ish metadata tables:
  - `namespaces`
  - `accounts`
  - `account_repos`
  - `account_repo_cache`
  - `cli_sessions`
  - `runs`
  - `jobs`
  - catalog tables
  - `tenant_routes`
- R2 paths under `{namespaceId}/...`
- DO keys under `{namespaceId}:{runId}`
- dashboard sessions with `allowedNamespaceIds`
- account/repo visibility overlays
- GitHub OIDC canonical repo namespaces
- CLI local namespaces `local:user:<githubUserId>:repo:<repoId>`

V2 replaces authoritative D1 control-plane state with Postgres and organization
tenancy.

## Migration Phases

### Phase 0 - Freeze V1 Expansion

Rules:

- No new V1-only product features.
- V1 bug fixes and compatibility fixes are allowed.
- New specs/tasks must use `spec/v2`.
- Old specs are reference only.

Deliverables:

- `spec/v2/**`
- orchestrator updated to prioritize V2
- explicit task backlog for V2 foundation

### Phase 1 - Add Postgres Sidecar

Add:

- `packages/db`
- Supabase/Postgres migrations
- local test database setup
- typed DB client
- Tactonic Terraform component for Supabase project/database provisioning
- GitHub Actions `SUPABASE_API_KEY` usage for Supabase Management API access
- local Supabase CLI linkage for developer workflows
- base tables:
  - users
  - user_identities
  - organizations
  - organization_members
  - billing_accounts
  - projects
  - repositories

No production behavior change yet.

Acceptance:

- migrations apply cleanly
- unit tests can run against local test DB or mocked repository layer
- Worker can construct DB client in test/dev

### Phase 2 - Organization Onboarding APIs

Add `/v2` APIs:

- `GET /v2/me`
- `POST /v2/organizations`
- `GET /v2/organizations`
- `GET /v2/organizations/:orgId`
- `POST /v2/organizations/:orgId/projects`

Add Supabase JWT verification for dashboard users.

Acceptance:

- signed-in user can create org
- creator becomes owner
- billing placeholder created
- default policy set created
- audit event created

### Phase 3 - V1 Account Backfill

Create migration/backfill job:

1. For each V1 `accounts` row, create or link `users` and `user_identities`.
2. Create a personal/default organization for each account.
3. Create owner membership.
4. Create billing account placeholder.
5. For each V1 linked canonical repo, create default project if needed.
6. Create `repositories` rows with `github_repository_id = namespace_id`.
7. Preserve namespace slug as `repositories.full_name`.

Backfill local namespaces only as run compatibility metadata. Do not create
canonical repository rows from `namespace_kind='local'`.

Acceptance:

- every V1 account maps to a user and org
- every canonical linked repo maps to repository row
- backfill is idempotent
- backfill can be re-run safely

### Phase 4 - GitHub App Integration

Add:

- GitHub App install start route
- callback route
- installation table writes
- installation repositories listing
- attach repository to project

Deprecate dashboard PAT/link path for SaaS.

Acceptance:

- owner/admin can connect GitHub App
- repository can be attached to project
- audit events emitted
- dashboard never receives or stores GitHub tokens

### Phase 5 - Dual-Write Runs

Update run create/update paths:

- keep V1 D1 writes
- add Postgres writes
- keep existing DO coordination
- write R2 plan using existing V1 path plus optional V2 path

For `/v2/runs`, use V2 DO key and V2 R2 path.

For `/v1/runs`, preserve V1 behavior and write Postgres with `namespace_id_v1`.

Acceptance:

- existing tests pass
- V1 clients still work
- Postgres run rows are populated
- failure to write Postgres is retried or reported without corrupting DO state

### Phase 6 - Dual-Write Catalog

Update catalog sync:

- `/v1/catalog/sync` keeps V1 behavior
- `/v2/catalog/sync` requires repository binding
- catalog queue consumer writes Postgres
- optional D1 projection can continue

Acceptance:

- V2 catalog upload writes Postgres rows
- raw envelope stored in V2 R2 path
- V1 catalog sync still works during migration
- duplicate upload ID is idempotent per organization

### Phase 7 - Dashboard Cutover

Dashboard switches to:

- Supabase auth
- `/v2/me`
- org switcher
- org-scoped catalog APIs
- org-scoped run APIs
- project/repository onboarding

Acceptance:

- current catalog/run UI behavior survives under org scope
- first-time onboarding works
- V1 dashboard session flow can be removed or hidden behind compatibility flag

### Phase 8 - Read Cutover

Change read paths:

- `/v2` reads Postgres only
- `/v1` reads Postgres where backfilled, falls back to D1 only for unmigrated
  data

Acceptance:

- D1 can be unavailable for V2 reads
- all dashboard V2 views function from Postgres
- D1 projection rebuild job exists if projection is used

### Phase 9 - D1 Demotion

D1 becomes:

- V1 compatibility fallback
- projection/cache
- local bootstrap legacy support

No authoritative writes for V2 tenant state.

Acceptance:

- deleting D1 projection rows does not lose V2 data
- projection rebuild succeeds from Postgres/R2
- documentation and orchestrator reflect D1 demotion

### Phase 10 - V1 Deprecation

After V2 parity and migration confidence:

- announce V1 compatibility window
- stop adding V1 fixes except security
- remove V1 dashboard auth flow
- keep V1 runner endpoints as long as old CLI versions require them

## Backfill Details

### Account to organization

For each account:

```text
account.github_login -> user identity
organization.name    -> "<github_login>'s Organization" or imported name
organization.slug    -> normalized github_login with collision suffix
member.role          -> owner
```

### Namespace to repository

For each canonical namespace linked through account repos:

```text
repositories.github_repository_id = namespaces.namespace_id
repositories.full_name            = namespaces.namespace_slug
repositories.project_id           = default/imported project
```

### Runs

For each D1 run:

```text
runs.external_run_id = d1.runs.run_id
runs.namespace_id_v1 = d1.runs.namespace_id
repository lookup    = repositories.github_repository_id == namespace_id
organization lookup  = repository.organization_id
project lookup       = repository.project_id
```

If no repository exists:

- create migration holding org/project for the owning account if linked
- otherwise mark as orphaned V1 run and keep D1 fallback until user links repo

### Catalog

For each D1 catalog component:

```text
components.external_component_id = catalog_components.component_id
repository lookup                = repo_id or namespace_id
current_state_ref                = existing R2 ref
```

Catalog uploads preserve `upload_id` and `envelope_ref`.

## Compatibility Risks

### OIDC ambiguity

If one GitHub repo maps to multiple V2 organizations, OIDC claims alone are
ambiguous. MVP must prevent multiple active org bindings per GitHub repo or
require explicit signed org/project context.

### Local CLI namespaces

Local namespaces are user-scoped and do not map cleanly to organization-owned
repositories. Keep local remote-state under V1 compatibility until a V2 local
developer workflow is designed.

### R2 path split

Existing artifacts live under V1 keys. Do not move them eagerly. Store old refs
and read them when old rows point at them. New V2 writes use V2 paths.

### D1 JOIN assumptions

V1 D1 catalog queries join `namespaces` with catalog tables in the same DB.
Do not carry that pattern into V2 projections. Denormalize display fields in
projection tables.

## Task Backlog For Orchestrator

Suggested first V2 tasks:

1. Create `packages/db` and Postgres migration harness.
2. Add Tactonic Terraform component and CI provisioning workflow for Supabase.
3. Implement V2 core schema migrations.
4. Add Supabase JWT verification and `GET /v2/me`.
5. Implement organization create/list/get service and APIs.
6. Implement project create/list APIs.
7. Implement GitHub App installation persistence and repo attach APIs.
8. Implement V1 account/repo backfill tool.
9. Add V2 run persistence dual-write.
10. Add V2 catalog persistence dual-write.
11. Cut dashboard to V2 onboarding and org switcher.

## Acceptance Criteria

- Migration can be executed incrementally.
- Every phase has rollback or compatibility behavior.
- V1 clients are not broken before explicit deprecation.
- Postgres becomes authoritative before D1 is demoted.
- Organization tenancy is present before adding billing, invites, or policies.
- GitHub App flow replaces PAT-based dashboard repo linking for SaaS.
- Supabase provisioning uses `SUPABASE_API_KEY` and the Tactonic Terraform
  component contract before shared environments depend on Postgres.
