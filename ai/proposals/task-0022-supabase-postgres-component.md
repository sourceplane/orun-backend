# Proposal: supabase-postgres Composition Type for stack-tectonic

## Status

Draft — produced by task-0022 implementer on 2026-05-08.

## Background

Task-0022 requires a `supabase-postgres` / `orun_supabase_database` Tactonic
component type as specified in `spec/v2/07-provisioning-and-operations.md`.

Inspection of `.orun/compositions.lock.yaml` for `stack-tectonic:0.12.0`
shows the following exported composition types:

- cloudflare-pages
- cloudflare-pages-terraform
- cloudflare-pages-turbo
- cloudflare-pages-turbo-terraform
- cloudflare-worker
- cloudflare-worker-turbo
- helm-chart
- helm-values
- terraform
- turbo-package
- workspace

There is no `supabase-postgres` composition type in the current stack.

## Current Implementation

Task-0022 uses the generic `terraform` composition to scaffold the Supabase
provisioning component under `infra/supabase/`. The `infra/supabase/component.yaml`
describes the intended Tactonic component shape using this generic composition.

The `infra/` directory is not currently in the Orun discovery roots
(`apps/`, `packages/`). The Terraform scaffold is invoked directly by the
on-demand `.github/workflows/v2-db-provision.yml` workflow, not by
`orun plan --changed`.

## Proposed Changes

### Option A: Add supabase-postgres to stack-tectonic (preferred)

Request the Sourceplane platform team to add a `supabase-postgres` composition
type to `stack-tectonic:0.13.x` that:

- Accepts the inputs defined in `spec/v2/07-provisioning-and-operations.md`
- Produces the required outputs
- Uses `SUPABASE_API_KEY` as the canonical secret reference
- Manages state via the Tactonic-approved remote backend
- Is safe for `orun plan --changed` discovery

Once available, `infra/supabase/component.yaml` would change its composition
reference from `terraform` to `supabase-postgres`, and `infra/` could be added
to `intent.yaml` discovery roots.

### Option B: Activate infra/ discovery with generic terraform composition

Add `infra/` to the `discovery.roots` list in `intent.yaml`:

```yaml
discovery:
  roots:
    - apps/
    - packages/
    - infra/
```

This brings `infra/supabase/` under `orun plan --changed`. The `component.yaml`
already uses the generic `terraform` composition. Remote state backend must be
configured before staging/production applies.

## Blocking Criteria

This proposal is non-blocking for task-0022 because:

- The `infra/supabase/` Terraform scaffold correctly models the V2 contract
- The on-demand provisioning workflow invokes Terraform directly
- The real Postgres migration smoke does not require Supabase provisioning

A first-class `supabase-postgres` composition type is required before Tactonic
owns the Supabase project lifecycle in shared environments.

## References

- `spec/v2/07-provisioning-and-operations.md`
- `.orun/compositions.lock.yaml`
- `infra/supabase/component.yaml`
- `intent.yaml`
