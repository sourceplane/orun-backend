import { describe, it, expect, vi } from "vitest";
import { handleClaimJob, handleHeartbeat, handleRunnable } from "./jobs";
import { OrunError } from "../auth/errors";
import type { Env } from "@orun/types";
import type { RequestContext } from "../auth";

function makeEnv(dbOverride?: any): Env {
  return {
    COORDINATOR: makeDONamespace(),
    RATE_LIMITER: {} as any,
    STORAGE: {} as any,
    DB: dbOverride ?? makeEmptyD1(),
    GITHUB_JWKS_URL: "https://example.com/.well-known/jwks",
    GITHUB_OIDC_AUDIENCE: "orun",
    ORUN_SESSION_SECRET: "secret",
    GITHUB_CLIENT_ID: "test-id",
    GITHUB_CLIENT_SECRET: "test-secret",
  };
}

function makeDONamespace(): any {
  const stubFetch = vi.fn(async () =>
    new Response(JSON.stringify({ claimed: true }), { status: 200 }),
  );
  const stub = { fetch: stubFetch } as any;
  return {
    idFromName: vi.fn(() => ({ toString: () => "test-id" })),
    get: vi.fn(() => stub),
  };
}

function makeEmptyD1(): any {
  return {
    prepare: (_sql: string) => ({
      bind: (..._args: unknown[]) => ({
        run: vi.fn(async () => ({ meta: { changes: 0 } })),
        all: vi.fn(async () => ({ results: [] })),
        first: vi.fn(async () => null),
      }),
    }),
  };
}

function makeOidcAuth(namespaceId = "ns-1"): RequestContext {
  return {
    type: "oidc",
    namespace: { namespaceId, namespaceSlug: "org/repo" },
    allowedNamespaceIds: [namespaceId],
    actor: "runner-123",
  };
}

function makeDashboardAuth(): RequestContext {
  return {
    type: "session",
    sessionKind: "dashboard",
    namespace: null,
    allowedNamespaceIds: ["ns-1"],
    actor: "dashuser",
  };
}

function makeCliAuth(): RequestContext {
  return {
    type: "session",
    sessionKind: "cli",
    namespace: null,
    allowedNamespaceIds: ["ns-1"],
    actor: "cliuser",
  };
}

function makeCtx() {
  return { waitUntil: vi.fn() } as any;
}

async function expectForbidden(fn: () => Promise<Response>): Promise<void> {
  try {
    const resp = await fn();
    expect(resp.status).toBe(403);
  } catch (err) {
    expect(err).toBeInstanceOf(OrunError);
    expect((err as OrunError).code).toBe("FORBIDDEN");
  }
}

describe("mutable route authorization", () => {
  describe("handleClaimJob", () => {
    it("allows OIDC auth and calls coordinator", async () => {
      const rc = {
        request: new Request("https://api.orun.dev", {
          method: "POST",
          body: JSON.stringify({ runnerId: "runner-1" }),
          headers: { "Content-Type": "application/json" },
        }),
        env: makeEnv(),
        ctx: makeCtx(),
        params: { runId: "run-1", jobId: "job-1" },
        authCtx: makeOidcAuth(),
      };

      const resp = await handleClaimJob(rc);
      expect(resp.status).toBe(200);
    });

    it("rejects dashboard session with FORBIDDEN", async () => {
      const rc = {
        request: new Request("https://api.orun.dev", {
          method: "POST",
          body: JSON.stringify({ runnerId: "runner-1" }),
          headers: { "Content-Type": "application/json" },
        }),
        env: makeEnv(),
        ctx: makeCtx(),
        params: { runId: "run-1", jobId: "job-1" },
        authCtx: makeDashboardAuth(),
      };

      await expectForbidden(() => handleClaimJob(rc));
    });

    it("allows CLI session when run found in D1", async () => {
      const runRow = {
        run_id: "run-1", namespace_id: "ns-1", status: "running",
        plan_checksum: "abc", trigger_type: "ci", actor: null,
        dry_run: 0, created_at: "2025-01-01T00:00:00.000Z",
        updated_at: "2025-01-01T00:00:00.000Z", finished_at: null,
        job_total: 1, job_done: 0, job_failed: 0,
        expires_at: "2099-01-01T00:00:00.000Z", namespace_slug: "org/repo",
      };

      const d1 = {
        prepare: (sql: string) => ({
          bind: (..._args: unknown[]) => ({
            run: vi.fn(async () => ({ meta: { changes: 0 } })),
            all: vi.fn(async () => {
              if (sql.includes("account_repos")) return { results: [{ namespace_id: "ns-1" }] };
              return { results: [] };
            }),
            first: vi.fn(async () => runRow),
          }),
        }),
      };

      const rc = {
        request: new Request("https://api.orun.dev", {
          method: "POST",
          body: JSON.stringify({ runnerId: "runner-1" }),
          headers: { "Content-Type": "application/json" },
        }),
        env: makeEnv(d1),
        ctx: makeCtx(),
        params: { runId: "run-1", jobId: "job-1" },
        authCtx: makeCliAuth(),
      };

      const resp = await handleClaimJob(rc);
      expect(resp.status).toBe(200);
    });

    it("CLI session returns NOT_FOUND when run not in any namespace", async () => {
      const d1 = {
        prepare: (sql: string) => ({
          bind: (..._args: unknown[]) => ({
            run: vi.fn(async () => ({ meta: { changes: 0 } })),
            all: vi.fn(async () => {
              if (sql.includes("account_repos")) return { results: [{ namespace_id: "ns-1" }] };
              return { results: [] };
            }),
            first: vi.fn(async () => null),
          }),
        }),
      };

      const rc = {
        request: new Request("https://api.orun.dev", {
          method: "POST",
          body: JSON.stringify({ runnerId: "runner-1" }),
          headers: { "Content-Type": "application/json" },
        }),
        env: makeEnv(d1),
        ctx: makeCtx(),
        params: { runId: "run-99", jobId: "job-1" },
        authCtx: makeCliAuth(),
      };

      try {
        await handleClaimJob(rc);
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(OrunError);
        expect((err as OrunError).code).toBe("NOT_FOUND");
      }
    });
  });

  describe("handleHeartbeat", () => {
    it("rejects dashboard session with FORBIDDEN", async () => {
      const rc = {
        request: new Request("https://api.orun.dev", {
          method: "POST",
          body: JSON.stringify({ runnerId: "runner-1" }),
          headers: { "Content-Type": "application/json" },
        }),
        env: makeEnv(),
        ctx: makeCtx(),
        params: { runId: "run-1", jobId: "job-1" },
        authCtx: makeDashboardAuth(),
      };

      await expectForbidden(() => handleHeartbeat(rc));
    });

    it("allows OIDC auth", async () => {
      const d1 = makeEmptyD1();
      const env = makeEnv(d1);
      const coordinator = (env.COORDINATOR as any);
      coordinator.get = vi.fn(() => ({
        fetch: vi.fn(async () =>
          new Response(JSON.stringify({ ok: true }), { status: 200 }),
        ),
      }));

      const rc = {
        request: new Request("https://api.orun.dev", {
          method: "POST",
          body: JSON.stringify({ runnerId: "runner-1" }),
          headers: { "Content-Type": "application/json" },
        }),
        env,
        ctx: makeCtx(),
        params: { runId: "run-1", jobId: "job-1" },
        authCtx: makeOidcAuth(),
      };

      const resp = await handleHeartbeat(rc);
      expect(resp.status).toBe(200);
    });
  });

  describe("handleRunnable", () => {
    it("rejects dashboard session with FORBIDDEN", async () => {
      const rc = {
        request: new Request("https://api.orun.dev"),
        env: makeEnv(),
        ctx: makeCtx(),
        params: { runId: "run-1" },
        authCtx: makeDashboardAuth(),
      };

      await expectForbidden(() => handleRunnable(rc));
    });

    it("allows OIDC auth", async () => {
      const d1 = makeEmptyD1();
      const env = makeEnv(d1);
      const coordinator = (env.COORDINATOR as any);
      coordinator.get = vi.fn(() => ({
        fetch: vi.fn(async () =>
          new Response(JSON.stringify({ jobs: ["job-1"] }), { status: 200 }),
        ),
      }));

      const rc = {
        request: new Request("https://api.orun.dev"),
        env,
        ctx: makeCtx(),
        params: { runId: "run-1" },
        authCtx: makeOidcAuth(),
      };

      const resp = await handleRunnable(rc);
      expect(resp.status).toBe(200);
    });
  });
});
