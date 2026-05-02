import type { Namespace } from "@orun/types";
import { OrunError } from "./errors";

export async function upsertNamespaceSlug(
  db: D1Database,
  namespace: Namespace,
  now?: Date,
): Promise<void> {
  const ts = (now ?? new Date()).toISOString();
  await db
    .prepare(
      `INSERT INTO namespaces (namespace_id, namespace_slug, last_seen_at)
       VALUES (?1, ?2, ?3)
       ON CONFLICT(namespace_id) DO UPDATE SET
         namespace_slug = excluded.namespace_slug,
         last_seen_at = excluded.last_seen_at`,
    )
    .bind(namespace.namespaceId, namespace.namespaceSlug, ts)
    .run();
}
