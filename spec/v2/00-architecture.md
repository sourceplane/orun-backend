# Spec V2-00 - Product Architecture

## Scope

This spec defines the V2 architecture for Orun SaaS. It supersedes the V1
Cloudflare-only control-plane architecture for all new roadmap work.

V1 behavior remains important because the codebase already implements:

- GitHub Actions OIDC workload auth
- Orun-issued dashboard and CLI sessions
- Durable Object run coordination
- R2 artifact storage
- D1 run/catalog/account indexes
- Queue-backed catalog ingestion
- Catalog-first dashboard views

V2 keeps the strong Cloudflare execution model, but moves tenant-owned
relational data to Supabase Postgres.

Provisioning and operations are part of the V2 architecture contract. Supabase
project/database resources are provisioned through the Tactonic Terraform
component described in `spec/v2/07-provisioning-and-operations.md`; application
tables are managed by `packages/db` migrations.

## Core Decision

Postgres is the primary system of record for Orun SaaS.

D1 is no longer the long-term control-plane database. D1 may still be used for
small edge-local projections, public read caches, latest catalog snapshots, and
temporary compatibility views. D1 data must be rebuildable from Postgres, R2,
Durable Objects, or ingestion events.

## System Topology

```text
GitHub App / GitHub Actions / CLI / Dashboard
                 |
                 v
Cloudflare Worker API
                 |
    +------------+-------------+----------------+
    |                          |                |
    v                          v                v
Supabase Postgres             R2          Durable Objects
primary relational state      blobs       live run state
    |                          |                |
    v                          v                v
orgs, users, projects,        plans       job claims
repositories, components,     logs        heartbeats
runs, billing, policies       catalog     locks
    |
    v
D1/KV projections and caches
    |
    v
Dashboard fast reads where useful
```

## Product Boundaries

### Organization

The organization is the tenant. It owns:

- membership
- billing
- security policy
- GitHub installation linkage
- projects
- repositories
- catalog data
- runs
- audit events
- usage events

Every tenant-owned row must carry `organization_id`.

### Project

A project is the primary work boundary inside an organization. A project groups
one or more repositories, components, environments, stacks, runs, and policies.

Project-owned rows must carry both `organization_id` and `project_id`.

### Repository

A repository is a GitHub repository linked to a project. The GitHub numeric
repository ID remains immutable and important, but it is no longer the tenant
boundary.

### Component

A component is a catalog entity derived from Git-owned source descriptors and
Orun plan output. The dashboard may edit annotations only when a future policy
explicitly allows it. Git remains source of truth.

### Run

A run is execution history for an Orun plan. Live run state lives in Durable
Objects. Persistent run history lives in Postgres. Large artifacts live in R2.

## Non-Negotiable Principles

### 1. Postgres is authoritative for SaaS control-plane state

Authoritative tenant data lives in Supabase Postgres:

- organizations
- members
- invites
- projects
- repositories
- GitHub installations
- catalog indexes
- runs/jobs/steps history
- billing
- usage
- audit
- policy

D1 rows must never be the only copy of these records after V2 cutover.

### 2. Durable Objects remain authoritative for live coordination

The Worker and runners must make live claim/update/heartbeat decisions through
Durable Objects, not Postgres, D1, or R2.

Postgres stores the durable run history and query index after coordination
events occur.

### 3. R2 remains artifact storage

R2 stores:

- `plan.json`
- job logs
- raw catalog sync envelopes
- component state snapshots
- run state snapshots
- raw webhook payloads when useful

R2 must not be polled to decide coordination state.

### 4. D1 is projection/cache only

D1 may store:

- latest catalog projection
- project summary projection
- tenant edge cache
- small per-region lookup tables
- public dashboard snapshots

D1 must not store:

- authoritative org membership
- authoritative billing
- authoritative policy
- authoritative catalog history
- authoritative run history

### 5. GitHub repository ID remains immutable repository identity

The numeric GitHub `repository_id` remains the stable repository identity. It is
stored on `repositories.github_repository_id` and used for OIDC validation,
rename handling, and migration from V1 namespaces.

It must not be used as a replacement for `organization_id`.

### 6. Auth and authorization are separate

Authentication answers "who is this actor?"

Authorization answers "what can this actor do inside this organization and
project?"

Dashboard users authenticate through Supabase Auth. CI workloads authenticate
through GitHub Actions OIDC. CLI users authenticate through Orun-issued CLI
tokens backed by GitHub identity. All product authorization resolves through
Postgres organization membership, repository linkage, and role/policy checks.

### 7. GitHub App is the SaaS repo integration path

The dashboard must not ask users to paste personal access tokens. Repo linking
for SaaS must use a GitHub App installation flow. The existing
`X-GitHub-Access-Token` repo-link path is V1 compatibility only.

### 8. Workers stay thin

Workers may authenticate, authorize, validate, route, and call typed service
methods. They must not become a large business-logic layer.

Business operations belong in typed service modules such as:

- `OrganizationsService`
- `ProjectsService`
- `RepositoriesService`
- `RunsService`
- `CatalogService`
- `BillingService`
- `AuditService`

### 9. Pooled tenancy first, bridge model later

Free, Pro, and Team tenants use one shared Postgres database with
`organization_id` on every row.

Enterprise tenants may later move to dedicated schemas, clusters, regions, or
databases through a bridge model. Do not build per-tenant databases as the first
implementation.

## Data Placement

| Data | V2 store |
| --- | --- |
| Users | Supabase Auth plus Postgres profile tables |
| Organizations | Postgres |
| Members and invites | Postgres |
| Billing and Stripe mapping | Postgres |
| Policies and RBAC | Postgres |
| Projects and repositories | Postgres |
| GitHub App installations | Postgres |
| Latest catalog index | Postgres, optional D1 projection |
| Full catalog envelope JSON | R2 |
| Component state snapshots | R2, indexed in Postgres |
| Run/job/step history | Postgres |
| Live job locks and heartbeats | Durable Objects |
| Large logs | R2 |
| Usage and audit events | Postgres first, warehouse later |
| Edge read cache | D1 or KV |

## Technology Decisions

| Concern | V2 technology | Notes |
| --- | --- | --- |
| API edge | Cloudflare Workers | Existing Worker remains API gateway |
| Dashboard | Cloudflare Pages + React | Existing dashboard evolves |
| Primary database | Supabase Postgres | Source of truth for SaaS control plane |
| Worker DB access | Hyperdrive + Postgres driver | Pooled access from Workers |
| Human auth | Supabase Auth with GitHub provider | Dashboard auth |
| CI auth | GitHub Actions OIDC | Keep existing workload trust model |
| CLI auth | Orun access/refresh tokens | Stored in Postgres, scoped by org/project |
| Live coordination | Durable Objects | Keep existing run coordinator model |
| Artifacts | R2 | Keep existing artifact plane |
| Async ingestion | Queues | Expand current catalog queue model |
| Projections | D1/KV | Optional, derived, rebuildable |
| Provisioning | Terraform/Tactonic | Supabase project/database and platform resource wiring |
| Operations | gh, wrangler, supabase CLI | Authenticated operational tools for repo, Cloudflare, and Supabase |

## Operational Access

Implementation and verification agents may assume authenticated access to:

- `gh` for GitHub pull requests, Actions, check logs, and repository metadata
- `wrangler` for Cloudflare deploys, resource inspection, and binding checks
- `supabase` CLI locally, already logged in to the appropriate Supabase account

GitHub Actions must expose `SUPABASE_API_KEY` as the canonical Supabase
Management API secret for Terraform/Tactonic provisioning. If these tools or
credentials are unavailable, the agent must ask for clarification or report the
blocker rather than inventing a different credential path.

## Current V1 to V2 Concept Mapping

| V1 concept | V2 concept |
| --- | --- |
| `accounts` | `users` plus organization memberships |
| `account_repos` | repository grants through org/project membership and GitHub installation repositories |
| `namespaces.namespace_id` | `repositories.github_repository_id` |
| `allowedNamespaceIds` | derived org/project/repo permissions, not JWT source of truth |
| D1 `runs` and `jobs` | Postgres `runs`, `jobs`, `steps`; optional D1 projection |
| D1 catalog tables | Postgres catalog tables; optional D1 latest projection |
| repo admin visibility | org role and policy authorization |
| `/v1/accounts/*` | `/v2/organizations/*`, `/v2/projects/*`, `/v2/repositories/*` |

## Compatibility Position

V1 endpoints continue to exist during migration. They may resolve the caller into
a personal/default organization and use V2 services internally.

New capabilities must be V2-only unless there is an explicit compatibility
task.

## Acceptance Criteria For Architecture Migration

- A new organization can be created after sign-in.
- The creator becomes organization owner.
- A project can be created inside that organization.
- A GitHub installation can be linked to that organization.
- A repository can be attached to a project.
- CI OIDC writes resolve to exactly one organization/project/repository.
- Catalog sync writes authoritative rows to Postgres and artifacts to R2.
- Runs coordinate through DO and persist history to Postgres.
- Dashboard reads are org-scoped.
- D1 can be deleted and rebuilt without losing authoritative SaaS data.
