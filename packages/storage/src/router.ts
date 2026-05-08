import type { CatalogIngestMessage, CatalogQueue } from "@orun/types";

export type { CatalogIngestMessage, CatalogQueue };

export interface StorageRouterConfig {
  coreDb: D1Database;
  catalogShards?: D1Database[];
  catalogQueue?: CatalogQueue;
}

export interface StorageRouter {
  core(): D1Database;
  catalogForNamespace(namespaceId: string): D1Database;
  catalogForNamespaces(namespaceIds: string[]): Map<D1Database, string[]>;
  hasCatalogQueue(): boolean;
  enqueueCatalogIngest(message: CatalogIngestMessage): Promise<void>;
}

// Deterministic hash using FNV-1a-like mix so distribution is uniform across short numeric IDs.
export function hashNamespaceId(namespaceId: string): number {
  let hash = 2166136261; // FNV offset basis (32-bit)
  for (let i = 0; i < namespaceId.length; i++) {
    hash ^= namespaceId.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0; // FNV prime, keep unsigned 32-bit
  }
  return hash;
}

export class D1StorageRouter implements StorageRouter {
  private readonly coreDb: D1Database;
  private readonly shards: D1Database[];
  private readonly queue?: CatalogQueue;

  constructor(config: StorageRouterConfig) {
    this.coreDb = config.coreDb;
    this.shards = config.catalogShards?.length ? config.catalogShards : [];
    this.queue = config.catalogQueue;
  }

  core(): D1Database {
    return this.coreDb;
  }

  catalogForNamespace(namespaceId: string): D1Database {
    if (this.shards.length === 0) return this.coreDb;
    return this.shards[hashNamespaceId(namespaceId) % this.shards.length];
  }

  catalogForNamespaces(namespaceIds: string[]): Map<D1Database, string[]> {
    const result = new Map<D1Database, string[]>();
    for (const id of namespaceIds) {
      const db = this.catalogForNamespace(id);
      const existing = result.get(db);
      if (existing) existing.push(id);
      else result.set(db, [id]);
    }
    return result;
  }

  hasCatalogQueue(): boolean {
    return this.queue !== undefined;
  }

  async enqueueCatalogIngest(message: CatalogIngestMessage): Promise<void> {
    if (!this.queue) throw new Error("No catalog ingest queue configured");
    await this.queue.send(message);
  }
}
