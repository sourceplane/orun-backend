import { describe, it, expect } from "vitest";
import { makeOrgStore } from "./organizations.js";
import type { DbClient, DbQueryResult } from "./types.js";
import type { OrganizationRow, OrganizationMemberRow } from "./domain.js";

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
  return {
    calls,
    client,
    addResponse(rows: unknown[]) { responses.push({ rows }); },
  };
}

const baseOrg: OrganizationRow = {
  id: "aaaa-0001",
  slug: "acme",
  name: "Acme Corp",
  created_by_user_id: "u1",
  provisioning_mode: "shared",
  lifecycle_status: "active",
  created_at: nowDate(),
  updated_at: nowDate(),
  deleted_at: null,
};

const baseMember: OrganizationMemberRow = {
  organization_id: baseOrg.id,
  user_id: "u1",
  role: "owner",
  status: "active",
  invited_by_user_id: null,
  joined_at: nowDate(),
  created_at: nowDate(),
  updated_at: nowDate(),
};

describe("makeOrgStore", () => {
  describe("createOrganization", () => {
    it("returns org summary on success", async () => {
      const cap = captureDb();
      // org insert, member insert, billing insert, 4 entitlement inserts
      cap.addResponse([baseOrg]);
      for (let i = 0; i < 6; i++) cap.addResponse([]);
      const store = makeOrgStore(cap.client);
      const result = await store.createOrganization({
        name: "Acme Corp",
        slug: "acme",
        createdByUserId: "u1",
      });
      expect(result.slug).toBe("acme");
      expect(result.id).toBe(baseOrg.id);
    });

    it("executes INSERT for org, member, billing, and entitlements", async () => {
      const cap = captureDb();
      cap.addResponse([baseOrg]);
      for (let i = 0; i < 6; i++) cap.addResponse([]);
      const store = makeOrgStore(cap.client);
      await store.createOrganization({ name: "Acme", slug: "acme", createdByUserId: "u1" });

      const sqls = cap.calls.map((c) => c.sql);
      expect(sqls.some((s) => s.includes("INSERT INTO organizations"))).toBe(true);
      expect(sqls.some((s) => s.includes("INSERT INTO organization_members"))).toBe(true);
      expect(sqls.some((s) => s.includes("INSERT INTO billing_accounts"))).toBe(true);
      expect(sqls.some((s) => s.includes("INSERT INTO entitlements"))).toBe(true);
    });

    it("throws INVALID_SLUG for bad slug", async () => {
      const db = makeSequence([]);
      const store = makeOrgStore(db);
      await expect(
        store.createOrganization({ name: "X", slug: "INVALID SLUG", createdByUserId: "u1" }),
      ).rejects.toThrow("INVALID_SLUG");
    });

    it("throws INVALID_NAME for empty name", async () => {
      const db = makeSequence([]);
      const store = makeOrgStore(db);
      await expect(
        store.createOrganization({ name: "   ", slug: "valid", createdByUserId: "u1" }),
      ).rejects.toThrow("INVALID_NAME");
    });

    it("re-throws DB error (e.g. CONFLICT for duplicate slug)", async () => {
      const db: DbClient = {
        async query() { throw new Error("duplicate key value violates unique constraint"); },
        async transaction<R>(fn: (c: DbClient) => Promise<R>): Promise<R> { return fn(db); },
      };
      const store = makeOrgStore(db);
      await expect(
        store.createOrganization({ name: "Acme", slug: "acme", createdByUserId: "u1" }),
      ).rejects.toThrow("duplicate key");
    });
  });

  describe("listOrgsForUser", () => {
    it("returns mapped memberships", async () => {
      const row = { ...baseOrg, role: "owner", member_status: "active" };
      const db = makeSequence([{ rows: [row] }]);
      const store = makeOrgStore(db);
      const results = await store.listOrgsForUser("u1");
      expect(results).toHaveLength(1);
      expect(results[0].role).toBe("owner");
      expect(results[0].organization.slug).toBe("acme");
    });

    it("returns empty array when no orgs", async () => {
      const db = makeSequence([{ rows: [] }]);
      const store = makeOrgStore(db);
      const results = await store.listOrgsForUser("nobody");
      expect(results).toHaveLength(0);
    });
  });

  describe("getMembership", () => {
    it("returns membership when found", async () => {
      const db = makeSequence([{ rows: [baseMember] }]);
      const store = makeOrgStore(db);
      const result = await store.getMembership(baseOrg.id, "u1");
      expect(result?.role).toBe("owner");
    });

    it("returns null when not a member", async () => {
      const db = makeSequence([{ rows: [] }]);
      const store = makeOrgStore(db);
      const result = await store.getMembership(baseOrg.id, "stranger");
      expect(result).toBeNull();
    });
  });

  describe("getOrganization", () => {
    it("returns null when org not found", async () => {
      const db = makeSequence([{ rows: [] }]);
      const store = makeOrgStore(db);
      const result = await store.getOrganization("missing", "u1");
      expect(result).toBeNull();
    });

    it("returns null when user is not a member", async () => {
      const db = makeSequence([{ rows: [baseOrg] }, { rows: [] }]);
      const store = makeOrgStore(db);
      const result = await store.getOrganization(baseOrg.id, "stranger");
      expect(result).toBeNull();
    });

    it("returns org and membership when authorized", async () => {
      const db = makeSequence([{ rows: [baseOrg] }, { rows: [baseMember] }]);
      const store = makeOrgStore(db);
      const result = await store.getOrganization(baseOrg.id, "u1");
      expect(result?.org.slug).toBe("acme");
      expect(result?.membership.role).toBe("owner");
    });
  });
});
