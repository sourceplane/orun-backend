import { describe, it, expect } from "vitest";
import { makeUserStore } from "./users.js";
import type { DbClient, DbQueryResult } from "./types.js";
import type { UserRow, UserIdentityRow } from "./domain.js";

function makeRow<T>(overrides: Partial<T>): T {
  return overrides as T;
}

function fakeSingleQuery<T>(row: T): DbClient {
  return {
    async query<R>(): Promise<DbQueryResult<R>> {
      return { rows: [row as unknown as R] };
    },
    async transaction<R>(fn: (c: DbClient) => Promise<R>): Promise<R> {
      return fn(this);
    },
  };
}

function fakeEmptyQuery(): DbClient {
  return {
    async query<R>(): Promise<DbQueryResult<R>> {
      return { rows: [] };
    },
    async transaction<R>(fn: (c: DbClient) => Promise<R>): Promise<R> {
      return fn(this);
    },
  };
}

function makeDbWithSequence(responses: { rows: unknown[] }[]): DbClient {
  let idx = 0;
  return {
    async query<R>(): Promise<DbQueryResult<R>> {
      const res = responses[idx++] ?? { rows: [] };
      return { rows: res.rows as R[] };
    },
    async transaction<R>(fn: (c: DbClient) => Promise<R>): Promise<R> {
      return fn(this);
    },
  };
}

function nowDate(): Date { return new Date(); }

const baseUser: UserRow = {
  id: "11111111-1111-1111-1111-111111111111",
  email: "test@example.com",
  display_name: "Test User",
  avatar_url: null,
  created_at: nowDate(),
  updated_at: nowDate(),
};

const baseIdentity: UserIdentityRow = {
  id: "22222222-2222-2222-2222-222222222222",
  user_id: baseUser.id,
  provider: "github",
  provider_user_id: "gh-99",
  provider_login: "octocat",
  created_at: nowDate(),
  updated_at: nowDate(),
};

describe("makeUserStore", () => {
  describe("upsertUser", () => {
    it("returns the upserted user row", async () => {
      const db = fakeSingleQuery<UserRow>(baseUser);
      const store = makeUserStore(db);
      const result = await store.upsertUser({
        id: baseUser.id,
        email: baseUser.email,
        display_name: baseUser.display_name,
        avatar_url: null,
      });
      expect(result.id).toBe(baseUser.id);
      expect(result.email).toBe("test@example.com");
    });

    it("passes the correct SQL params", async () => {
      const captured: unknown[][] = [];
      const db: DbClient = {
        async query<R>(_sql: string, params?: unknown[]): Promise<DbQueryResult<R>> {
          captured.push(params ?? []);
          return { rows: [baseUser as unknown as R] };
        },
        async transaction<R>(fn: (c: DbClient) => Promise<R>): Promise<R> { return fn(this); },
      };
      const store = makeUserStore(db);
      await store.upsertUser({ id: "u1", email: "a@b.com", display_name: "A", avatar_url: null });
      expect(captured[0]).toEqual(["u1", "a@b.com", "A", null]);
    });
  });

  describe("upsertGitHubIdentity", () => {
    it("returns the upserted identity row", async () => {
      const db = fakeSingleQuery<UserIdentityRow>(baseIdentity);
      const store = makeUserStore(db);
      const result = await store.upsertGitHubIdentity({
        user_id: baseUser.id,
        provider: "github",
        provider_user_id: "gh-99",
        provider_login: "octocat",
      });
      expect(result.provider).toBe("github");
      expect(result.provider_user_id).toBe("gh-99");
    });
  });

  describe("getUserById", () => {
    it("returns the user when found", async () => {
      const db = fakeSingleQuery<UserRow>(baseUser);
      const store = makeUserStore(db);
      const result = await store.getUserById(baseUser.id);
      expect(result?.id).toBe(baseUser.id);
    });

    it("returns null when not found", async () => {
      const db = fakeEmptyQuery();
      const store = makeUserStore(db);
      const result = await store.getUserById("missing");
      expect(result).toBeNull();
    });
  });

  describe("findByGitHubUserId", () => {
    it("returns user and identity when both exist", async () => {
      const db = makeDbWithSequence([
        { rows: [baseIdentity] },
        { rows: [baseUser] },
      ]);
      const store = makeUserStore(db);
      const result = await store.findByGitHubUserId("gh-99");
      expect(result?.user.id).toBe(baseUser.id);
      expect(result?.identity.provider_user_id).toBe("gh-99");
    });

    it("returns null when identity not found", async () => {
      const db = fakeEmptyQuery();
      const store = makeUserStore(db);
      const result = await store.findByGitHubUserId("missing-gh");
      expect(result).toBeNull();
    });

    it("returns null when identity found but user missing", async () => {
      const db = makeDbWithSequence([
        { rows: [baseIdentity] },
        { rows: [] },
      ]);
      const store = makeUserStore(db);
      const result = await store.findByGitHubUserId("gh-99");
      expect(result).toBeNull();
    });
  });
});
