import { describe, it, expect, vi } from "vitest";
import { OrunClient, OrunClientError } from "./index";

function mockFetch(responses: Array<{ status: number; body: unknown; contentType?: string }>) {
  let callIndex = 0;
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
    calls.push({ url: urlStr, init: init ?? {} });
    const resp = responses[callIndex] ?? responses[responses.length - 1];
    callIndex++;
    const ct = resp.contentType ?? "application/json";
    const body = ct === "application/json" ? JSON.stringify(resp.body) : String(resp.body);
    return new Response(body, {
      status: resp.status,
      headers: { "Content-Type": ct },
    });
  });
  return { fn, calls: () => calls };
}

describe("OrunClient", () => {
  describe("constructor", () => {
    it("normalizes trailing slash on baseUrl", () => {
      const client = new OrunClient({ baseUrl: "https://api.example.com/" });
      const url = client.getGitHubAuthUrl();
      expect(url).toBe("https://api.example.com/v1/auth/github");
    });

    it("works without trailing slash", () => {
      const client = new OrunClient({ baseUrl: "https://api.example.com" });
      const url = client.getGitHubAuthUrl();
      expect(url).toBe("https://api.example.com/v1/auth/github");
    });
  });

  describe("getGitHubAuthUrl", () => {
    it("returns auth URL without returnTo", () => {
      const client = new OrunClient({ baseUrl: "https://api.example.com" });
      expect(client.getGitHubAuthUrl()).toBe("https://api.example.com/v1/auth/github");
    });

    it("returns auth URL with returnTo", () => {
      const client = new OrunClient({ baseUrl: "https://api.example.com" });
      const url = client.getGitHubAuthUrl("https://dashboard.example.com/callback");
      expect(url).toBe("https://api.example.com/v1/auth/github?returnTo=https%3A%2F%2Fdashboard.example.com%2Fcallback");
    });
  });

  describe("authorization header", () => {
    it("sets Bearer token from string", async () => {
      const { fn, calls } = mockFetch([{ status: 200, body: { runs: [] } }]);
      const client = new OrunClient({ baseUrl: "https://api.example.com", token: "my-token", fetch: fn });
      await client.listRuns();
      expect(calls()[0].init.headers).toHaveProperty("Authorization", "Bearer my-token");
    });

    it("sets Bearer token from sync provider", async () => {
      const { fn, calls } = mockFetch([{ status: 200, body: { runs: [] } }]);
      const client = new OrunClient({ baseUrl: "https://api.example.com", token: () => "dynamic-token", fetch: fn });
      await client.listRuns();
      expect(calls()[0].init.headers).toHaveProperty("Authorization", "Bearer dynamic-token");
    });

    it("sets Bearer token from async provider", async () => {
      const { fn, calls } = mockFetch([{ status: 200, body: { runs: [] } }]);
      const client = new OrunClient({ baseUrl: "https://api.example.com", token: async () => "async-token", fetch: fn });
      await client.listRuns();
      expect(calls()[0].init.headers).toHaveProperty("Authorization", "Bearer async-token");
    });

    it("omits Authorization when token is null", async () => {
      const { fn, calls } = mockFetch([{ status: 200, body: { runs: [] } }]);
      const client = new OrunClient({ baseUrl: "https://api.example.com", token: () => null, fetch: fn });
      await client.listRuns();
      expect(calls()[0].init.headers).not.toHaveProperty("Authorization");
    });

    it("omits Authorization when no token provided", async () => {
      const { fn, calls } = mockFetch([{ status: 200, body: { runs: [] } }]);
      const client = new OrunClient({ baseUrl: "https://api.example.com", fetch: fn });
      await client.listRuns();
      expect(calls()[0].init.headers).not.toHaveProperty("Authorization");
    });
  });

  describe("JSON error handling", () => {
    it("throws OrunClientError with parsed code and message", async () => {
      const { fn } = mockFetch([{ status: 404, body: { error: "Not found", code: "NOT_FOUND" } }]);
      const client = new OrunClient({ baseUrl: "https://api.example.com", token: "t", fetch: fn });
      try {
        await client.getAccount();
        expect.fail("should throw");
      } catch (err) {
        expect(err).toBeInstanceOf(OrunClientError);
        const e = err as OrunClientError;
        expect(e.status).toBe(404);
        expect(e.code).toBe("NOT_FOUND");
        expect(e.message).toBe("Not found");
      }
    });

    it("handles non-JSON error bodies", async () => {
      const { fn } = mockFetch([{ status: 500, body: "Internal Server Error", contentType: "text/plain" }]);
      const client = new OrunClient({ baseUrl: "https://api.example.com", token: "t", fetch: fn });
      try {
        await client.getAccount();
        expect.fail("should throw");
      } catch (err) {
        expect(err).toBeInstanceOf(OrunClientError);
        const e = err as OrunClientError;
        expect(e.status).toBe(500);
        expect(e.code).toBe("UNKNOWN");
      }
    });
  });

  describe("API methods", () => {
    it("createAccount posts to /v1/accounts", async () => {
      const { fn, calls } = mockFetch([{ status: 200, body: { accountId: "abc", githubLogin: "user", createdAt: "2024-01-01" } }]);
      const client = new OrunClient({ baseUrl: "https://api.example.com", token: "t", fetch: fn });
      const result = await client.createAccount();
      expect(calls()[0].url).toBe("https://api.example.com/v1/accounts");
      expect(calls()[0].init.method).toBe("POST");
      expect(result.accountId).toBe("abc");
    });

    it("getAccount gets /v1/accounts/me", async () => {
      const { fn, calls } = mockFetch([{ status: 200, body: { accountId: "abc", githubLogin: "user", createdAt: "2024-01-01" } }]);
      const client = new OrunClient({ baseUrl: "https://api.example.com", token: "t", fetch: fn });
      await client.getAccount();
      expect(calls()[0].url).toBe("https://api.example.com/v1/accounts/me");
      expect(calls()[0].init.method).toBe("GET");
    });

    it("listLinkedRepos gets /v1/accounts/repos", async () => {
      const { fn, calls } = mockFetch([{ status: 200, body: { repos: [] } }]);
      const client = new OrunClient({ baseUrl: "https://api.example.com", token: "t", fetch: fn });
      await client.listLinkedRepos();
      expect(calls()[0].url).toBe("https://api.example.com/v1/accounts/repos");
    });

    it("unlinkRepo deletes /v1/accounts/repos/:id", async () => {
      const { fn, calls } = mockFetch([{ status: 200, body: { ok: true } }]);
      const client = new OrunClient({ baseUrl: "https://api.example.com", token: "t", fetch: fn });
      await client.unlinkRepo("ns-123");
      expect(calls()[0].url).toBe("https://api.example.com/v1/accounts/repos/ns-123");
      expect(calls()[0].init.method).toBe("DELETE");
    });

    it("listRuns with query params", async () => {
      const { fn, calls } = mockFetch([{ status: 200, body: { runs: [] } }]);
      const client = new OrunClient({ baseUrl: "https://api.example.com", token: "t", fetch: fn });
      await client.listRuns({ limit: 10, offset: 5 });
      expect(calls()[0].url).toBe("https://api.example.com/v1/runs?limit=10&offset=5");
    });

    it("listRuns without params", async () => {
      const { fn, calls } = mockFetch([{ status: 200, body: { runs: [] } }]);
      const client = new OrunClient({ baseUrl: "https://api.example.com", token: "t", fetch: fn });
      await client.listRuns();
      expect(calls()[0].url).toBe("https://api.example.com/v1/runs");
    });

    it("getRun encodes runId", async () => {
      const { fn, calls } = mockFetch([{ status: 200, body: { run: { runId: "r/1" } } }]);
      const client = new OrunClient({ baseUrl: "https://api.example.com", token: "t", fetch: fn });
      await client.getRun("r/1");
      expect(calls()[0].url).toBe("https://api.example.com/v1/runs/r%2F1");
    });

    it("listJobs gets jobs for a run", async () => {
      const { fn, calls } = mockFetch([{ status: 200, body: { jobs: [] } }]);
      const client = new OrunClient({ baseUrl: "https://api.example.com", token: "t", fetch: fn });
      await client.listJobs("run-1");
      expect(calls()[0].url).toBe("https://api.example.com/v1/runs/run-1/jobs");
    });

    it("getJobStatus gets status for a specific job", async () => {
      const { fn, calls } = mockFetch([{ status: 200, body: { jobId: "j1", status: "running" } }]);
      const client = new OrunClient({ baseUrl: "https://api.example.com", token: "t", fetch: fn });
      await client.getJobStatus("run-1", "j1");
      expect(calls()[0].url).toBe("https://api.example.com/v1/runs/run-1/jobs/j1/status");
    });

    it("getLog returns text content", async () => {
      const { fn, calls } = mockFetch([{ status: 200, body: "line1\nline2\n", contentType: "text/plain" }]);
      const client = new OrunClient({ baseUrl: "https://api.example.com", token: "t", fetch: fn });
      const log = await client.getLog("run-1", "job-1");
      expect(log).toBe("line1\nline2\n");
      expect(calls()[0].url).toBe("https://api.example.com/v1/runs/run-1/logs/job-1");
    });
  });
});
