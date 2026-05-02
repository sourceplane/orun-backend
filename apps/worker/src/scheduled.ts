import type { Env } from "@orun/types";
import { D1Index } from "@orun/storage";
import { R2Storage } from "@orun/storage";
import { getCoordinator, coordinatorFetch } from "./coordinator";

export async function handleScheduled(env: Env, ctx: ExecutionContext): Promise<void> {
  const now = new Date().toISOString();
  const db = new D1Index(env.DB);
  const r2 = new R2Storage(env.STORAGE);

  const result = await env.DB
    .prepare("SELECT namespace_id, run_id FROM runs WHERE expires_at <= ?1")
    .bind(now)
    .all<{ namespace_id: string; run_id: string }>();

  const expiredRuns = result.results ?? [];

  const cleanupPromises = expiredRuns.map(async (row) => {
    try {
      const stub = getCoordinator(env, row.namespace_id, row.run_id);
      await coordinatorFetch(stub, "/cancel", { method: "POST" });
    } catch {}

    try {
      await r2.deleteRun(row.namespace_id, row.run_id);
    } catch {}
  });

  ctx.waitUntil(Promise.all(cleanupPromises));
  await db.deleteExpiredRuns(now);
}
