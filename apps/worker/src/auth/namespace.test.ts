import { describe, it, expect } from "vitest";
import { upsertNamespaceSlug } from "./namespace";

interface BoundCall {
  sql: string;
  params: unknown[];
}

function makeFakeDb(): { db: D1Database; calls: BoundCall[] } {
  const calls: BoundCall[] = [];

  const db = {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          calls.push({ sql, params });
          return { run: async () => ({ meta: { changes: 1 }, results: [], success: true }) };
        },
      };
    },
  } as unknown as D1Database;

  return { db, calls };
}

describe("upsertNamespaceSlug", () => {
  it("inserts namespace with correct parameters", async () => {
    const { db, calls } = makeFakeDb();
    const now = new Date("2026-01-01T00:00:00.000Z");

    await upsertNamespaceSlug(db, { namespaceId: "12345", namespaceSlug: "org/repo" }, now);

    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toContain("INSERT INTO namespaces");
    expect(calls[0].sql).toContain("ON CONFLICT");
    expect(calls[0].params[0]).toBe("12345");
    expect(calls[0].params[1]).toBe("org/repo");
    expect(calls[0].params[2]).toBe("2026-01-01T00:00:00.000Z");
  });

  it("repeated calls are safe", async () => {
    const { db, calls } = makeFakeDb();

    await upsertNamespaceSlug(db, { namespaceId: "12345", namespaceSlug: "org/repo" });
    await upsertNamespaceSlug(db, { namespaceId: "12345", namespaceSlug: "org/renamed" });

    expect(calls).toHaveLength(2);
    expect(calls[1].params[1]).toBe("org/renamed");
  });

  it("uses current time when no date provided", async () => {
    const { db, calls } = makeFakeDb();

    await upsertNamespaceSlug(db, { namespaceId: "1", namespaceSlug: "a/b" });

    const ts = calls[0].params[2] as string;
    expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
