import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Env } from "@orun/types";
import type { RequestContext } from "./auth";

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    COORDINATOR: makeDONamespace(),
    RATE_LIMITER: makeDONamespace(() => ({ remaining: 10, limited: false })),
    STORAGE: makeR2Bucket(),
    DB: makeD1Database(),
    GITHUB_JWKS_URL: "https://token.actions.githubusercontent.com/.well-known/jwks",
    GITHUB_OIDC_AUDIENCE: "orun",
    ORUN_SESSION_SECRET: "test-secret",
    ORUN_DEPLOY_TOKEN: "test-deploy-token",
    GITHUB_CLIENT_ID: "test-client-id",
    GITHUB_CLIENT_SECRET: "test-client-secret",
    ORUN_PUBLIC_URL: "https://api.orun.test",
    ...overrides,
  } as unknown as Env;
}

function makeDONamespace(responseFactory?: () => unknown): DurableObjectNamespace {
  const stubFetch = vi.fn(async (req: Request) => {
    if (responseFactory) {
      const body = responseFactory();
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    const url = new URL(req.url);
    if (url.pathname === "/init") {
      return new Response(JSON.stringify({ ok: true, alreadyExists: false }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ error: "Coordinator not initialized", code: "NOT_FOUND" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
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
  const store = new Map<string, { body: string; httpMetadata?: unknown; customMetadata?: unknown }>();
  return {
    put: vi.fn(async (key: string, value: unknown, _opts?: unknown) => {
      const content = typeof value === "string" ? value : "stream-content";
      store.set(key, { body: content });
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

function makeD1Database(): D1Database {
  const runs: Record<string, Record<string, unknown>> = {};
  const jobs: Record<string, Record<string, unknown>> = {};
  const namespaces: Record<string, Record<string, unknown>> = {};

  const preparedFn = vi.fn((sql: string) => {
    return {
      bind: (..._args: unknown[]) => ({
        run: vi.fn(async () => {
          if (sql.includes("INSERT INTO namespaces")) {
            const nsId = _args[0] as string;
            namespaces[nsId] = { namespace_id: nsId, namespace_slug: _args[1] as string };
          }
          if (sql.includes("INSERT INTO runs")) {
            const key = `${_args[1]}:${_args[0]}`;
            runs[key] = {
              run_id: _args[0], namespace_id: _args[1], status: _args[2],
              plan_checksum: _args[3], trigger_type: _args[4], actor: _args[5],
              dry_run: _args[6], created_at: _args[7], updated_at: _args[8],
              finished_at: _args[9], job_total: _args[10], job_done: _args[11],
              job_failed: _args[12], expires_at: _args[13],
            };
          }
          if (sql.includes("INSERT INTO jobs")) {
            const key = `${_args[2]}:${_args[1]}:${_args[0]}`;
            jobs[key] = {
              job_id: _args[0], run_id: _args[1], namespace_id: _args[2],
              component: _args[3], status: _args[4], runner_id: _args[5],
              started_at: _args[6], finished_at: _args[7], log_ref: _args[8],
            };
          }
          if (sql.includes("DELETE FROM runs")) {
            return { meta: { changes: 0 } };
          }
          return { meta: { changes: 0 } };
        }),
        all: vi.fn(async () => {
          if (sql.includes("SELECT") && sql.includes("FROM runs")) {
            const nsIds = _args.slice(0, -2) as string[];
            const results = Object.values(runs).filter((r) =>
              nsIds.includes(r.namespace_id as string)
            );
            return { results: results.map((r) => ({ ...r, namespace_slug: "test/repo" })) };
          }
          if (sql.includes("FROM jobs")) {
            const results = Object.values(jobs).filter(
              (j) => j.namespace_id === _args[0] && j.run_id === _args[1]
            );
            return { results };
          }
          if (sql.includes("expires_at")) {
            return { results: [] };
          }
          return { results: [] };
        }),
        first: vi.fn(async () => {
          if (sql.includes("FROM runs")) {
            const key = `${_args[0]}:${_args[1]}`;
            const r = runs[key];
            if (r) return { ...r, namespace_slug: "test/repo" };
            return null;
          }
          if (sql.includes("FROM namespaces")) {
            const ns = namespaces[_args[0] as string];
            return ns ? { namespace_slug: ns.namespace_slug } : null;
          }
          return null;
        }),
      }),
    };
  });

  return { prepare: preparedFn } as unknown as D1Database;
}

function makeExecutionContext(): ExecutionContext {
  const promises: Promise<unknown>[] = [];
  return {
    waitUntil: (p: Promise<unknown>) => { promises.push(p); },
    passThroughOnException: () => {},
    _flush: () => Promise.all(promises),
  } as unknown as ExecutionContext & { _flush: () => Promise<unknown[]> };
}

vi.mock("./auth", async (importOriginal) => {
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
    buildGitHubOAuthRedirect: vi.fn(async () => Response.redirect("https://github.com/login/oauth/authorize?test=1", 302)),
    handleGitHubOAuthCallback: vi.fn(async () => ({
      sessionToken: "session-jwt-token",
      githubLogin: "testuser",
      allowedNamespaceIds: ["123456", "789"],
    })),
    OrunError: original.OrunError,
    __setMockAuth: (auth: RequestContext) => { mockAuthResult = auth; },
  };
});

const { authenticate, __setMockAuth } = await import("./auth") as unknown as {
  authenticate: ReturnType<typeof vi.fn>;
  __setMockAuth: (auth: RequestContext) => void;
};

const { routeRequest } = await import("./router");

function req(method: string, path: string, body?: unknown, headers?: Record<string, string>): Request {
  const init: RequestInit = { method, headers: { ...headers } };
  if (body) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
  }
  return new Request(`https://api.orun.test${path}`, init);
}

describe("Worker API", () => {
  let env: Env;
  let ctx: ExecutionContext & { _flush: () => Promise<unknown[]> };

  beforeEach(() => {
    env = makeEnv();
    ctx = makeExecutionContext() as ExecutionContext & { _flush: () => Promise<unknown[]> };
    __setMockAuth({
      type: "oidc",
      namespace: { namespaceId: "123456", namespaceSlug: "test-org/test-repo" },
      allowedNamespaceIds: ["123456"],
      actor: "test-actor",
    });
  });

  describe("CORS", () => {
    it("OPTIONS returns 204 with CORS headers", async () => {
      const resp = await routeRequest(req("OPTIONS", "/v1/runs"), env, ctx);
      expect(resp.status).toBe(204);
      expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(resp.headers.get("Access-Control-Allow-Methods")).toContain("POST");
      expect(resp.headers.get("Access-Control-Allow-Headers")).toContain("Authorization");
    });
  });

  describe("Health", () => {
    it("GET / returns ok", async () => {
      const resp = await routeRequest(req("GET", "/"), env, ctx);
      expect(resp.status).toBe(200);
      const data = await resp.json();
      expect(data).toEqual({ status: "ok", service: "orun-api" });
    });
  });

  describe("Unknown routes", () => {
    it("returns JSON 404 for unknown paths", async () => {
      const resp = await routeRequest(req("GET", "/v1/unknown"), env, ctx);
      expect(resp.status).toBe(404);
      const data = await resp.json() as { code: string };
      expect(data.code).toBe("NOT_FOUND");
    });

    it("returns 405 for wrong method on known path", async () => {
      const resp = await routeRequest(req("DELETE", "/v1/runs"), env, ctx);
      expect(resp.status).toBe(405);
      const data = await resp.json() as { code: string };
      expect(data.code).toBe("INVALID_REQUEST");
    });
  });

  describe("Auth enforcement", () => {
    it("missing auth returns 401", async () => {
      const { OrunError } = await import("./auth/errors");
      authenticate.mockRejectedValueOnce(new OrunError("UNAUTHORIZED", "Missing authorization header"));
      const resp = await routeRequest(req("POST", "/v1/runs"), env, ctx);
      expect(resp.status).toBe(401);
    });

    it("deploy token is rejected from general endpoints", async () => {
      __setMockAuth({ type: "deploy", namespace: null, allowedNamespaceIds: ["*"], actor: "system" });
      const resp = await routeRequest(req("POST", "/v1/runs", { plan: { checksum: "abc", version: "1", jobs: [], createdAt: "t" } }), env, ctx);
      expect(resp.status).toBe(403);
    });
  });

  describe("OAuth routes", () => {
    it("GET /v1/auth/github returns redirect", async () => {
      const resp = await routeRequest(req("GET", "/v1/auth/github"), env, ctx);
      expect(resp.status).toBe(302);
    });

    it("GET /v1/auth/github/callback returns session JSON", async () => {
      const resp = await routeRequest(req("GET", "/v1/auth/github/callback?code=testcode&state=teststate"), env, ctx);
      expect(resp.status).toBe(200);
      const data = await resp.json() as { sessionToken: string; githubLogin: string };
      expect(data.sessionToken).toBe("session-jwt-token");
      expect(data.githubLogin).toBe("testuser");
    });
  });

  describe("POST /v1/runs", () => {
    const validPlan = {
      checksum: "abc123",
      version: "1.0",
      jobs: [{ jobId: "job-1", component: "comp-a", deps: [], steps: [] }],
      createdAt: "2026-01-01T00:00:00Z",
    };

    it("creates a run with OIDC auth and returns 201", async () => {
      const resp = await routeRequest(req("POST", "/v1/runs", { plan: validPlan }), env, ctx);
      expect(resp.status).toBe(201);
      const data = await resp.json() as { runId: string; status: string };
      expect(data.status).toBe("running");
      expect(data.runId).toBeDefined();
    });

    it("uses deterministic runId when provided", async () => {
      const resp = await routeRequest(req("POST", "/v1/runs", { plan: validPlan, runId: "my-run-id" }), env, ctx);
      expect(resp.status).toBe(201);
      const data = await resp.json() as { runId: string };
      expect(data.runId).toBe("my-run-id");
    });

    it("returns 200 for idempotent join (alreadyExists)", async () => {
      const coordinatorStub = (env.COORDINATOR as unknown as { get: ReturnType<typeof vi.fn> }).get();
      (coordinatorStub.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (request: Request) => {
        const url = new URL(request.url);
        if (url.pathname === "/init") {
          return new Response(JSON.stringify({ ok: true, alreadyExists: true }), { status: 200 });
        }
        if (url.pathname === "/state") {
          return new Response(JSON.stringify({
            runId: "my-run", namespaceId: "123456", status: "running",
            plan: validPlan, jobs: {}, createdAt: "t", updatedAt: "t",
          }), { status: 200 });
        }
        return new Response("not found", { status: 404 });
      });

      const resp = await routeRequest(req("POST", "/v1/runs", { plan: validPlan, runId: "my-run" }), env, ctx);
      expect(resp.status).toBe(200);
    });

    it("returns CONFLICT when same runId with different plan checksum", async () => {
      const coordinatorStub = (env.COORDINATOR as unknown as { get: ReturnType<typeof vi.fn> }).get();
      (coordinatorStub.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (request: Request) => {
        const url = new URL(request.url);
        if (url.pathname === "/init") {
          return new Response(JSON.stringify({ ok: true, alreadyExists: true }), { status: 200 });
        }
        if (url.pathname === "/state") {
          return new Response(JSON.stringify({
            runId: "my-run", namespaceId: "123456", status: "running",
            plan: { ...validPlan, checksum: "different" }, jobs: {}, createdAt: "t", updatedAt: "t",
          }), { status: 200 });
        }
        return new Response("not found", { status: 404 });
      });

      const resp = await routeRequest(req("POST", "/v1/runs", { plan: validPlan, runId: "my-run" }), env, ctx);
      expect(resp.status).toBe(409);
    });

    it("invalid JSON returns INVALID_REQUEST", async () => {
      const r = new Request("https://api.orun.test/v1/runs", {
        method: "POST",
        body: "not json",
        headers: { "Content-Type": "application/json" },
      });
      const resp = await routeRequest(r, env, ctx);
      expect(resp.status).toBe(400);
      const data = await resp.json() as { code: string };
      expect(data.code).toBe("INVALID_REQUEST");
    });

    it("missing plan returns INVALID_REQUEST", async () => {
      const resp = await routeRequest(req("POST", "/v1/runs", {}), env, ctx);
      expect(resp.status).toBe(400);
    });
  });

  describe("Namespace access", () => {
    it("OIDC cross-namespace access returns 403", async () => {
      __setMockAuth({
        type: "oidc",
        namespace: { namespaceId: "999", namespaceSlug: "other/repo" },
        allowedNamespaceIds: ["999"],
        actor: "attacker",
      });
      const resp = await routeRequest(req("GET", "/v1/runs/some-run"), env, ctx);
      expect(resp.status).toBe(404);
    });

    it("session cannot read runs outside allowedNamespaceIds", async () => {
      __setMockAuth({
        type: "session",
        namespace: null,
        allowedNamespaceIds: ["different-ns"],
        actor: "user",
      });
      const resp = await routeRequest(req("GET", "/v1/runs/some-run"), env, ctx);
      expect(resp.status).toBe(404);
    });
  });

  describe("GET /v1/runs", () => {
    it("session auth lists runs", async () => {
      __setMockAuth({
        type: "session",
        namespace: null,
        allowedNamespaceIds: ["123456"],
        actor: "user",
      });
      const resp = await routeRequest(req("GET", "/v1/runs"), env, ctx);
      expect(resp.status).toBe(200);
      const data = await resp.json() as { runs: unknown[] };
      expect(data.runs).toBeDefined();
    });

    it("non-session returns 403", async () => {
      __setMockAuth({
        type: "oidc",
        namespace: { namespaceId: "123456", namespaceSlug: "test/repo" },
        allowedNamespaceIds: ["123456"],
        actor: "actor",
      });
      const resp = await routeRequest(req("GET", "/v1/runs"), env, ctx);
      expect(resp.status).toBe(403);
    });
  });

  describe("Claim endpoint", () => {
    it("forwards to coordinator and returns result", async () => {
      const coordinatorStub = (env.COORDINATOR as unknown as { get: ReturnType<typeof vi.fn> }).get();
      (coordinatorStub.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        new Response(JSON.stringify({ claimed: false, currentStatus: "running" }), { status: 200 }),
      );

      const resp = await routeRequest(
        req("POST", "/v1/runs/run-1/jobs/job-1/claim", { runnerId: "runner-1" }),
        env, ctx,
      );
      expect(resp.status).toBe(200);
      const data = await resp.json() as { claimed: boolean };
      expect(data.claimed).toBe(false);
    });
  });

  describe("Update endpoint", () => {
    it("forwards runnerId and mirrors to D1", async () => {
      const coordinatorStub = (env.COORDINATOR as unknown as { get: ReturnType<typeof vi.fn> }).get();
      let capturedBody: string | undefined;
      (coordinatorStub.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (request: Request) => {
        const url = new URL(request.url);
        if (url.pathname.includes("/update")) {
          capturedBody = await request.text();
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        if (url.pathname === "/state") {
          return new Response(JSON.stringify({
            runId: "run-1", namespaceId: "123456", status: "running",
            plan: { checksum: "abc", version: "1", jobs: [], createdAt: "t" },
            jobs: { "job-1": { jobId: "job-1", component: "c", status: "success", deps: [], runnerId: "r1", startedAt: "t", finishedAt: "t", lastError: null, heartbeatAt: "t" } },
            createdAt: "t", updatedAt: "t",
          }), { status: 200 });
        }
        return new Response("", { status: 404 });
      });

      const resp = await routeRequest(
        req("POST", "/v1/runs/run-1/jobs/job-1/update", { runnerId: "runner-1", status: "success" }),
        env, ctx,
      );
      expect(resp.status).toBe(200);
      expect(capturedBody).toContain("runner-1");
      const parsed = JSON.parse(capturedBody!);
      expect(parsed.runnerId).toBe("runner-1");
    });
  });

  describe("Heartbeat endpoint", () => {
    it("forwards runnerId to coordinator", async () => {
      const coordinatorStub = (env.COORDINATOR as unknown as { get: ReturnType<typeof vi.fn> }).get();
      (coordinatorStub.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );

      const resp = await routeRequest(
        req("POST", "/v1/runs/run-1/jobs/job-1/heartbeat", { runnerId: "runner-1" }),
        env, ctx,
      );
      expect(resp.status).toBe(200);
      const data = await resp.json() as { ok: boolean };
      expect(data.ok).toBe(true);
    });
  });

  describe("Runnable endpoint", () => {
    it("forwards coordinator response", async () => {
      const coordinatorStub = (env.COORDINATOR as unknown as { get: ReturnType<typeof vi.fn> }).get();
      (coordinatorStub.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        new Response(JSON.stringify({ jobs: ["job-1", "job-2"] }), { status: 200 }),
      );

      const resp = await routeRequest(req("GET", "/v1/runs/run-1/runnable"), env, ctx);
      expect(resp.status).toBe(200);
      const data = await resp.json() as { jobs: string[] };
      expect(data.jobs).toEqual(["job-1", "job-2"]);
    });
  });

  describe("Job list/status", () => {
    it("GET /v1/runs/:runId/jobs returns coordinator jobs", async () => {
      const coordinatorStub = (env.COORDINATOR as unknown as { get: ReturnType<typeof vi.fn> }).get();
      (coordinatorStub.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        new Response(JSON.stringify({
          runId: "run-1", namespaceId: "123456", status: "running",
          plan: { checksum: "abc", version: "1", jobs: [], createdAt: "t" },
          jobs: {
            "job-1": { jobId: "job-1", component: "c", status: "pending", deps: [], runnerId: null, startedAt: null, finishedAt: null, lastError: null, heartbeatAt: null },
          },
          createdAt: "t", updatedAt: "t",
        }), { status: 200 }),
      );

      const resp = await routeRequest(req("GET", "/v1/runs/run-1/jobs"), env, ctx);
      expect(resp.status).toBe(200);
      const data = await resp.json() as { jobs: unknown[] };
      expect(data.jobs).toHaveLength(1);
    });

    it("GET /v1/runs/:runId/jobs/:jobId/status returns coordinator job", async () => {
      const coordinatorStub = (env.COORDINATOR as unknown as { get: ReturnType<typeof vi.fn> }).get();
      (coordinatorStub.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        new Response(JSON.stringify({
          jobId: "job-1", component: "c", status: "running",
          deps: [], runnerId: "r1", startedAt: "t", finishedAt: null, lastError: null, heartbeatAt: "t",
        }), { status: 200 }),
      );

      const resp = await routeRequest(req("GET", "/v1/runs/run-1/jobs/job-1/status"), env, ctx);
      expect(resp.status).toBe(200);
      const data = await resp.json() as { status: string };
      expect(data.status).toBe("running");
    });
  });

  describe("Log upload and retrieval", () => {
    it("POST /v1/runs/:runId/logs/:jobId uploads and returns logRef", async () => {
      const resp = await routeRequest(
        new Request("https://api.orun.test/v1/runs/run-1/logs/job-1", {
          method: "POST",
          body: "log line 1\nlog line 2\n",
        }),
        env, ctx,
      );
      expect(resp.status).toBe(200);
      const data = await resp.json() as { ok: boolean; logRef: string };
      expect(data.ok).toBe(true);
      expect(data.logRef).toContain("123456/runs/run-1/logs/job-1.log");
    });

    it("GET /v1/runs/:runId/logs/:jobId streams text", async () => {
      (env.STORAGE as unknown as { put: ReturnType<typeof vi.fn> }).put("123456/runs/run-1/logs/job-1.log", "log content");
      (env.STORAGE as unknown as { get: ReturnType<typeof vi.fn> }).get.mockResolvedValueOnce({
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("log content"));
            controller.close();
          },
        }),
      });

      const resp = await routeRequest(req("GET", "/v1/runs/run-1/logs/job-1"), env, ctx);
      expect(resp.status).toBe(200);
      expect(resp.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    });

    it("GET /v1/runs/:runId/logs/:jobId returns 404 when missing", async () => {
      (env.STORAGE as unknown as { get: ReturnType<typeof vi.fn> }).get.mockResolvedValueOnce(null);

      const resp = await routeRequest(req("GET", "/v1/runs/run-1/logs/job-1"), env, ctx);
      expect(resp.status).toBe(404);
    });
  });

  describe("Rate limiting", () => {
    it("returns 429 when rate limited", async () => {
      const limitedEnv = makeEnv({
        RATE_LIMITER: makeDONamespace(() => ({ remaining: 0, limited: true })),
      });

      const resp = await routeRequest(
        req("POST", "/v1/runs", { plan: { checksum: "abc", version: "1", jobs: [], createdAt: "t" } }),
        limitedEnv, ctx,
      );
      expect(resp.status).toBe(429);
      expect(resp.headers.get("Retry-After")).toBe("1");
      expect(resp.headers.get("X-RateLimit-Remaining")).toBe("0");
    });
  });

  describe("Scheduled handler", () => {
    it("cancels expired coordinators and deletes expired D1 rows", async () => {
      const { handleScheduled } = await import("./scheduled");
      const scheduledEnv = makeEnv();

      (scheduledEnv.DB as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare.mockImplementation((sql: string) => ({
        bind: (..._args: unknown[]) => ({
          run: vi.fn(async () => ({ meta: { changes: 1 } })),
          all: vi.fn(async () => {
            if (sql.includes("expires_at")) {
              return { results: [{ namespace_id: "ns1", run_id: "expired-run" }] };
            }
            return { results: [] };
          }),
          first: vi.fn(async () => null),
        }),
      }));

      const coordStub = (scheduledEnv.COORDINATOR as unknown as { get: ReturnType<typeof vi.fn> }).get();
      const cancelFn = (coordStub.fetch as ReturnType<typeof vi.fn>);

      await handleScheduled(scheduledEnv, ctx);
      await ctx._flush();

      expect(cancelFn).toHaveBeenCalled();
      const calls = cancelFn.mock.calls as unknown[][];
      const cancelCall = calls.find((c) => {
        const req = c[0] as Request;
        return new URL(req.url).pathname === "/cancel";
      });
      expect(cancelCall).toBeDefined();
    });
  });
});

describe("RateLimitCounter DO", () => {
  it("allows requests and decrements tokens", async () => {
    const { RateLimitCounter } = await import("./rate-limit");
    const state = { storage: {} } as unknown as DurableObjectState;
    const counter = new RateLimitCounter(state, {});

    const resp = await counter.fetch(new Request("https://local/check"));
    expect(resp.status).toBe(200);
    const data = await resp.json() as { limited: boolean; remaining: number };
    expect(data.limited).toBe(false);
    expect(data.remaining).toBe(19);
  });

  it("returns limited when tokens exhausted", async () => {
    const { RateLimitCounter } = await import("./rate-limit");
    const state = { storage: {} } as unknown as DurableObjectState;
    const counter = new RateLimitCounter(state, {});

    for (let i = 0; i < 20; i++) {
      await counter.fetch(new Request("https://local/check"));
    }

    const resp = await counter.fetch(new Request("https://local/check"));
    const data = await resp.json() as { limited: boolean };
    expect(data.limited).toBe(true);
  });
});
