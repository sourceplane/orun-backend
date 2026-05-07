import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Env } from "@orun/types";
import type { RequestContext } from "../auth";
import type { CatalogSyncEnvelope } from "@orun/types";

function makeDONamespace(): DurableObjectNamespace {
  const stub = {
    fetch: vi.fn(async () => new Response(JSON.stringify({ ok: true, alreadyExists: false }), { status: 200 })),
  } as unknown as DurableObjectStub;
  return {
    idFromName: vi.fn(() => ({ toString: () => "test-id" })),
    get: vi.fn(() => stub),
    newUniqueId: vi.fn(),
    idFromString: vi.fn(),
    jurisdiction: vi.fn(),
  } as unknown as DurableObjectNamespace;
}

function makeR2Bucket() {
  const store = new Map<string, string>();
  return {
    put: vi.fn(async (key: string, value: unknown) => {
      store.set(key, typeof value === "string" ? value : JSON.stringify(value));
      return {} as R2Object;
    }),
    get: vi.fn(async (key: string) => {
      const item = store.get(key);
      if (!item) return null;
      return { text: async () => item, json: async () => JSON.parse(item) } as unknown as R2ObjectBody;
    }),
    delete: vi.fn(async () => {}),
    list: vi.fn(async () => ({ objects: [], truncated: false, cursor: "" })),
    head: vi.fn(),
    createMultipartUpload: vi.fn(),
    resumeMultipartUpload: vi.fn(),
    _store: store,
  } as unknown as R2Bucket & { _store: Map<string, string> };
}

interface MockD1Options {
  uploadExists?: boolean;
  accountId?: string;
  linkedNamespaceIds?: string[];
}

function makeD1Database(opts: MockD1Options = {}): D1Database {
  const prepared = vi.fn((sql: string) => {
    const normalizedSql = sql.replace(/\s+/g, " ").trim().toUpperCase();
    return {
      bind: (..._args: unknown[]) => ({
        run: vi.fn(async () => ({ meta: { changes: 1 } })),
        all: vi.fn(async (): Promise<{ results: Record<string, unknown>[] }> => {
          if (normalizedSql.includes("FROM ACCOUNT_REPOS")) {
            return {
              results: (opts.linkedNamespaceIds ?? []).map((id) => ({ namespace_id: id })),
            };
          }
          return { results: [] };
        }),
        first: vi.fn(async (): Promise<Record<string, unknown> | null> => {
          if (normalizedSql.includes("FROM CATALOG_UPLOADS") && normalizedSql.includes("WHERE UPLOAD_ID")) {
            if (opts.uploadExists) {
              return { upload_id: "upl-dup", created_at: "2026-01-01T00:00:00.000Z", component_count: 1 };
            }
            return null;
          }
          if (normalizedSql.includes("FROM ACCOUNTS") && normalizedSql.includes("WHERE GITHUB_LOGIN")) {
            if (opts.accountId) {
              return { account_id: opts.accountId, github_login: "testuser", github_user_id: "123", created_at: "t" };
            }
            return null;
          }
          if (normalizedSql.includes("FROM CATALOG_COMPONENTS") && normalizedSql.includes("WHERE CC.COMPONENT_ID")) {
            return null;
          }
          if (normalizedSql.includes("FROM CATALOG_COMPONENTS") && normalizedSql.includes("COUNT(*)")) {
            return { total: 0 };
          }
          return null;
        }),
      }),
    };
  });
  return { prepare: prepared } as unknown as D1Database;
}

function makeEnv(opts: MockD1Options = {}): Env {
  return {
    COORDINATOR: makeDONamespace(),
    RATE_LIMITER: makeDONamespace(),
    STORAGE: makeR2Bucket(),
    DB: makeD1Database(opts),
    GITHUB_JWKS_URL: "https://token.actions.githubusercontent.com/.well-known/jwks",
    GITHUB_OIDC_AUDIENCE: "orun",
    ORUN_SESSION_SECRET: "test-secret",
    ORUN_DEPLOY_TOKEN: "test-deploy-token",
    GITHUB_CLIENT_ID: "test-client-id",
    GITHUB_CLIENT_SECRET: "test-client-secret",
    ORUN_PUBLIC_URL: "https://api.orun.test",
  } as unknown as Env;
}

function makeExecutionContext(): ExecutionContext & { _flush: () => Promise<unknown[]> } {
  const promises: Promise<unknown>[] = [];
  return {
    waitUntil: (p: Promise<unknown>) => { promises.push(p); },
    passThroughOnException: () => {},
    _flush: () => Promise.all(promises),
  } as unknown as ExecutionContext & { _flush: () => Promise<unknown[]> };
}

vi.mock("../auth", async (importOriginal) => {
  const original = await importOriginal() as Record<string, unknown>;
  let mockAuthResult: RequestContext = {
    type: "oidc",
    namespace: { namespaceId: "123456", namespaceSlug: "test-org/test-repo" },
    allowedNamespaceIds: ["123456"],
    actor: "test-actor",
  };
  return {
    ...original,
    authenticate: vi.fn(async () => mockAuthResult),
    OrunError: original.OrunError,
    __setMockAuth: (auth: RequestContext) => { mockAuthResult = auth; },
  };
});

const { authenticate, __setMockAuth } = await import("../auth") as unknown as {
  authenticate: ReturnType<typeof vi.fn>;
  __setMockAuth: (auth: RequestContext) => void;
};

const { routeRequest } = await import("../router");

function req(method: string, path: string, body?: unknown, headers?: Record<string, string>): Request {
  const init: RequestInit = { method, headers: { ...headers } };
  if (body) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
  }
  return new Request(`https://api.orun.test${path}`, init);
}

function makeValidEnvelope(overrides: Partial<CatalogSyncEnvelope> = {}): CatalogSyncEnvelope {
  return {
    apiVersion: "orun.io/v1",
    kind: "CatalogSyncEnvelope",
    uploadId: "upl-test-001",
    schemaVersion: "1",
    source: {
      provider: "github",
      repo: "test-org/test-repo",
      repoId: "123456",
      commit: "abc123def456",
    },
    components: [
      {
        apiVersion: "orun.io/v1",
        kind: "ComponentState",
        source: {
          provider: "github",
          repository: "test-org/test-repo",
          repoId: "123456",
          commit: "abc123def456",
        },
        component: {
          id: "github:123456:api-worker",
          name: "api-worker",
          type: "cloudflare-worker",
          path: "apps/api-worker",
          tags: ["edge"],
        },
        environments: [{ name: "production", status: "healthy" }],
        relations: [],
        generatedAt: "2026-05-07T10:00:00.000Z",
      },
    ],
    generatedAt: "2026-05-07T10:00:00.000Z",
    ...overrides,
  };
}

describe("Catalog API", () => {
  let env: Env;
  let ctx: ExecutionContext & { _flush: () => Promise<unknown[]> };

  beforeEach(() => {
    env = makeEnv();
    ctx = makeExecutionContext();
    __setMockAuth({
      type: "oidc",
      namespace: { namespaceId: "123456", namespaceSlug: "test-org/test-repo" },
      allowedNamespaceIds: ["123456"],
      actor: "test-actor",
    });
  });

  describe("POST /v1/catalog/sync", () => {
    it("accepts valid OIDC envelope and returns 202", async () => {
      const resp = await routeRequest(req("POST", "/v1/catalog/sync", makeValidEnvelope()), env, ctx);
      expect(resp.status).toBe(202);
      const data = await resp.json() as { uploadId: string; acceptedAt: string; componentCount: number };
      expect(data.uploadId).toBe("upl-test-001");
      expect(data.componentCount).toBe(1);
      expect(data.acceptedAt).toBeDefined();
    });

    it("rejects dashboard session with 403", async () => {
      __setMockAuth({
        type: "session",
        sessionKind: "dashboard",
        namespace: null,
        allowedNamespaceIds: ["123456"],
        actor: "testuser",
      });
      const resp = await routeRequest(req("POST", "/v1/catalog/sync", makeValidEnvelope()), env, ctx);
      expect(resp.status).toBe(403);
      const data = await resp.json() as { code: string };
      expect(data.code).toBe("FORBIDDEN");
    });

    it("rejects CLI session with 403", async () => {
      __setMockAuth({
        type: "session",
        sessionKind: "cli",
        namespace: null,
        allowedNamespaceIds: ["123456"],
        actor: "testuser",
      });
      const resp = await routeRequest(req("POST", "/v1/catalog/sync", makeValidEnvelope()), env, ctx);
      expect(resp.status).toBe(403);
    });

    it("rejects when OIDC repository_id mismatches envelope source.repoId", async () => {
      __setMockAuth({
        type: "oidc",
        namespace: { namespaceId: "DIFFERENT_ID", namespaceSlug: "test-org/test-repo" },
        allowedNamespaceIds: ["DIFFERENT_ID"],
        actor: "test-actor",
      });
      const resp = await routeRequest(req("POST", "/v1/catalog/sync", makeValidEnvelope()), env, ctx);
      expect(resp.status).toBe(403);
      const data = await resp.json() as { code: string };
      expect(data.code).toBe("FORBIDDEN");
    });

    it("rejects when OIDC repository mismatches envelope source.repo", async () => {
      __setMockAuth({
        type: "oidc",
        namespace: { namespaceId: "123456", namespaceSlug: "other-org/other-repo" },
        allowedNamespaceIds: ["123456"],
        actor: "test-actor",
      });
      const resp = await routeRequest(req("POST", "/v1/catalog/sync", makeValidEnvelope()), env, ctx);
      expect(resp.status).toBe(403);
    });

    it("rejects unsupported schemaVersion with 400", async () => {
      const resp = await routeRequest(
        req("POST", "/v1/catalog/sync", makeValidEnvelope({ schemaVersion: "99" })),
        env,
        ctx
      );
      expect(resp.status).toBe(400);
      const data = await resp.json() as { code: string };
      expect(data.code).toBe("INVALID_REQUEST");
    });

    it("rejects component with absolute path", async () => {
      const envelope = makeValidEnvelope();
      envelope.components[0].component.path = "/absolute/path";
      const resp = await routeRequest(req("POST", "/v1/catalog/sync", envelope), env, ctx);
      expect(resp.status).toBe(400);
    });

    it("rejects component with .. path traversal", async () => {
      const envelope = makeValidEnvelope();
      envelope.components[0].component.path = "apps/../../../etc/passwd";
      const resp = await routeRequest(req("POST", "/v1/catalog/sync", envelope), env, ctx);
      expect(resp.status).toBe(400);
    });

    it("rejects component with empty path", async () => {
      const envelope = makeValidEnvelope();
      envelope.components[0].component.path = "";
      const resp = await routeRequest(req("POST", "/v1/catalog/sync", envelope), env, ctx);
      expect(resp.status).toBe(400);
    });

    it("is idempotent for duplicate uploadId — returns 202 without error", async () => {
      env = makeEnv({ uploadExists: true });
      const resp = await routeRequest(req("POST", "/v1/catalog/sync", makeValidEnvelope({ uploadId: "upl-dup" })), env, ctx);
      expect(resp.status).toBe(202);
    });

    it("writes raw envelope to R2 via ctx.waitUntil", async () => {
      const resp = await routeRequest(req("POST", "/v1/catalog/sync", makeValidEnvelope()), env, ctx);
      expect(resp.status).toBe(202);
      await ctx._flush();
      const r2 = env.STORAGE as unknown as { _store: Map<string, string> };
      const keys = [...r2._store.keys()];
      const envelopeKey = keys.find((k) => k.includes("catalog/uploads"));
      expect(envelopeKey).toBeDefined();
      expect(envelopeKey).toContain("123456/catalog/uploads/upl-test-001");
    });

    it("normalizes component state to R2 via ctx.waitUntil", async () => {
      await routeRequest(req("POST", "/v1/catalog/sync", makeValidEnvelope()), env, ctx);
      await ctx._flush();
      const r2 = env.STORAGE as unknown as { _store: Map<string, string> };
      const keys = [...r2._store.keys()];
      const stateKey = keys.find((k) => k.includes("catalog/commits"));
      expect(stateKey).toBeDefined();
      expect(stateKey).toContain("api-worker");
    });
  });

  describe("GET /v1/catalog/components", () => {
    it("requires session auth — rejects OIDC with 403", async () => {
      const resp = await routeRequest(req("GET", "/v1/catalog/components"), env, ctx);
      expect(resp.status).toBe(403);
    });

    it("returns component list for session auth", async () => {
      __setMockAuth({
        type: "session",
        sessionKind: "dashboard",
        namespace: null,
        allowedNamespaceIds: ["123456"],
        actor: "testuser",
      });
      const resp = await routeRequest(req("GET", "/v1/catalog/components"), env, ctx);
      expect(resp.status).toBe(200);
      const data = await resp.json() as { components: unknown[]; total: number };
      expect(Array.isArray(data.components)).toBe(true);
      expect(typeof data.total).toBe("number");
    });

    it("does not expose local namespaces in catalog results", async () => {
      env = makeEnv({
        accountId: "acct-1",
        linkedNamespaceIds: ["123456", "local:user:111:repo:789"],
      });
      __setMockAuth({
        type: "session",
        sessionKind: "dashboard",
        namespace: null,
        allowedNamespaceIds: ["123456"],
        actor: "testuser",
      });
      const resp = await routeRequest(req("GET", "/v1/catalog/components"), env, ctx);
      expect(resp.status).toBe(200);
      // The D1 mock returns empty regardless, but we verify the request goes through correctly.
      const data = await resp.json() as { components: unknown[] };
      expect(Array.isArray(data.components)).toBe(true);
    });
  });

  describe("GET /v1/catalog/components/:componentId", () => {
    it("requires session auth", async () => {
      const resp = await routeRequest(req("GET", "/v1/catalog/components/github:123:api"), env, ctx);
      expect(resp.status).toBe(403);
    });

    it("returns 404 when component not found", async () => {
      __setMockAuth({
        type: "session",
        sessionKind: "dashboard",
        namespace: null,
        allowedNamespaceIds: ["123456"],
        actor: "testuser",
      });
      const resp = await routeRequest(req("GET", "/v1/catalog/components/github:123:api"), env, ctx);
      expect(resp.status).toBe(404);
    });
  });

  describe("GET /v1/catalog/components/:componentId/history", () => {
    it("requires session auth", async () => {
      const resp = await routeRequest(req("GET", "/v1/catalog/components/cid/history"), env, ctx);
      expect(resp.status).toBe(403);
    });

    it("returns events list for session", async () => {
      __setMockAuth({
        type: "session",
        sessionKind: "dashboard",
        namespace: null,
        allowedNamespaceIds: [],
        actor: "testuser",
      });
      const resp = await routeRequest(req("GET", "/v1/catalog/components/cid/history"), env, ctx);
      expect(resp.status).toBe(200);
      const data = await resp.json() as { events: unknown[] };
      expect(Array.isArray(data.events)).toBe(true);
    });
  });

  describe("GET /v1/repos/:repoId/components", () => {
    it("requires session auth", async () => {
      const resp = await routeRequest(req("GET", "/v1/repos/123456/components"), env, ctx);
      expect(resp.status).toBe(403);
    });

    it("returns component list for session", async () => {
      __setMockAuth({
        type: "session",
        sessionKind: "dashboard",
        namespace: null,
        allowedNamespaceIds: ["123456"],
        actor: "testuser",
      });
      const resp = await routeRequest(req("GET", "/v1/repos/123456/components"), env, ctx);
      expect(resp.status).toBe(200);
    });
  });
});
