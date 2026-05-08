import type { Env } from "@orun/types";
import { D1StorageRouter } from "@orun/storage";
import type { StorageRouter } from "@orun/storage";

export function makeStorageRouter(env: Env): StorageRouter {
  const catalogShards: D1Database[] = [];
  if (env.DB_CATALOG_0) catalogShards.push(env.DB_CATALOG_0);
  if (env.DB_CATALOG_1) catalogShards.push(env.DB_CATALOG_1);

  return new D1StorageRouter({
    coreDb: env.DB,
    catalogShards: catalogShards.length > 0 ? catalogShards : undefined,
    catalogQueue: env.CATALOG_INGEST_QUEUE,
  });
}
