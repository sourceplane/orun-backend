# Spec V2-01 - Supabase Postgres Data Model

## Scope

This spec defines the authoritative V2 relational model. It is implemented in
Supabase Postgres and accessed by the Worker through a typed database layer.

The model starts pooled multi-tenant:

```text
one Postgres database
many organizations
organization_id on every tenant-owned row
Worker authorization on every request
RLS defense in depth where direct Supabase access exists
```

## Database Package

Add a new package:

```text
packages/db
```

Responsibilities:

- own Postgres migration files
- expose typed query helpers and stores
- hide SQL details from Worker handlers
- provide transactional helpers
- provide test fixtures for services

Suggested structure:

```text
packages/db/
  src/
    client.ts
    ids.ts
    organizations.ts
    users.ts
    projects.ts
    repositories.ts
    runs.ts
    catalog.ts
    billing.ts
    audit.ts
    policies.ts
  migrations/
    0001_core.sql
    0002_auth_membership.sql
    0003_projects_repositories.sql
    0004_runs_catalog.sql
    0005_billing_audit_policy.sql
```

Existing D1 migrations remain in `migrations/` for V1 compatibility and
projection state.

## ID Strategy

Use UUID primary keys for internal records:

```sql
id uuid primary key default gen_random_uuid()
```

For public API IDs, the API may return UUIDs directly or add prefixed IDs later
(`org_`, `proj_`, `repo_`). Do not block V2 on custom ID generation.

Use immutable external IDs for provider resources:

- `github_user_id text`
- `github_installation_id text`
- `github_repository_id text`

## Common Columns

Tenant-owned tables must include:

```sql
organization_id uuid not null references organizations(id)
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
deleted_at timestamptz
```

Project-owned tables must also include:

```sql
project_id uuid not null references projects(id)
```

Indexes must start with `organization_id` for tenant-scoped queries.

## Core Tables

### users

Application profile table. Supabase Auth remains the authentication provider.

```sql
create table users (
  id uuid primary key,
  email text,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

`users.id` should match Supabase Auth user UUID when Supabase Auth is used.

### user_identities

Links Supabase/Auth users to external provider identities.

```sql
create table user_identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  provider text not null,
  provider_user_id text not null,
  provider_login text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_user_id),
  unique (user_id, provider)
);
```

Initial providers:

- `github`

### organizations

```sql
create table organizations (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  created_by_user_id uuid references users(id),
  provisioning_mode text not null default 'shared',
  lifecycle_status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (provisioning_mode in ('shared', 'dedicated_schema', 'dedicated_database')),
  check (lifecycle_status in ('active', 'suspended', 'deleted'))
);
```

`provisioning_mode` is for the later bridge model. Only `shared` is required in
the first V2 implementation.

### organization_members

```sql
create table organization_members (
  organization_id uuid not null references organizations(id),
  user_id uuid not null references users(id),
  role text not null,
  status text not null default 'active',
  invited_by_user_id uuid references users(id),
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id),
  check (role in ('owner', 'admin', 'member', 'viewer')),
  check (status in ('active', 'disabled'))
);
```

Minimum role semantics:

| Action | Owner | Admin | Member | Viewer |
| --- | --- | --- | --- | --- |
| Manage billing | yes | no | no | no |
| Manage members | yes | yes | no | no |
| Invite members | yes | yes | no | no |
| Connect GitHub | yes | yes | no | no |
| Create project | yes | yes | yes | no |
| View catalog | yes | yes | yes | yes |
| Trigger run | yes | yes | yes | no |
| Edit policy | yes | yes | no | no |

### organization_invites

```sql
create table organization_invites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  email text not null,
  role text not null,
  token_hash text not null unique,
  invited_by_user_id uuid not null references users(id),
  accepted_by_user_id uuid references users(id),
  accepted_at timestamptz,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (role in ('owner', 'admin', 'member', 'viewer'))
);

create index idx_org_invites_org on organization_invites(organization_id, created_at desc);
create index idx_org_invites_email on organization_invites(lower(email));
```

Invite acceptance must be idempotent by invite ID and token hash.

## Billing Tables

### billing_accounts

```sql
create table billing_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references organizations(id),
  provider text not null default 'stripe',
  provider_customer_id text,
  plan text not null default 'free',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (provider in ('stripe', 'manual')),
  check (plan in ('free', 'pro', 'team', 'enterprise')),
  check (status in ('active', 'past_due', 'cancelled', 'trialing'))
);
```

Billing can start as a placeholder. The row should still be created with the
organization so usage and entitlements have a stable join point.

### entitlements

```sql
create table entitlements (
  organization_id uuid not null references organizations(id),
  key text not null,
  value jsonb not null,
  source text not null default 'system',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, key)
);
```

Use entitlements for limits such as max projects, max repositories, retention,
and run concurrency.

## Project And Repository Tables

### projects

```sql
create table projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  slug text not null,
  name text not null,
  description text,
  default_branch text,
  lifecycle_status text not null default 'active',
  created_by_user_id uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (organization_id, slug),
  check (lifecycle_status in ('active', 'archived', 'deleted'))
);

create index idx_projects_org on projects(organization_id, created_at desc);
```

### github_installations

```sql
create table github_installations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  github_installation_id text not null,
  github_account_id text not null,
  github_account_login text not null,
  github_account_type text,
  installed_by_user_id uuid references users(id),
  permissions_json jsonb not null default '{}'::jsonb,
  repository_selection text,
  suspended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (github_installation_id),
  unique (organization_id, github_installation_id)
);

create index idx_github_installations_org on github_installations(organization_id);
```

### repositories

```sql
create table repositories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  project_id uuid not null references projects(id),
  github_installation_id uuid references github_installations(id),
  provider text not null default 'github',
  github_repository_id text not null,
  full_name text not null,
  owner_login text,
  name text,
  default_branch text,
  visibility text,
  linked_by_user_id uuid references users(id),
  active boolean not null default true,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (organization_id, github_repository_id),
  check (provider in ('github'))
);

create index idx_repositories_org_project on repositories(organization_id, project_id);
create index idx_repositories_github_id on repositories(github_repository_id);
```

MVP recommendation: prevent the same active GitHub repository from being linked
to multiple organizations unless CI provides explicit org/project routing. This
avoids OIDC ambiguity.

If product requirements later allow the same GitHub repository in multiple Orun
organizations, CI writes must include signed `organization_id` and `project_id`
context, and the Worker must validate that context against the GitHub
installation and repository binding.

## Catalog Tables

### catalog_uploads

```sql
create table catalog_uploads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  project_id uuid not null references projects(id),
  repository_id uuid not null references repositories(id),
  upload_id text not null,
  commit_sha text not null,
  branch text,
  workflow_run_id text,
  workflow_ref text,
  pr_number integer,
  envelope_ref text not null,
  component_count integer not null,
  received_at timestamptz not null default now(),
  normalized_at timestamptz,
  status text not null default 'accepted',
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  unique (organization_id, upload_id),
  check (status in ('accepted', 'normalizing', 'normalized', 'failed'))
);

create index idx_catalog_uploads_repo on catalog_uploads(organization_id, repository_id, received_at desc);
```

### components

```sql
create table components (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  project_id uuid not null references projects(id),
  repository_id uuid not null references repositories(id),
  external_component_id text not null,
  name text not null,
  title text,
  description text,
  type text not null,
  owner text,
  system text,
  lifecycle text,
  repo_path text not null,
  tags text[] not null default '{}',
  latest_plan_id text,
  latest_plan_checksum text,
  latest_commit_sha text not null,
  latest_status text not null default 'unknown',
  current_state_ref text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, repository_id, external_component_id)
);

create index idx_components_org_seen on components(organization_id, last_seen_at desc);
create index idx_components_project on components(organization_id, project_id, last_seen_at desc);
create index idx_components_repo on components(organization_id, repository_id, name);
create index idx_components_owner on components(organization_id, owner);
create index idx_components_type on components(organization_id, type);
```

`external_component_id` is the component ID from the catalog sync envelope, for
example `github:<repoId>:<name>`.

### component_snapshots

```sql
create table component_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  project_id uuid not null references projects(id),
  repository_id uuid not null references repositories(id),
  component_id uuid not null references components(id),
  upload_id uuid not null references catalog_uploads(id),
  commit_sha text not null,
  state_ref text not null,
  state_hash text,
  generated_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_component_snapshots_component on component_snapshots(organization_id, component_id, created_at desc);
```

### component_relations

```sql
create table component_relations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  project_id uuid not null references projects(id),
  source_component_id uuid not null references components(id),
  relation_key text not null,
  relation_type text not null,
  target_kind text not null,
  target_ref text not null,
  target_component_id uuid references components(id),
  environment text,
  job_id text,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (organization_id, source_component_id, relation_key)
);

create index idx_component_relations_source on component_relations(organization_id, source_component_id);
create index idx_component_relations_target on component_relations(organization_id, target_kind, target_ref);
```

`relation_key` must be deterministic from:

```text
source_component_id, relation_type, target_kind, target_ref, environment, job_id
```

### component_events

```sql
create table component_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  project_id uuid not null references projects(id),
  repository_id uuid not null references repositories(id),
  component_id uuid not null references components(id),
  upload_id uuid references catalog_uploads(id),
  event_type text not null,
  commit_sha text not null,
  pr_number integer,
  summary text,
  payload_ref text,
  created_at timestamptz not null default now(),
  check (event_type in ('created', 'updated', 'changed', 'pr_changed', 'synced', 'archived'))
);

create index idx_component_events_component on component_events(organization_id, component_id, created_at desc);
```

## Run Tables

### runs

```sql
create table runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  project_id uuid not null references projects(id),
  repository_id uuid references repositories(id),
  external_run_id text not null,
  namespace_id_v1 text,
  status text not null default 'pending',
  plan_checksum text,
  trigger_type text,
  actor_user_id uuid references users(id),
  actor_label text,
  dry_run boolean not null default false,
  plan_ref text,
  job_total integer not null default 0,
  job_done integer not null default 0,
  job_failed integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  expires_at timestamptz,
  unique (organization_id, external_run_id)
);

create index idx_runs_org_status on runs(organization_id, status, created_at desc);
create index idx_runs_project on runs(organization_id, project_id, created_at desc);
create index idx_runs_repo on runs(organization_id, repository_id, created_at desc);
```

`external_run_id` preserves the run ID used by CLI/CI. `namespace_id_v1` keeps
the old namespace during migration.

### jobs

```sql
create table jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  project_id uuid not null references projects(id),
  run_id uuid not null references runs(id),
  external_job_id text not null,
  component_id uuid references components(id),
  component_name text,
  status text not null default 'pending',
  runner_id text,
  started_at timestamptz,
  finished_at timestamptz,
  heartbeat_at timestamptz,
  last_error text,
  log_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, run_id, external_job_id)
);

create index idx_jobs_run on jobs(organization_id, run_id);
create index idx_jobs_component on jobs(organization_id, component_id, created_at desc);
```

### steps

```sql
create table steps (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  project_id uuid not null references projects(id),
  run_id uuid not null references runs(id),
  job_id uuid not null references jobs(id),
  external_step_id text not null,
  uses text,
  status text,
  started_at timestamptz,
  finished_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, job_id, external_step_id)
);
```

Steps may be deferred until the first feature needs step-level history.

## Policy Tables

### policies

```sql
create table policies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  project_id uuid references projects(id),
  key text not null,
  name text not null,
  description text,
  policy_json jsonb not null,
  enabled boolean not null default true,
  created_by_user_id uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, project_id, key)
);
```

### audit_events

```sql
create table audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id),
  actor_user_id uuid references users(id),
  actor_label text,
  action text not null,
  resource_type text,
  resource_id text,
  metadata jsonb not null default '{}'::jsonb,
  ip_hash text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index idx_audit_events_org on audit_events(organization_id, created_at desc);
```

Audit events are append-only.

### usage_events

```sql
create table usage_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  project_id uuid references projects(id),
  event_type text not null,
  quantity numeric not null default 1,
  unit text,
  dimensions jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index idx_usage_events_org on usage_events(organization_id, occurred_at desc);
```

Usage events are append-only and can later stream to a warehouse.

## CLI Session Tables

### cli_sessions

Move the existing D1 CLI session table to Postgres:

```sql
create table cli_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  github_user_id text,
  github_login text not null,
  refresh_token_hash text not null unique,
  allowed_repository_ids_json jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  user_agent text,
  device_label text
);

create index idx_cli_sessions_user on cli_sessions(user_id);
create index idx_cli_sessions_expires on cli_sessions(expires_at);
```

The refresh token still stores only a hash.

## D1 Projection Tables

Projection tables are optional and rebuildable. Suggested D1 projection schema:

```sql
tenant_edge_cache(
  organization_id text,
  cache_key text,
  value_json text,
  updated_at text,
  primary key (organization_id, cache_key)
)

latest_catalog_projection(
  organization_id text,
  project_id text,
  component_id text,
  component_json text,
  last_seen_at text,
  primary key (organization_id, component_id)
)

project_summary_projection(
  organization_id text,
  project_id text,
  summary_json text,
  updated_at text,
  primary key (organization_id, project_id)
)
```

Do not query projection tables for authorization.

## RLS And Worker Authorization

Worker-side authorization is mandatory for all API requests.

RLS is recommended as defense in depth, especially if any direct Supabase client
access is introduced. If the Worker uses pooled Postgres connections through
Hyperdrive, do not rely on persistent session variables. If RLS is used from
the Worker, set request context with `set local` inside a transaction and reset
it automatically at transaction end.

Required invariant even without RLS:

```text
Every query touching tenant data includes organization_id from an authorized
RequestContext.
```

## V1 Backfill Mapping

| V1 table/field | V2 destination |
| --- | --- |
| `accounts.github_login` | `users`, `user_identities.provider_login` |
| `accounts.github_user_id` | `user_identities.provider_user_id` |
| `account_repos.account_id` | `organization_members.user_id` in personal/default org |
| `account_repos.namespace_id` | `repositories.github_repository_id` |
| `namespaces.namespace_slug` | `repositories.full_name` |
| `namespaces.namespace_kind='local'` | `runs.namespace_id_v1` for local migration only |
| `runs.namespace_id` | `runs.namespace_id_v1`, joined to `repositories.github_repository_id` where canonical |
| `runs.run_id` | `runs.external_run_id` |
| `jobs.job_id` | `jobs.external_job_id` |
| `catalog_components.component_id` | `components.external_component_id` |
| `catalog_uploads.envelope_ref` | `catalog_uploads.envelope_ref` |
| R2 keys under `{namespace_id}/...` | keep readable, write new keys under org/project prefix |

## Acceptance Criteria

- Every authoritative tenant table has `organization_id`.
- Every project-owned table has `organization_id` and `project_id`.
- Repository rows preserve GitHub numeric repo IDs.
- Old D1 data can be mapped without losing run IDs, job IDs, repo IDs, or R2 refs.
- No dashboard authorization query depends on D1.
- D1 projections are documented as rebuildable.
