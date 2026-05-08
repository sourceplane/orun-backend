import { describe, it, expect, vi } from "vitest";
import { D1StorageRouter, hashNamespaceId } from "./router";
import type { CatalogIngestMessage, CatalogQueue } from "@orun/types";

function fakeDb(label: string): D1Database {
  return { _label: label } as unknown as D1Database;
}

function fakeQueue(received: CatalogIngestMessage[]): CatalogQueue {
  return {
    send: vi.fn(async (msg: CatalogIngestMessage) => {
      received.push(msg);
    }),
  };
}

describe("hashNamespaceId", () => {
  it("returns a non-negative integer", () => {
    expect(hashNamespaceId("123456789")).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(hashNamespaceId("abc"))).toBe(true);
  });

  it("is deterministic for the same input", () => {
    const a = hashNamespaceId("sourceplane/orun");
    const b = hashNamespaceId("sourceplane/orun");
    expect(a).toBe(b);
  });

  it("produces different values for different inputs", () => {
    const a = hashNamespaceId("111111");
    const b = hashNamespaceId("222222");
    expect(a).not.toBe(b);
  });
});

describe("D1StorageRouter — single-DB fallback", () => {
  const core = fakeDb("core");
  const router = new D1StorageRouter({ coreDb: core });

  it("core() returns the core DB", () => {
    expect(router.core()).toBe(core);
  });

  it("catalogForNamespace returns core DB when no shards configured", () => {
    expect(router.catalogForNamespace("999999")).toBe(core);
    expect(router.catalogForNamespace("111111")).toBe(core);
  });

  it("catalogForNamespaces maps all IDs to a single core DB entry", () => {
    const map = router.catalogForNamespaces(["ns-1", "ns-2", "ns-3"]);
    expect(map.size).toBe(1);
    const [[db, ids]] = map;
    expect(db).toBe(core);
    expect(ids).toHaveLength(3);
    expect(ids).toContain("ns-1");
    expect(ids).toContain("ns-2");
    expect(ids).toContain("ns-3");
  });

  it("catalogForNamespaces returns empty map for empty input", () => {
    expect(router.catalogForNamespaces([]).size).toBe(0);
  });

  it("hasCatalogQueue returns false", () => {
    expect(router.hasCatalogQueue()).toBe(false);
  });

  it("enqueueCatalogIngest throws without queue", async () => {
    const msg: CatalogIngestMessage = {
      namespaceId: "1",
      repoId: "1",
      repoFullName: "org/repo",
      uploadId: "upl-1",
      envelopeRef: "1/catalog/uploads/upl-1/catalog-sync-envelope.json",
      commitSha: "abc",
      receivedAt: new Date().toISOString(),
    };
    await expect(router.enqueueCatalogIngest(msg)).rejects.toThrow("No catalog ingest queue configured");
  });
});

describe("D1StorageRouter — two catalog shards", () => {
  const core = fakeDb("core");
  const shard0 = fakeDb("shard-0");
  const shard1 = fakeDb("shard-1");
  const router = new D1StorageRouter({ coreDb: core, catalogShards: [shard0, shard1] });

  it("core() still returns the core DB", () => {
    expect(router.core()).toBe(core);
  });

  it("routes each namespace deterministically to shard 0 or 1", () => {
    const ns = "123456789";
    const first = router.catalogForNamespace(ns);
    const second = router.catalogForNamespace(ns);
    expect(first).toBe(second);
    expect(first === shard0 || first === shard1).toBe(true);
  });

  it("different namespace IDs may route to different shards", () => {
    // Brute-force: find two IDs that hash to different shards across shard count 2
    const results = new Set<D1Database>();
    for (let i = 0; i < 100; i++) {
      results.add(router.catalogForNamespace(String(i)));
    }
    expect(results.size).toBe(2);
  });

  it("catalogForNamespaces groups namespaces by shard", () => {
    const ids = Array.from({ length: 50 }, (_, i) => String(i));
    const map = router.catalogForNamespaces(ids);
    expect(map.size).toBeLessThanOrEqual(2);
    const allIds = [...map.values()].flat();
    expect(allIds.sort()).toEqual([...ids].sort());
  });

  it("catalogForNamespaces each namespace appears exactly once", () => {
    const ids = ["a", "b", "c", "d", "e"];
    const map = router.catalogForNamespaces(ids);
    const seen: string[] = [];
    for (const list of map.values()) seen.push(...list);
    expect(seen.sort()).toEqual([...ids].sort());
  });

  it("routing is consistent: same namespace always maps to same shard across calls", () => {
    for (const ns of ["111", "222", "333", "444"]) {
      expect(router.catalogForNamespace(ns)).toBe(router.catalogForNamespace(ns));
    }
  });

  it("hasCatalogQueue returns false when no queue set", () => {
    expect(router.hasCatalogQueue()).toBe(false);
  });
});

describe("D1StorageRouter — with catalog queue", () => {
  const core = fakeDb("core");
  const received: CatalogIngestMessage[] = [];
  const queue = fakeQueue(received);
  const router = new D1StorageRouter({ coreDb: core, catalogQueue: queue });

  it("hasCatalogQueue returns true", () => {
    expect(router.hasCatalogQueue()).toBe(true);
  });

  it("enqueueCatalogIngest sends the message via the queue", async () => {
    const msg: CatalogIngestMessage = {
      namespaceId: "123456",
      repoId: "123456",
      repoFullName: "org/repo",
      uploadId: "upl-abc",
      envelopeRef: "123456/catalog/uploads/upl-abc/catalog-sync-envelope.json",
      commitSha: "deadbeef",
      receivedAt: "2026-05-08T00:00:00.000Z",
    };
    await router.enqueueCatalogIngest(msg);
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(msg);
  });

  it("queue message contains only routing metadata and R2 ref — no full envelope fields", async () => {
    const msg: CatalogIngestMessage = {
      namespaceId: "n",
      repoId: "n",
      repoFullName: "o/r",
      uploadId: "u",
      envelopeRef: "n/catalog/uploads/u/catalog-sync-envelope.json",
      commitSha: "c",
      receivedAt: "2026-05-08T00:00:00.000Z",
    };
    await router.enqueueCatalogIngest(msg);
    const sent = received[received.length - 1];
    const allowedKeys: (keyof CatalogIngestMessage)[] = [
      "namespaceId", "repoId", "repoFullName", "uploadId", "envelopeRef", "commitSha", "receivedAt",
    ];
    for (const k of Object.keys(sent)) {
      expect(allowedKeys).toContain(k);
    }
    // Must NOT contain component-level data
    expect(Object.keys(sent)).not.toContain("components");
    expect(Object.keys(sent)).not.toContain("plan");
    expect(Object.keys(sent)).not.toContain("token");
  });
});
