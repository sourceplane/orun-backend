import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Env } from "@orun/types";
import type { RequestContext } from "../auth";

function makeD1DatabaseForAccounts() {
  const accounts: Record<string, { account_id: string; github_login: string; github_user_id: string | null; created_at: string }> = {};
  const accountRepos: Record<string, { account_id: string; namespace_id: string; linked_by: string; linked_at: string }> = {};
  const namespaces: Record<string, { namespace_id: string; namespace_slug: string; namespace_kind: string; last_seen_at: string }> = {};
  const accountRepoCache: Record<string, { account_id: string; repo_id: string; repo_full_name: string; last_seen_at: string }> = {};
  const runs: Record<string, Record<string, unknown>> = {};
  const jobs: Record<string, Record<string, unknown>> = {};

  const preparedFn = vi.fn((sql: string) => {
    return {
      bind: (...args: unknown[]) => ({
        run: vi.fn(async () => {
          if (sql.includes("INSERT INTO accounts")) {
            const login = args[1] as string;
            if (!accounts[login]) {
              accounts[login] = {
                account_id: args[0] as string,
                github_login: login,
                github_user_id: null,
                created_at: args[2] as string,
              };
            }
            return { meta: { changes: accounts[login] ? 0 : 1 } };
          }
          if (sql.includes("UPDATE accounts SET github_user_id")) {
            const userId = args[0] as string;
            const login = args[1] as string;
            if (accounts[login]) accounts[login].github_user_id = userId;
            return { meta: { changes: 1 } };
          }
          if (sql.includes("INSERT INTO namespaces")) {
            const nsId = args[0] as string;
            namespaces[nsId] = {
              namespace_id: nsId,
              namespace_slug: args[1] as string,
              namespace_kind: (args[2] as string) ?? "repo",
              last_seen_at: (args[3] as string) ?? (args[2] as string),
            };
            return { meta: { changes: 1 } };
          }
          if (sql.includes("INSERT INTO account_repos")) {
            const key = `${args[0]}:${args[1]}`;
            if (!accountRepos[key]) {
              accountRepos[key] = {
                account_id: args[0] as string,
                namespace_id: args[1] as string,
                linked_by: args[2] as string,
                linked_at: args[3] as string,
              };
            }
            return { meta: { changes: accountRepos[key] ? 0 : 1 } };
          }
          if (sql.includes("INSERT INTO account_repo_cache")) {
            const key = `${args[0]}:${args[1]}`;
            accountRepoCache[key] = {
              account_id: args[0] as string,
              repo_id: args[1] as string,
              repo_full_name: args[2] as string,
              last_seen_at: args[3] as string,
            };
            return { meta: { changes: 1 } };
          }
          if (sql.includes("DELETE FROM account_repos")) {
            const key = `${args[0]}:${args[1]}`;
            delete accountRepos[key];
            return { meta: { changes: 1 } };
          }
          if (sql.includes("INSERT INTO runs")) {
            const key = `${args[1]}:${args[0]}`;
            runs[key] = {
              run_id: args[0], namespace_id: args[1], status: args[2],
              plan_checksum: args[3], trigger_type: args[4], actor: args[5],
              dry_run: args[6], created_at: args[7], updated_at: args[8],
              finished_at: args[9], job_total: args[10], job_done: args[11],
              job_failed: args[12], expires_at: args[13],
            };
            return { meta: { changes: 1 } };
          }
          if (sql.includes("INSERT INTO jobs")) {
            const key = `${args[2]}:${args[1]}:${args[0]}`;
            jobs[key] = {
              job_id: args[0], run_id: args[1], namespace_id: args[2],
              component: args[3], status: args[4], runner_id: args[5],
              started_at: args[6], finished_at: args[7], log_ref: args[8],
            };
            return { meta: { changes: 1 } };
          }
          if (sql.includes("UPDATE jobs SET log_ref")) {
            return { meta: { changes: 0 } };
          }
          if (sql.includes("DELETE FROM runs")) {
            return { meta: { changes: 0 } };
          }
          return { meta: { changes: 0 } };
        }),
        all: vi.fn(async () => {
          if (sql.includes("FROM account_repos") && sql.includes("JOIN namespaces") && sql.includes("ORDER BY")) {
            const accountId = args[0] as string;
            const results = Object.values(accountRepos)
              .filter((r) => r.account_id === accountId)
              .sort((a, b) => b.linked_at.localeCompare(a.linked_at))
              .map((r) => ({
                namespace_id: r.namespace_id,
                namespace_slug: namespaces[r.namespace_id]?.namespace_slug ?? "",
                linked_at: r.linked_at,
              }));
            return { results };
          }
          if (sql.includes("SELECT namespace_id FROM account_repos WHERE account_id")) {
            const accountId = args[0] as string;
            const results = Object.values(accountRepos)
              .filter((r) => r.account_id === accountId)
              .map((r) => ({ namespace_id: r.namespace_id }));
            return { results };
          }
          if (sql.includes("SELECT") && sql.includes("FROM runs") && sql.includes("IN")) {
            const nsIds = args.slice(0, -2) as string[];
            const results = Object.values(runs).filter((r) =>
              nsIds.includes(r.namespace_id as string)
            );
            return {
              results: results.map((r) => ({
                ...r,
                namespace_slug: namespaces[r.namespace_id as string]?.namespace_slug ?? "test/repo",
              })),
            };
          }
          if (sql.includes("FROM jobs")) {
            const results = Object.values(jobs).filter(
              (j) => j.namespace_id === args[0] && j.run_id === args[1]
            );
            return { results };
          }
          if (sql.includes("expires_at")) {
            return { results: [] };
          }
          return { results: [] };
        }),
        first: vi.fn(async () => {
          if (sql.includes("FROM accounts WHERE github_login")) {
            const login = args[0] as string;
            return accounts[login] ?? null;
          }
          if (sql.includes("FROM account_repos") && sql.includes("JOIN namespaces") && sql.includes("ar.account_id = ?1 AND ar.namespace_id = ?2")) {
            const key = `${args[0]}:${args[1]}`;
            const ar = accountRepos[key];
            if (!ar) return null;
            return {
              namespace_id: ar.namespace_id,
              namespace_slug: namespaces[ar.namespace_id]?.namespace_slug ?? "",
              linked_at: ar.linked_at,
            };
          }
          if (sql.includes("FROM account_repo_cache") && sql.includes("repo_full_name =")) {
            const accountId = args[0] as string;
            const repoFullName = args[1] as string;
            const entry = Object.values(accountRepoCache).find(
              (r) => r.account_id === accountId && r.repo_full_name === repoFullName
            );
            return entry ?? null;
          }
          if (sql.includes("FROM account_repo_cache") && sql.includes("repo_id =")) {
            const accountId = args[0] as string;
            const repoId = args[1] as string;
            const key = `${accountId}:${repoId}`;
            return accountRepoCache[key] ?? null;
          }
          if (sql.includes("FROM runs")) {
            const key = `${args[0]}:${args[1]}`;
            const r = runs[key];
            if (r) return { ...r, namespace_slug: namespaces[r.namespace_id as string]?.namespace_slug ?? "test/repo" };
            return null;
          }
          if (sql.includes("FROM namespaces") && sql.includes("namespace_slug =")) {
            const slug = args[0] as string;
            const ns = Object.values(namespaces).find((n) => n.namespace_slug === slug);
            return ns ? { namespace_id: ns.namespace_id, namespace_slug: ns.namespace_slug } : null;
          }
          if (sql.includes("FROM namespaces")) {
            const ns = namespaces[args[0] as string];
            return ns ? { namespace_slug: ns.namespace_slug } : null;
          }
          return null;
        }),
      }),
    };
  });

  return {
    db: { prepare: preparedFn } as unknown as D1Database,
    _accounts: accounts,
    _accountRepos: accountRepos,
    _namespaces: namespaces,
    _accountRepoCache: accountRepoCache,
    _runs: runs,
  };
}

function makeEnv(dbOverride?: D1Database): Env {
  const mockDb = dbOverride ?? makeD1DatabaseForAccounts().db;
  return {
    COORDINATOR: makeDONamespace(),
    RATE_LIMITER: makeDONamespace(() => ({ remaining: 10, limited: false })),
    STORAGE: makeR2Bucket(),
    DB: mockDb,
    GITHUB_JWKS_URL: "https://token.actions.githubusercontent.com/.well-known/jwks",
    GITHUB_OIDC_AUDIENCE: "orun",
    ORUN_SESSION_SECRET: "test-secret",
    ORUN_DEPLOY_TOKEN: "test-deploy-token",
    GITHUB_CLIENT_ID: "test-client-id",
    GITHUB_CLIENT_SECRET: "test-client-secret",
    ORUN_PUBLIC_URL: "https://api.orun.test",
  } as unknown as Env;
}

function makeDONamespace(responseFactory?: () => unknown): DurableObjectNamespace {
  const stubFetch = vi.fn(async (req: Request) => {
    if (responseFactory) {
      return new Response(JSON.stringify(responseFactory()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    const url = new URL(req.url);
    if (url.pathname === "/init") {
      return new Response(JSON.stringify({ ok: true, alreadyExists: false }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: "Not found", code: "NOT_FOUND" }), { status: 404 });
  });
  const stub = { fetch: stubFetch } as unknown as DurableObjectStub;
  return {
    idFromName: vi.fn(() => ({ toString: () => "test-id" })),
    get: vi.fn(() => stub),
    newUniqueId: vi.fn(),
    idFromString: vi.fn(),
    jurisdiction: vi.fn(),
  } as unknown as DurableObjectNamespace;
}

function makeR2Bucket(): R2Bucket {
  const store = new Map<string, { body: string }>();
  return {
    put: vi.fn(async (key: string, value: unknown) => {
      store.set(key, { body: typeof value === "string" ? value : "stream" });
      return {} as R2Object;
    }),
    get: vi.fn(async (key: string) => {
      const item = store.get(key);
      if (!item) return null;
      return {
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(item.body));
            controller.close();
          },
        }),
        json: async () => JSON.parse(item.body),
        text: async () => item.body,
      } as unknown as R2ObjectBody;
    }),
    delete: vi.fn(async () => {}),
    list: vi.fn(async () => ({ objects: [], truncated: false, cursor: "" })),
    head: vi.fn(),
    createMultipartUpload: vi.fn(),
    resumeMultipartUpload: vi.fn(),
  } as unknown as R2Bucket;
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
    type: "session",
    sessionKind: "dashboard",
    namespace: null,
    allowedNamespaceIds: ["123456"],
    actor: "testuser",
  };
  return {
    ...original,
    authenticate: vi.fn(async () => mockAuthResult),
    buildGitHubOAuthRedirect: vi.fn(async () => Response.redirect("https://github.com/login/oauth/authorize?test=1", 302)),
    handleGitHubOAuthCallback: vi.fn(async () => ({
      sessionToken: "session-jwt-token",
      githubLogin: "testuser",
      githubUserId: "11111",
      allowedNamespaceIds: ["123456", "789"],
      namespaceSlugs: [],
    })),
    OrunError: original.OrunError,
    __setMockAuth: (auth: RequestContext) => { mockAuthResult = auth; },
  };
});

const { __setMockAuth } = await import("../auth") as unknown as {
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

describe("Account & Repo Linking", () => {
  let dbState: ReturnType<typeof makeD1DatabaseForAccounts>;
  let env: Env;
  let ctx: ExecutionContext & { _flush: () => Promise<unknown[]> };

  beforeEach(() => {
    dbState = makeD1DatabaseForAccounts();
    env = makeEnv(dbState.db);
    ctx = makeExecutionContext();
    __setMockAuth({
      type: "session",
      sessionKind: "dashboard",
      namespace: null,
      allowedNamespaceIds: ["123456"],
      actor: "testuser",
    });
  });

  describe("POST /v1/accounts", () => {
    it("creates an account", async () => {
      const resp = await routeRequest(req("POST", "/v1/accounts"), env, ctx);
      expect(resp.status).toBe(200);
      const data = await resp.json() as { accountId: string; githubLogin: string; createdAt: string };
      expect(data.githubLogin).toBe("testuser");
      expect(data.accountId).toBeDefined();
      expect(data.createdAt).toBeDefined();
    });

    it("is idempotent for the same GitHub login", async () => {
      const resp1 = await routeRequest(req("POST", "/v1/accounts"), env, ctx);
      const data1 = await resp1.json() as { accountId: string };

      const resp2 = await routeRequest(req("POST", "/v1/accounts"), env, ctx);
      const data2 = await resp2.json() as { accountId: string };

      expect(data1.accountId).toBe(data2.accountId);
    });

    it("rejects non-session auth", async () => {
      __setMockAuth({
        type: "oidc",
        namespace: { namespaceId: "123456", namespaceSlug: "test/repo" },
        allowedNamespaceIds: ["123456"],
        actor: "test",
      });
      const resp = await routeRequest(req("POST", "/v1/accounts"), env, ctx);
      expect(resp.status).toBe(403);
    });
  });

  describe("GET /v1/accounts/me", () => {
    it("returns the existing account", async () => {
      await routeRequest(req("POST", "/v1/accounts"), env, ctx);
      const resp = await routeRequest(req("GET", "/v1/accounts/me"), env, ctx);
      expect(resp.status).toBe(200);
      const data = await resp.json() as { githubLogin: string };
      expect(data.githubLogin).toBe("testuser");
    });

    it("returns 404 when no account exists", async () => {
      const resp = await routeRequest(req("GET", "/v1/accounts/me"), env, ctx);
      expect(resp.status).toBe(404);
      const data = await resp.json() as { code: string };
      expect(data.code).toBe("NOT_FOUND");
    });
  });

  describe("POST /v1/accounts/repos", () => {
    it("succeeds when GitHub says the user is repo admin", async () => {
      const mockFetch = vi.fn(async (url: string) => {
        if (url.includes("/repos/")) {
          return new Response(JSON.stringify({
            id: 999,
            full_name: "octocat/hello-world",
            owner: { login: "octocat" },
            permissions: { admin: true },
          }), { status: 200 });
        }
        return new Response("not found", { status: 404 });
      });
      vi.stubGlobal("fetch", mockFetch);

      const resp = await routeRequest(
        req("POST", "/v1/accounts/repos", { repoFullName: "octocat/hello-world" }, { "X-GitHub-Access-Token": "ghp_test123" }),
        env, ctx,
      );
      expect(resp.status).toBe(200);
      const data = await resp.json() as { namespaceId: string; namespaceSlug: string; linkedAt: string };
      expect(data.namespaceId).toBe("999");
      expect(data.namespaceSlug).toBe("octocat/hello-world");
      expect(data.linkedAt).toBeDefined();

      vi.unstubAllGlobals();
    });

    it("succeeds when repo admin is false but org membership role is admin", async () => {
      const mockFetch = vi.fn(async (url: string) => {
        if (url.includes("/repos/")) {
          return new Response(JSON.stringify({
            id: 888,
            full_name: "myorg/private-repo",
            owner: { login: "myorg" },
            permissions: { admin: false },
          }), { status: 200 });
        }
        if (url.includes("/orgs/") && url.includes("/memberships/")) {
          return new Response(JSON.stringify({ role: "admin" }), { status: 200 });
        }
        return new Response("not found", { status: 404 });
      });
      vi.stubGlobal("fetch", mockFetch);

      const resp = await routeRequest(
        req("POST", "/v1/accounts/repos", { repoFullName: "myorg/private-repo" }, { "X-GitHub-Access-Token": "ghp_test123" }),
        env, ctx,
      );
      expect(resp.status).toBe(200);
      const data = await resp.json() as { namespaceId: string };
      expect(data.namespaceId).toBe("888");

      vi.unstubAllGlobals();
    });

    it("rejects non-admin users with 403", async () => {
      const mockFetch = vi.fn(async (url: string) => {
        if (url.includes("/repos/")) {
          return new Response(JSON.stringify({
            id: 777,
            full_name: "someorg/repo",
            owner: { login: "someorg" },
            permissions: { admin: false },
          }), { status: 200 });
        }
        if (url.includes("/orgs/")) {
          return new Response(JSON.stringify({ role: "member" }), { status: 200 });
        }
        return new Response("not found", { status: 404 });
      });
      vi.stubGlobal("fetch", mockFetch);

      const resp = await routeRequest(
        req("POST", "/v1/accounts/repos", { repoFullName: "someorg/repo" }, { "X-GitHub-Access-Token": "ghp_test" }),
        env, ctx,
      );
      expect(resp.status).toBe(403);

      vi.unstubAllGlobals();
    });

    it("maps repo not found to 404", async () => {
      const mockFetch = vi.fn(async () => new Response("not found", { status: 404 }));
      vi.stubGlobal("fetch", mockFetch);

      const resp = await routeRequest(
        req("POST", "/v1/accounts/repos", { repoFullName: "owner/missing" }, { "X-GitHub-Access-Token": "ghp_test" }),
        env, ctx,
      );
      expect(resp.status).toBe(404);

      vi.unstubAllGlobals();
    });

    it("maps missing GitHub token to UNAUTHORIZED", async () => {
      const resp = await routeRequest(
        req("POST", "/v1/accounts/repos", { repoFullName: "owner/repo" }),
        env, ctx,
      );
      expect(resp.status).toBe(401);
      const data = await resp.json() as { code: string };
      expect(data.code).toBe("UNAUTHORIZED");
    });

    it("maps non-OK GitHub API failures to 500", async () => {
      const mockFetch = vi.fn(async () => new Response("error", { status: 502 }));
      vi.stubGlobal("fetch", mockFetch);

      const resp = await routeRequest(
        req("POST", "/v1/accounts/repos", { repoFullName: "owner/repo" }, { "X-GitHub-Access-Token": "ghp_test" }),
        env, ctx,
      );
      expect(resp.status).toBe(500);

      vi.unstubAllGlobals();
    });

    it("link creation is idempotent and preserves the original linkedAt", async () => {
      const mockFetch = vi.fn(async (url: string) => {
        if (url.includes("/repos/")) {
          return new Response(JSON.stringify({
            id: 999,
            full_name: "octocat/hello-world",
            owner: { login: "octocat" },
            permissions: { admin: true },
          }), { status: 200 });
        }
        return new Response("not found", { status: 404 });
      });
      vi.stubGlobal("fetch", mockFetch);

      const resp1 = await routeRequest(
        req("POST", "/v1/accounts/repos", { repoFullName: "octocat/hello-world" }, { "X-GitHub-Access-Token": "ghp_test" }),
        env, ctx,
      );
      const data1 = await resp1.json() as { linkedAt: string };

      const resp2 = await routeRequest(
        req("POST", "/v1/accounts/repos", { repoFullName: "octocat/hello-world" }, { "X-GitHub-Access-Token": "ghp_test" }),
        env, ctx,
      );
      const data2 = await resp2.json() as { linkedAt: string };

      expect(data1.linkedAt).toBe(data2.linkedAt);

      vi.unstubAllGlobals();
    });
  });

  describe("GET /v1/accounts/repos", () => {
    it("lists linked repos in newest-first order", async () => {
      await routeRequest(req("POST", "/v1/accounts"), env, ctx);

      const mockFetch = vi.fn(async (url: string) => {
        if (url.includes("/repos/")) {
          const id = url.includes("repo-a") ? 111 : 222;
          const name = url.includes("repo-a") ? "owner/repo-a" : "owner/repo-b";
          return new Response(JSON.stringify({
            id,
            full_name: name,
            owner: { login: "owner" },
            permissions: { admin: true },
          }), { status: 200 });
        }
        return new Response("not found", { status: 404 });
      });
      vi.stubGlobal("fetch", mockFetch);

      await routeRequest(
        req("POST", "/v1/accounts/repos", { repoFullName: "owner/repo-a" }, { "X-GitHub-Access-Token": "ghp_test" }),
        env, ctx,
      );
      await routeRequest(
        req("POST", "/v1/accounts/repos", { repoFullName: "owner/repo-b" }, { "X-GitHub-Access-Token": "ghp_test" }),
        env, ctx,
      );

      vi.unstubAllGlobals();

      const resp = await routeRequest(req("GET", "/v1/accounts/repos"), env, ctx);
      expect(resp.status).toBe(200);
      const data = await resp.json() as { repos: { namespaceId: string }[] };
      expect(data.repos).toHaveLength(2);
    });

    it("returns an empty array when the account does not exist", async () => {
      const resp = await routeRequest(req("GET", "/v1/accounts/repos"), env, ctx);
      expect(resp.status).toBe(200);
      const data = await resp.json() as { repos: unknown[] };
      expect(data.repos).toEqual([]);
    });
  });

  describe("DELETE /v1/accounts/repos/:namespaceId", () => {
    it("removes only the link", async () => {
      await routeRequest(req("POST", "/v1/accounts"), env, ctx);

      const mockFetch = vi.fn(async (url: string) => {
        if (url.includes("/repos/")) {
          return new Response(JSON.stringify({
            id: 999,
            full_name: "octocat/hello-world",
            owner: { login: "octocat" },
            permissions: { admin: true },
          }), { status: 200 });
        }
        return new Response("not found", { status: 404 });
      });
      vi.stubGlobal("fetch", mockFetch);

      await routeRequest(
        req("POST", "/v1/accounts/repos", { repoFullName: "octocat/hello-world" }, { "X-GitHub-Access-Token": "ghp_test" }),
        env, ctx,
      );
      vi.unstubAllGlobals();

      const delResp = await routeRequest(req("DELETE", "/v1/accounts/repos/999"), env, ctx);
      expect(delResp.status).toBe(200);
      const delData = await delResp.json() as { ok: boolean };
      expect(delData.ok).toBe(true);

      const listResp = await routeRequest(req("GET", "/v1/accounts/repos"), env, ctx);
      const listData = await listResp.json() as { repos: unknown[] };
      expect(listData.repos).toHaveLength(0);

      expect(dbState._namespaces["999"]).toBeDefined();
    });

    it("is idempotent when link or account does not exist", async () => {
      const resp = await routeRequest(req("DELETE", "/v1/accounts/repos/nonexistent"), env, ctx);
      expect(resp.status).toBe(200);
      const data = await resp.json() as { ok: boolean };
      expect(data.ok).toBe(true);
    });
  });
});

describe("verifyRepoAdminAccess", () => {
  let verifyRepoAdminAccess: typeof import("./accounts").verifyRepoAdminAccess;

  beforeEach(async () => {
    const mod = await import("./accounts");
    verifyRepoAdminAccess = mod.verifyRepoAdminAccess;
  });

  it("validates repoFullName format", async () => {
    const mockFetch = vi.fn();
    await expect(verifyRepoAdminAccess("user", "", "token", mockFetch)).rejects.toThrow("repoFullName");
    await expect(verifyRepoAdminAccess("user", "no-slash", "token", mockFetch)).rejects.toThrow("owner/repo");
    await expect(verifyRepoAdminAccess("user", "a/b/c", "token", mockFetch)).rejects.toThrow("owner/repo");
    await expect(verifyRepoAdminAccess("user", "/repo", "token", mockFetch)).rejects.toThrow();
    await expect(verifyRepoAdminAccess("user", "owner/", "token", mockFetch)).rejects.toThrow();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects traversal segments", async () => {
    const mockFetch = vi.fn();
    await expect(verifyRepoAdminAccess("user", "../etc/passwd", "token", mockFetch)).rejects.toThrow();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects empty GitHub access token", async () => {
    const mockFetch = vi.fn();
    await expect(verifyRepoAdminAccess("user", "owner/repo", "", mockFetch)).rejects.toThrow("GitHub access token");
  });

  it("sends correct GitHub API headers", async () => {
    const mockFetch = vi.fn(async () => new Response(JSON.stringify({
      id: 1, full_name: "owner/repo", owner: { login: "owner" }, permissions: { admin: true },
    }), { status: 200 }));

    await verifyRepoAdminAccess("user", "owner/repo", "my-token", mockFetch);

    const call = mockFetch.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
    const [url, opts] = call;
    expect(url).toBe("https://api.github.com/repos/owner/repo");
    expect(opts.headers.Authorization).toBe("Bearer my-token");
    expect(opts.headers.Accept).toBe("application/vnd.github+json");
    expect(opts.headers["User-Agent"]).toBe("orun-backend-account-linking");
  });

  it("returns verified repo metadata for admin user", async () => {
    const mockFetch = vi.fn(async () => new Response(JSON.stringify({
      id: 42, full_name: "org/repo", owner: { login: "org" }, permissions: { admin: true },
    }), { status: 200 }));

    const result = await verifyRepoAdminAccess("user", "org/repo", "token", mockFetch);
    expect(result).toEqual({ namespaceId: "42", namespaceSlug: "org/repo" });
  });
});

describe("resolveSessionNamespaceIds", () => {
  let resolveSessionNamespaceIds: typeof import("./accounts").resolveSessionNamespaceIds;
  beforeEach(async () => {
    const mod = await import("./accounts");
    resolveSessionNamespaceIds = mod.resolveSessionNamespaceIds;
  });

  it("unions JWT namespaces and linked repos", async () => {
    const dbState = makeD1DatabaseForAccounts();
    const { getOrCreateAccount, linkRepo } = await import("./accounts");

    const account = await getOrCreateAccount(dbState.db, "testuser");
    dbState._namespaces["linked-ns"] = { namespace_id: "linked-ns", namespace_slug: "org/linked", namespace_kind: "repo", last_seen_at: "t" };
    await linkRepo(dbState.db, account.account_id, "linked-ns", "org/linked", "testuser");

    const authCtx: RequestContext = {
      type: "session",
      sessionKind: "dashboard",
      namespace: null,
      allowedNamespaceIds: ["jwt-ns"],
      actor: "testuser",
    };

    const result = await resolveSessionNamespaceIds(authCtx, dbState.db);
    expect(result).toContain("jwt-ns");
    expect(result).toContain("linked-ns");
  });

  it("dedupes namespace IDs", async () => {
    const dbState = makeD1DatabaseForAccounts();
    const { getOrCreateAccount, linkRepo } = await import("./accounts");

    const account = await getOrCreateAccount(dbState.db, "testuser");
    dbState._namespaces["shared-ns"] = { namespace_id: "shared-ns", namespace_slug: "org/shared", namespace_kind: "repo", last_seen_at: "t" };
    await linkRepo(dbState.db, account.account_id, "shared-ns", "org/shared", "testuser");

    const authCtx: RequestContext = {
      type: "session",
      sessionKind: "dashboard",
      namespace: null,
      allowedNamespaceIds: ["shared-ns"],
      actor: "testuser",
    };

    const result = await resolveSessionNamespaceIds(authCtx, dbState.db);
    const sharedCount = result.filter((id) => id === "shared-ns").length;
    expect(sharedCount).toBe(1);
  });

  it("returns JWT namespaces when no account exists", async () => {
    const dbState = makeD1DatabaseForAccounts();

    const authCtx: RequestContext = {
      type: "session",
      sessionKind: "dashboard",
      namespace: null,
      allowedNamespaceIds: ["ns-1", "ns-2"],
      actor: "noone",
    };

    const result = await resolveSessionNamespaceIds(authCtx, dbState.db);
    expect(result).toEqual(["ns-1", "ns-2"]);
  });
});

describe("Session reads with linked namespaces", () => {
  let dbState: ReturnType<typeof makeD1DatabaseForAccounts>;
  let env: Env;
  let ctx: ExecutionContext & { _flush: () => Promise<unknown[]> };

  beforeEach(async () => {
    dbState = makeD1DatabaseForAccounts();
    env = makeEnv(dbState.db);
    ctx = makeExecutionContext();

    __setMockAuth({
      type: "session",
      sessionKind: "dashboard",
      namespace: null,
      allowedNamespaceIds: ["jwt-ns"],
      actor: "testuser",
    });

    const { getOrCreateAccount, linkRepo } = await import("./accounts");
    const account = await getOrCreateAccount(dbState.db, "testuser");
    dbState._namespaces["linked-ns"] = { namespace_id: "linked-ns", namespace_slug: "org/linked", namespace_kind: "repo", last_seen_at: "t" };
    await linkRepo(dbState.db, account.account_id, "linked-ns", "org/linked", "testuser");

    dbState._runs["linked-ns:run-linked"] = {
      run_id: "run-linked", namespace_id: "linked-ns", status: "running",
      plan_checksum: "abc", trigger_type: "ci", actor: "test",
      dry_run: 0, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
      finished_at: null, job_total: 1, job_done: 0, job_failed: 0,
      expires_at: "2026-01-02T00:00:00Z",
    };
  });

  it("GET /v1/runs with session auth sees runs from linked repo namespaces", async () => {
    const resp = await routeRequest(req("GET", "/v1/runs"), env, ctx);
    expect(resp.status).toBe(200);
    const data = await resp.json() as { runs: { runId: string }[] };
    const linkedRun = data.runs.find((r) => r.runId === "run-linked");
    expect(linkedRun).toBeDefined();
  });

  it("GET /v1/runs/:runId with session auth can access linked namespace run", async () => {
    const resp = await routeRequest(req("GET", "/v1/runs/run-linked"), env, ctx);
    expect(resp.status).toBe(200);
    const data = await resp.json() as { run: { runId: string } };
    expect(data.run.runId).toBe("run-linked");
  });

  it("session read rejects unlinked namespaces", async () => {
    dbState._runs["unlinked-ns:run-unlinked"] = {
      run_id: "run-unlinked", namespace_id: "unlinked-ns", status: "running",
      plan_checksum: "abc", trigger_type: "ci", actor: "test",
      dry_run: 0, created_at: "t", updated_at: "t",
      finished_at: null, job_total: 1, job_done: 0, job_failed: 0,
      expires_at: "2026-01-02T00:00:00Z",
    };
    const resp = await routeRequest(req("GET", "/v1/runs/run-unlinked"), env, ctx);
    expect(resp.status).toBe(404);
  });
});

describe("POST /v1/accounts/repos/link — CLI session local namespace", () => {
  let dbState: ReturnType<typeof makeD1DatabaseForAccounts>;
  let env: Env;
  let ctx: ExecutionContext & { _flush: () => Promise<unknown[]> };

  beforeEach(() => {
    dbState = makeD1DatabaseForAccounts();
    env = makeEnv(dbState.db);
    ctx = makeExecutionContext();
    // Seed: account for testuser with github_user_id "11111"
    dbState._accounts["testuser"] = {
      account_id: "acct-1",
      github_login: "testuser",
      github_user_id: "11111",
      created_at: "2026-01-01T00:00:00Z",
    };
    // Seed: account_repo_cache entry linking "acct-1" to repo ID "987654321" / "sourceplane/orun"
    dbState._accountRepoCache["acct-1:987654321"] = {
      account_id: "acct-1",
      repo_id: "987654321",
      repo_full_name: "sourceplane/orun",
      last_seen_at: "2026-01-01T00:00:00Z",
    };
    __setMockAuth({
      type: "session",
      sessionKind: "cli",
      namespace: null,
      allowedNamespaceIds: [],
      actor: "testuser",
      githubUserId: "11111",
    });
  });

  it("returns a local namespace from the account-scoped repo cache", async () => {
    const resp = await routeRequest(
      req("POST", "/v1/accounts/repos/link", { repoFullName: "sourceplane/orun" }),
      env, ctx,
    );
    expect(resp.status).toBe(200);
    const data = await resp.json() as {
      namespaceKind: string;
      namespaceId: string;
      namespaceSlug: string;
      repoId: string;
      repoFullName: string;
      linkedAt: string;
    };
    expect(data.namespaceKind).toBe("local");
    expect(data.namespaceId).toBe("local:user:11111:repo:987654321");
    expect(data.namespaceSlug).toBe("local:testuser/sourceplane/orun");
    expect(data.repoId).toBe("987654321");
    expect(data.repoFullName).toBe("sourceplane/orun");
    expect(data.linkedAt).toBeDefined();
  });

  it("is idempotent — calling twice returns the same linkedAt", async () => {
    const resp1 = await routeRequest(
      req("POST", "/v1/accounts/repos/link", { repoFullName: "sourceplane/orun" }),
      env, ctx,
    );
    const data1 = await resp1.json() as { linkedAt: string };

    const resp2 = await routeRequest(
      req("POST", "/v1/accounts/repos/link", { repoFullName: "sourceplane/orun" }),
      env, ctx,
    );
    const data2 = await resp2.json() as { linkedAt: string };

    expect(data1.linkedAt).toBe(data2.linkedAt);
  });

  it("rejects dashboard sessions with 403", async () => {
    __setMockAuth({
      type: "session",
      sessionKind: "dashboard",
      namespace: null,
      allowedNamespaceIds: [],
      actor: "testuser",
    });
    const resp = await routeRequest(
      req("POST", "/v1/accounts/repos/link", { repoFullName: "sourceplane/orun" }),
      env, ctx,
    );
    expect(resp.status).toBe(403);
    const data = await resp.json() as { code: string };
    expect(data.code).toBe("FORBIDDEN");
  });

  it("rejects CLI session missing githubUserId with 403", async () => {
    __setMockAuth({
      type: "session",
      sessionKind: "cli",
      namespace: null,
      allowedNamespaceIds: [],
      actor: "testuser",
      // no githubUserId
    });
    const resp = await routeRequest(
      req("POST", "/v1/accounts/repos/link", { repoFullName: "sourceplane/orun" }),
      env, ctx,
    );
    expect(resp.status).toBe(403);
    const data = await resp.json() as { code: string; error: string };
    expect(data.code).toBe("FORBIDDEN");
    expect(data.error).toMatch(/orun auth login/);
  });

  it("returns NOT_FOUND for a repo not in the caller's account-scoped cache", async () => {
    // "other/repo" is not in dbState._accountRepoCache for acct-1
    const resp = await routeRequest(
      req("POST", "/v1/accounts/repos/link", { repoFullName: "other/repo" }),
      env, ctx,
    );
    expect(resp.status).toBe(404);
    const data = await resp.json() as { code: string; error: string };
    expect(data.code).toBe("NOT_FOUND");
    expect(data.error).toMatch(/orun auth login/);
  });

  it("does not fall back to global namespaces table when repo is unknown to caller", async () => {
    // A repo slug exists globally (e.g., added by another admin user) but is NOT in
    // acct-1's account_repo_cache. The link endpoint must reject it.
    dbState._namespaces["999999"] = {
      namespace_id: "999999",
      namespace_slug: "foreign/repo",
      namespace_kind: "repo",
      last_seen_at: "t",
    };
    // acct-1 has no account_repo_cache entry for "foreign/repo"
    const resp = await routeRequest(
      req("POST", "/v1/accounts/repos/link", { repoFullName: "foreign/repo" }),
      env, ctx,
    );
    expect(resp.status).toBe(404);
    const data = await resp.json() as { code: string };
    expect(data.code).toBe("NOT_FOUND");
  });

  it("does not require X-GitHub-Access-Token", async () => {
    const resp = await routeRequest(
      req("POST", "/v1/accounts/repos/link", { repoFullName: "sourceplane/orun" }),
      env, ctx,
    );
    expect(resp.status).toBe(200);
  });

  it("returns INVALID_REQUEST for missing repoFullName", async () => {
    const resp = await routeRequest(
      req("POST", "/v1/accounts/repos/link", {}),
      env, ctx,
    );
    expect(resp.status).toBe(400);
    const data = await resp.json() as { code: string };
    expect(data.code).toBe("INVALID_REQUEST");
  });

  it("returns INVALID_REQUEST for malformed repoFullName", async () => {
    const resp = await routeRequest(
      req("POST", "/v1/accounts/repos/link", { repoFullName: "no-slash-here" }),
      env, ctx,
    );
    expect(resp.status).toBe(400);
  });

  it("two users linking the same repo receive different local namespace IDs", async () => {
    // User A: githubUserId=11111, acct-1 already seeded
    // User B: githubUserId=22222
    dbState._accounts["userB"] = {
      account_id: "acct-2",
      github_login: "userB",
      github_user_id: "22222",
      created_at: "2026-01-01T00:00:00Z",
    };
    dbState._accountRepoCache["acct-2:987654321"] = {
      account_id: "acct-2",
      repo_id: "987654321",
      repo_full_name: "sourceplane/orun",
      last_seen_at: "2026-01-01T00:00:00Z",
    };

    const respA = await routeRequest(
      req("POST", "/v1/accounts/repos/link", { repoFullName: "sourceplane/orun" }),
      env, ctx,
    );
    const dataA = await respA.json() as { namespaceId: string };

    __setMockAuth({
      type: "session",
      sessionKind: "cli",
      namespace: null,
      allowedNamespaceIds: [],
      actor: "userB",
      githubUserId: "22222",
    });

    const respB = await routeRequest(
      req("POST", "/v1/accounts/repos/link", { repoFullName: "sourceplane/orun" }),
      env, ctx,
    );
    const dataB = await respB.json() as { namespaceId: string };

    expect(dataA.namespaceId).toBe("local:user:11111:repo:987654321");
    expect(dataB.namespaceId).toBe("local:user:22222:repo:987654321");
    expect(dataA.namespaceId).not.toBe(dataB.namespaceId);
  });
});

describe("POST /v1/runs — CLI session local namespace derivation", () => {
  let dbState: ReturnType<typeof makeD1DatabaseForAccounts>;
  let env: Env;
  let ctx: ExecutionContext & { _flush: () => Promise<unknown[]> };

  const minPlan = {
    checksum: "abc123",
    version: "1",
    jobs: [{ jobId: "j1", component: "c", deps: [], steps: [] }],
    createdAt: "t",
  };

  beforeEach(() => {
    dbState = makeD1DatabaseForAccounts();
    env = makeEnv(dbState.db);
    ctx = makeExecutionContext();

    dbState._accounts["testuser"] = {
      account_id: "acct-1",
      github_login: "testuser",
      github_user_id: "11111",
      created_at: "2026-01-01T00:00:00Z",
    };
    dbState._accountRepoCache["acct-1:987654321"] = {
      account_id: "acct-1",
      repo_id: "987654321",
      repo_full_name: "sourceplane/orun",
      last_seen_at: "2026-01-01T00:00:00Z",
    };
    dbState._namespaces["local:user:11111:repo:987654321"] = {
      namespace_id: "local:user:11111:repo:987654321",
      namespace_slug: "local:testuser/sourceplane/orun",
      namespace_kind: "local",
      last_seen_at: "2026-01-01T00:00:00Z",
    };

    __setMockAuth({
      type: "session",
      sessionKind: "cli",
      namespace: null,
      allowedNamespaceIds: [],
      actor: "testuser",
      githubUserId: "11111",
    });
  });

  it("derives local namespace from repoFullName", async () => {
    const resp = await routeRequest(
      req("POST", "/v1/runs", { plan: minPlan, repoFullName: "sourceplane/orun" }),
      env, ctx,
    );
    expect(resp.status).toBe(201);
    const data = await resp.json() as { runId: string };
    expect(data.runId).toBeDefined();
  });

  it("accepts a correct pre-computed local namespaceId", async () => {
    const resp = await routeRequest(
      req("POST", "/v1/runs", {
        plan: minPlan,
        namespaceId: "local:user:11111:repo:987654321",
      }),
      env, ctx,
    );
    expect(resp.status).toBe(201);
  });

  it("rejects a mismatched local namespaceId", async () => {
    const resp = await routeRequest(
      req("POST", "/v1/runs", {
        plan: minPlan,
        repoFullName: "sourceplane/orun",
        namespaceId: "local:user:11111:repo:WRONG",
      }),
      env, ctx,
    );
    expect(resp.status).toBe(403);
    const data = await resp.json() as { code: string };
    expect(data.code).toBe("FORBIDDEN");
  });

  it("rejects session attempts to create under canonical repo namespace IDs", async () => {
    const resp = await routeRequest(
      req("POST", "/v1/runs", {
        plan: minPlan,
        namespaceId: "987654321",
      }),
      env, ctx,
    );
    expect(resp.status).toBe(403);
    const data = await resp.json() as { code: string };
    expect(data.code).toBe("FORBIDDEN");
  });

  it("rejects CLI session missing githubUserId with 403", async () => {
    __setMockAuth({
      type: "session",
      sessionKind: "cli",
      namespace: null,
      allowedNamespaceIds: [],
      actor: "testuser",
      // no githubUserId
    });
    const resp = await routeRequest(
      req("POST", "/v1/runs", { plan: minPlan, repoFullName: "sourceplane/orun" }),
      env, ctx,
    );
    expect(resp.status).toBe(403);
  });

  it("returns NOT_FOUND when repoFullName is not in the caller's repo cache", async () => {
    const resp = await routeRequest(
      req("POST", "/v1/runs", { plan: minPlan, repoFullName: "not/cached" }),
      env, ctx,
    );
    expect(resp.status).toBe(404);
    const data = await resp.json() as { code: string };
    expect(data.code).toBe("NOT_FOUND");
  });

  it("rejects dashboard sessions from creating runs", async () => {
    __setMockAuth({
      type: "session",
      sessionKind: "dashboard",
      namespace: null,
      allowedNamespaceIds: ["123456"],
      actor: "testuser",
    });
    const resp = await routeRequest(
      req("POST", "/v1/runs", { plan: minPlan, repoFullName: "sourceplane/orun" }),
      env, ctx,
    );
    expect(resp.status).toBe(403);
  });
});

describe("upsertBulkNamespaceSlugs", () => {
  it("upserts multiple namespace slug mappings into D1", async () => {
    const { upsertBulkNamespaceSlugs } = await import("./accounts");
    const dbState = makeD1DatabaseForAccounts();

    await upsertBulkNamespaceSlugs(dbState.db, [
      { id: "ns-a", slug: "org/repo-a" },
      { id: "ns-b", slug: "org/repo-b" },
    ]);

    expect(dbState._namespaces["ns-a"]).toMatchObject({ namespace_id: "ns-a", namespace_slug: "org/repo-a" });
    expect(dbState._namespaces["ns-b"]).toMatchObject({ namespace_id: "ns-b", namespace_slug: "org/repo-b" });
  });

  it("updates existing slug on conflict", async () => {
    const { upsertBulkNamespaceSlugs } = await import("./accounts");
    const dbState = makeD1DatabaseForAccounts();
    dbState._namespaces["ns-a"] = { namespace_id: "ns-a", namespace_slug: "old/slug", namespace_kind: "repo", last_seen_at: "t" };

    await upsertBulkNamespaceSlugs(dbState.db, [{ id: "ns-a", slug: "new/slug" }]);

    expect(dbState._namespaces["ns-a"].namespace_slug).toBe("new/slug");
  });

  it("no-ops for empty array", async () => {
    const { upsertBulkNamespaceSlugs } = await import("./accounts");
    const dbState = makeD1DatabaseForAccounts();
    await expect(upsertBulkNamespaceSlugs(dbState.db, [])).resolves.toBeUndefined();
  });
});

describe("upsertAccountRepoCache", () => {
  it("stores repos in the account-scoped cache", async () => {
    const { upsertAccountRepoCache, getOrCreateAccount } = await import("./accounts");
    const dbState = makeD1DatabaseForAccounts();
    const account = await getOrCreateAccount(dbState.db, "alice");

    await upsertAccountRepoCache(dbState.db, account.account_id, [
      { id: "111", slug: "alice/repo-a" },
      { id: "222", slug: "alice/repo-b" },
    ]);

    expect(dbState._accountRepoCache[`${account.account_id}:111`]).toMatchObject({
      repo_id: "111",
      repo_full_name: "alice/repo-a",
    });
    expect(dbState._accountRepoCache[`${account.account_id}:222`]).toMatchObject({
      repo_id: "222",
      repo_full_name: "alice/repo-b",
    });
  });
});
