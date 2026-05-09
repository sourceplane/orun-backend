import { describe, it, expect } from "vitest";
import { makeProjectStore } from "./projects.js";
import type { DbClient, DbQueryResult } from "./types.js";
import type { ProjectRow } from "./domain.js";

function nowDate(): Date { return new Date(); }

function makeSequence(responses: { rows: unknown[] }[]): DbClient {
  let idx = 0;
  const db: DbClient = {
    async query<R>(): Promise<DbQueryResult<R>> {
      const res = responses[idx++] ?? { rows: [] };
      return { rows: res.rows as R[] };
    },
    async transaction<R>(fn: (c: DbClient) => Promise<R>): Promise<R> {
      return fn(db);
    },
  };
  return db;
}

function captureDb(): { calls: { sql: string; params: unknown[] }[]; client: DbClient; addResponse: (rows: unknown[]) => void } {
  const calls: { sql: string; params: unknown[] }[] = [];
  const responses: { rows: unknown[] }[] = [];
  let idx = 0;
  const client: DbClient = {
    async query<R>(sql: string, params?: unknown[]): Promise<DbQueryResult<R>> {
      calls.push({ sql, params: params ?? [] });
      const res = responses[idx++] ?? { rows: [] };
      return { rows: res.rows as R[] };
    },
    async transaction<R>(fn: (c: DbClient) => Promise<R>): Promise<R> {
      return fn(client);
    },
  };
  return { calls, client, addResponse: (rows) => responses.push({ rows }) };
}

const baseProject: ProjectRow = {
  id: "proj-0001",
  organization_id: "org-0001",
  slug: "platform",
  name: "Platform",
  description: "Core platform services",
  default_branch: "main",
  lifecycle_status: "active",
  created_by_user_id: "u1",
  created_at: nowDate(),
  updated_at: nowDate(),
  deleted_at: null,
};

describe("makeProjectStore", () => {
  describe("createProject", () => {
    it("returns project summary on success", async () => {
      const db = makeSequence([{ rows: [baseProject] }]);
      const store = makeProjectStore(db);
      const result = await store.createProject({
        organization_id: "org-0001",
        slug: "platform",
        name: "Platform",
        description: "Core platform services",
        created_by_user_id: "u1",
      });
      expect(result.slug).toBe("platform");
      expect(result.id).toBe("proj-0001");
      expect(result.description).toBe("Core platform services");
    });

    it("passes correct params to query", async () => {
      const cap = captureDb();
      cap.addResponse([baseProject]);
      const store = makeProjectStore(cap.client);
      await store.createProject({
        organization_id: "org-0001",
        slug: "platform",
        name: "Platform",
        created_by_user_id: "u1",
      });
      const [params] = cap.calls.map((c) => c.params);
      expect(params[0]).toBe("org-0001");
      expect(params[1]).toBe("platform");
      expect(params[2]).toBe("Platform");
      expect(params[3]).toBeNull();
    });

    it("throws INVALID_SLUG for bad slug", async () => {
      const db = makeSequence([]);
      const store = makeProjectStore(db);
      await expect(
        store.createProject({ organization_id: "o1", slug: "BAD SLUG!", name: "X", created_by_user_id: "u1" }),
      ).rejects.toThrow("INVALID_SLUG");
    });

    it("throws INVALID_NAME for empty name", async () => {
      const db = makeSequence([]);
      const store = makeProjectStore(db);
      await expect(
        store.createProject({ organization_id: "o1", slug: "valid", name: "   ", created_by_user_id: "u1" }),
      ).rejects.toThrow("INVALID_NAME");
    });

    it("re-throws DB error for duplicate (org, slug)", async () => {
      const db: DbClient = {
        async query() { throw new Error("duplicate key value violates unique constraint"); },
        async transaction<R>(fn: (c: DbClient) => Promise<R>): Promise<R> { return fn(db); },
      };
      const store = makeProjectStore(db);
      await expect(
        store.createProject({ organization_id: "o1", slug: "dup", name: "Dup", created_by_user_id: "u1" }),
      ).rejects.toThrow("duplicate key");
    });
  });

  describe("listProjects", () => {
    it("returns mapped summaries", async () => {
      const db = makeSequence([{ rows: [baseProject] }]);
      const store = makeProjectStore(db);
      const results = await store.listProjects("org-0001");
      expect(results).toHaveLength(1);
      expect(results[0].slug).toBe("platform");
    });

    it("returns empty array when no projects", async () => {
      const db = makeSequence([{ rows: [] }]);
      const store = makeProjectStore(db);
      const results = await store.listProjects("org-0001");
      expect(results).toHaveLength(0);
    });
  });

  describe("getProject", () => {
    it("returns project when found", async () => {
      const db = makeSequence([{ rows: [baseProject] }]);
      const store = makeProjectStore(db);
      const result = await store.getProject("org-0001", "proj-0001");
      expect(result?.id).toBe("proj-0001");
    });

    it("returns null when not found", async () => {
      const db = makeSequence([{ rows: [] }]);
      const store = makeProjectStore(db);
      const result = await store.getProject("org-0001", "missing");
      expect(result).toBeNull();
    });
  });
});
