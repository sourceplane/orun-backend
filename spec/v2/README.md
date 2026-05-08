# Orun Backend V2 Specs

## Status

These V2 specs are the active product and architecture contract for Orun SaaS.
The V1 specs in `spec/*.md` remain historical reference for implemented
Cloudflare/D1 behavior, endpoint compatibility, and migration context only.

New implementation tasks must read V2 first. A worker may consult V1 only to
understand current code behavior, compatibility obligations, or a migration
edge case. V1 must not be used to justify adding new product surface that
conflicts with V2.

## V2 Goal

Move Orun from a repo-namespace coordination backend into a multi-organization
SaaS control plane:

```text
Cloudflare Workers / Pages -> app and API edge
Supabase Postgres          -> primary relational system of record
Supabase Auth              -> dashboard human auth
Cloudflare Hyperdrive      -> pooled Worker-to-Postgres access
Cloudflare R2              -> immutable plans, logs, catalog envelopes, snapshots
Cloudflare Durable Objects -> live run coordination, locks, heartbeats
Cloudflare Queues          -> async ingestion and projection work
D1 / KV                    -> optional edge projections and caches only
Terraform / Tactonic       -> Supabase and platform resource provisioning
gh / wrangler / supabase   -> operational CLIs for repo, Cloudflare, Supabase
```

The durable product model is:

```text
Organization = tenant, billing, membership, security boundary
Project      = platform/repo/product boundary inside an organization
Repository   = GitHub source repository linked to one project
Component    = catalog entity derived from Git
Run          = execution and plan history
Stack        = platform realization model
```

## Read Order

1. `spec/v2/00-architecture.md`
2. `spec/v2/01-data-model.md`
3. `spec/v2/02-auth-and-authorization.md`
4. `spec/v2/03-worker-api.md`
5. `spec/v2/04-storage-and-ingestion.md`
6. `spec/v2/05-onboarding-dashboard.md`
7. `spec/v2/06-migration-from-v1.md`
8. `spec/v2/07-provisioning-and-operations.md`

## Migration Rule

V2 is not a rewrite from scratch. Existing behavior must be migrated
intentionally:

- GitHub Actions OIDC remains valid for CI/workload writes.
- Durable Objects remain authoritative for live run coordination.
- R2 remains the artifact plane.
- Existing `/v1` endpoints remain during migration.
- Existing D1 rows are backfilled into Postgres, then D1 becomes projection.
- Existing repo namespace IDs remain as immutable GitHub repository IDs, but
  they become repository identity, not tenant identity.
- Supabase project/database provisioning is managed through the Tactonic
  Terraform component defined in `spec/v2/07-provisioning-and-operations.md`.

## Operational Assumptions

Agents and GitHub Actions are expected to have operational access to:

- `gh` for GitHub PRs, checks, logs, workflow runs, and repository inspection.
- `wrangler` for Cloudflare Worker/Pages/resource deploy and inspection.
- `supabase` CLI for local Supabase project linkage and database migration
  workflows.

GitHub Actions must provide `SUPABASE_API_KEY` as an Actions secret for
Supabase Management API and Terraform provisioning tasks. Local developer
environments are assumed to have the Supabase CLI already logged in. If any of
these assumptions fail in practice, stop and ask or record the blocker instead
of inventing a credential workaround.

## Old Spec Reference Map

Use old specs as reference only:

| Old spec | Reference purpose in V2 |
| --- | --- |
| `spec/04-worker-api.md` | Existing `/v1` endpoint behavior and compatibility |
| `spec/05-coordinator-do.md` | Durable Object live coordination behavior |
| `spec/06-auth.md` | Current GitHub OIDC, OAuth, and CLI token implementation |
| `spec/07-storage.md` | Current D1/R2/Queue helper behavior and known sharding seams |
| `spec/08-account-repo-linking.md` | Current account/repo visibility overlay to migrate away from |
| `spec/11-dashboard-ui.md` | Existing catalog-first dashboard surface |
| `spec/12-catalog-index.md` | Existing catalog sync envelope and normalization behavior |

## Non-Goals

- Do not start with one database per tenant.
- Do not make D1 the primary SaaS control-plane database.
- Do not let dashboard sessions claim or mutate live jobs directly.
- Do not store GitHub tokens, Cloudflare tokens, or pipeline secrets as durable
  first-class data.
- Do not make the dashboard the source of truth for catalog components. Git
  remains authoritative.
