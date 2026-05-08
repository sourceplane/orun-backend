# Proposal: Cross-Shard JOIN Limitation for Catalog Tables

## Context

Task 0016 introduces catalog shard routing. The existing catalog SQL queries JOIN `catalog_components` with `namespaces` (and `catalog_component_events` with `namespaces`) within the same D1 database:

```sql
SELECT cc.*, n.namespace_slug
FROM catalog_components cc
JOIN namespaces n ON n.namespace_id = cc.namespace_id
WHERE cc.component_id = ?1 AND cc.namespace_id IN (...)
```

When catalog tables reside in a shard D1 and namespaces reside in the core D1, this JOIN fails because SQLite cannot cross database boundaries.

## Options

1. **Duplicate namespace slugs into catalog shards.** On every `upsertNamespace` call in the core DB, also upsert a minimal row into each touched catalog shard. Trade-off: extra writes and eventual consistency between core and shards; query code stays simple.

2. **Remove the JOIN; do a two-phase lookup.** Query the catalog shard for component/event rows (without namespace_slug), then join the slug in application code from the core DB. Trade-off: extra round-trip; query code changes in `D1Index`.

3. **Store `namespace_slug` denormalized in catalog tables.** Add `namespace_slug TEXT` columns to `catalog_components` and `catalog_component_events` and populate on write. Trade-off: slug can become stale on repo rename (mitigated by lazy update on sync); simplest query path for sharded reads.

## Recommendation

Option 3 (denormalized slug column) is the most operationally simple and aligns with the existing lazy-update pattern (the slug is already stored alongside `namespace_id` in most rows). A future migration can add `namespace_slug` to the catalog tables and remove the JOIN from the affected queries.

## Impact

No changes needed today. The single-DB fallback makes the JOIN work correctly in all current deployments. This proposal should be actioned before any multi-shard D1 catalog deployment.
