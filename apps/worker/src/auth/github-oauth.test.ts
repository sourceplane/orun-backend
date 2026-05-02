import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildGitHubOAuthRedirect, handleGitHubOAuthCallback } from "./github-oauth";
import type { Env } from "@orun/types";

const SESSION_SECRET = "oauth-test-secret-32-bytes-long!";
const CLIENT_ID = "test-client-id";
const CLIENT_SECRET = "test-client-secret";

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    COORDINATOR: {} as any,
    RATE_LIMITER: {} as any,
    STORAGE: {} as any,
    DB: {} as any,
    GITHUB_JWKS_URL: "https://example.com/.well-known/jwks",
    GITHUB_OIDC_AUDIENCE: "orun",
    ORUN_SESSION_SECRET: SESSION_SECRET,
    GITHUB_CLIENT_ID: CLIENT_ID,
    GITHUB_CLIENT_SECRET: CLIENT_SECRET,
    ...overrides,
  };
}

function makeRequest(url: string): Request {
  return new Request(url);
}

let fetchSpy: any;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buildGitHubOAuthRedirect", () => {
  it("redirects to GitHub authorize URL with correct params", async () => {
    const req = makeRequest("https://api.orun.dev/v1/auth/github");
    const resp = await buildGitHubOAuthRedirect(req, makeEnv());

    expect(resp.status).toBe(302);
    const location = resp.headers.get("Location")!;
    expect(location).toContain("https://github.com/login/oauth/authorize");

    const url = new URL(location);
    expect(url.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(url.searchParams.get("scope")).toBe("read:user,read:org");
    expect(url.searchParams.get("redirect_uri")).toBe("https://api.orun.dev/v1/auth/github/callback");

    const state = url.searchParams.get("state")!;
    expect(state.split(".").length).toBeGreaterThanOrEqual(2);
  });

  it("uses ORUN_PUBLIC_URL when set", async () => {
    const env = makeEnv({ ORUN_PUBLIC_URL: "https://custom.example.com" } as any);
    const req = makeRequest("https://api.orun.dev/v1/auth/github");
    const resp = await buildGitHubOAuthRedirect(req, env);
    const location = resp.headers.get("Location")!;
    const url = new URL(location);
    expect(url.searchParams.get("redirect_uri")).toBe("https://custom.example.com/v1/auth/github/callback");
  });

  it("accepts valid returnTo with configured ORUN_DASHBOARD_URL", async () => {
    const env = makeEnv({ ORUN_DASHBOARD_URL: "https://dashboard.example.com" } as any);
    const req = makeRequest("https://api.orun.dev/v1/auth/github?returnTo=https://dashboard.example.com/callback");
    const resp = await buildGitHubOAuthRedirect(req, env);
    expect(resp.status).toBe(302);
    const location = resp.headers.get("Location")!;
    expect(location).toContain("github.com/login/oauth/authorize");
  });

  it("rejects returnTo with mismatched origin", async () => {
    const env = makeEnv({ ORUN_DASHBOARD_URL: "https://dashboard.example.com" } as any);
    const req = makeRequest("https://api.orun.dev/v1/auth/github?returnTo=https://evil.com/callback");
    await expect(buildGitHubOAuthRedirect(req, env)).rejects.toThrow("returnTo origin not allowed");
  });

  it("rejects malformed returnTo URL", async () => {
    const env = makeEnv({ ORUN_DASHBOARD_URL: "https://dashboard.example.com" } as any);
    const req = makeRequest("https://api.orun.dev/v1/auth/github?returnTo=not-a-url");
    await expect(buildGitHubOAuthRedirect(req, env)).rejects.toThrow("Invalid returnTo URL");
  });

  it("allows same-origin returnTo when ORUN_DASHBOARD_URL not set", async () => {
    const req = makeRequest("https://api.orun.dev/v1/auth/github?returnTo=https://api.orun.dev/dashboard");
    const resp = await buildGitHubOAuthRedirect(req, makeEnv());
    expect(resp.status).toBe(302);
  });

  it("rejects cross-origin returnTo when ORUN_DASHBOARD_URL not set", async () => {
    const req = makeRequest("https://api.orun.dev/v1/auth/github?returnTo=https://evil.com/steal");
    await expect(buildGitHubOAuthRedirect(req, makeEnv())).rejects.toThrow("returnTo origin not allowed");
  });
});

describe("handleGitHubOAuthCallback", () => {
  async function getValidState(returnTo?: string): Promise<string> {
    const url = returnTo
      ? `https://api.orun.dev/v1/auth/github?returnTo=${encodeURIComponent(returnTo)}`
      : "https://api.orun.dev/v1/auth/github";
    const env = returnTo
      ? makeEnv({ ORUN_DASHBOARD_URL: new URL(returnTo).origin } as any)
      : makeEnv();
    const req = makeRequest(url);
    const resp = await buildGitHubOAuthRedirect(req, env);
    const location = resp.headers.get("Location")!;
    return new URL(location).searchParams.get("state")!;
  }

  function mockGitHubApis(
    user: { login: string; id: number } = { login: "testuser", id: 42 },
    repos: Array<{ id: number; full_name: string; permissions?: { admin?: boolean } }> = [
      { id: 100, full_name: "org/repo1", permissions: { admin: true } },
      { id: 200, full_name: "org/repo2", permissions: { admin: false } },
      { id: 300, full_name: "org/repo3", permissions: { admin: true } },
    ],
    orgMemberships: Array<{ organization: { login: string }; role: string }> = [],
    orgRepos: Record<string, Array<{ id: number; full_name: string }>> = {},
  ) {
    fetchSpy.mockImplementation((async (input: any) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url === "https://github.com/login/oauth/access_token") {
        return new Response(JSON.stringify({ access_token: "gho_testaccesstoken" }), { status: 200 });
      }
      if (url === "https://api.github.com/user") {
        return new Response(JSON.stringify(user), { status: 200 });
      }
      if (url.startsWith("https://api.github.com/user/repos")) {
        return new Response(JSON.stringify(repos), { status: 200 });
      }
      if (url.startsWith("https://api.github.com/user/memberships/orgs")) {
        return new Response(JSON.stringify(orgMemberships), { status: 200 });
      }
      for (const [orgLogin, orgRepoList] of Object.entries(orgRepos)) {
        if (url.startsWith(`https://api.github.com/orgs/${orgLogin}/repos`)) {
          return new Response(JSON.stringify(orgRepoList), { status: 200 });
        }
      }
      return new Response("Not Found", { status: 404 });
    }) as any);
  }

  it("exchanges code and returns session token with admin repo IDs", async () => {
    const state = await getValidState();
    vi.restoreAllMocks();
    fetchSpy = vi.spyOn(globalThis, "fetch");
    mockGitHubApis();

    const req = makeRequest(`https://api.orun.dev/v1/auth/github/callback?code=testcode&state=${state}`);
    const result = await handleGitHubOAuthCallback(req, makeEnv());

    expect(result.githubLogin).toBe("testuser");
    expect(result.allowedNamespaceIds).toContain("100");
    expect(result.allowedNamespaceIds).toContain("300");
    expect(result.allowedNamespaceIds).not.toContain("200");
    expect(typeof result.sessionToken).toBe("string");
    expect(result.returnTo).toBeUndefined();
  });

  it("returns returnTo when present in state", async () => {
    const returnTo = "https://dashboard.example.com/callback";
    const state = await getValidState(returnTo);
    vi.restoreAllMocks();
    fetchSpy = vi.spyOn(globalThis, "fetch");
    mockGitHubApis();

    const req = makeRequest(`https://api.orun.dev/v1/auth/github/callback?code=testcode&state=${state}`);
    const result = await handleGitHubOAuthCallback(req, makeEnv({ ORUN_DASHBOARD_URL: "https://dashboard.example.com" } as any));

    expect(result.returnTo).toBe(returnTo);
    expect(result.githubLogin).toBe("testuser");
    expect(typeof result.sessionToken).toBe("string");
  });

  it("does not include GitHub access token in result", async () => {
    const returnTo = "https://dashboard.example.com/callback";
    const state = await getValidState(returnTo);
    vi.restoreAllMocks();
    fetchSpy = vi.spyOn(globalThis, "fetch");
    mockGitHubApis();

    const req = makeRequest(`https://api.orun.dev/v1/auth/github/callback?code=testcode&state=${state}`);
    const result = await handleGitHubOAuthCallback(req, makeEnv({ ORUN_DASHBOARD_URL: "https://dashboard.example.com" } as any));

    const resultStr = JSON.stringify(result);
    expect(resultStr).not.toContain("gho_testaccesstoken");
    expect(resultStr).not.toContain("access_token");
  });

  it("rejects missing code", async () => {
    const state = await getValidState();
    vi.restoreAllMocks();
    const req = makeRequest(`https://api.orun.dev/v1/auth/github/callback?state=${state}`);
    await expect(handleGitHubOAuthCallback(req, makeEnv())).rejects.toThrow("Missing OAuth code");
  });

  it("rejects missing state", async () => {
    const req = makeRequest("https://api.orun.dev/v1/auth/github/callback?code=testcode");
    await expect(handleGitHubOAuthCallback(req, makeEnv())).rejects.toThrow("Missing OAuth state");
  });

  it("rejects invalid state signature", async () => {
    const req = makeRequest("https://api.orun.dev/v1/auth/github/callback?code=testcode&state=bad.sig");
    await expect(handleGitHubOAuthCallback(req, makeEnv())).rejects.toThrow("Invalid OAuth state");
  });

  it("rejects tampered state (modified returnTo)", async () => {
    const { base64urlEncodeString } = await import("./base64url");
    const { signHmac } = await import("./jwt");
    const { base64urlEncode } = await import("./base64url");

    const nonce = base64urlEncode(crypto.getRandomValues(new Uint8Array(16)));
    const exp = Math.floor(Date.now() / 1000) + 600;
    const originalPayload = JSON.stringify({ nonce, exp, returnTo: "https://dashboard.example.com/callback" });
    const originalData = base64urlEncodeString(originalPayload);
    const sig = await signHmac(originalData, SESSION_SECRET);

    const tamperedPayload = JSON.stringify({ nonce, exp, returnTo: "https://evil.com/steal" });
    const tamperedData = base64urlEncodeString(tamperedPayload);
    const tamperedState = `${tamperedData}.${base64urlEncode(sig)}`;

    vi.restoreAllMocks();
    const req = makeRequest(`https://api.orun.dev/v1/auth/github/callback?code=testcode&state=${tamperedState}`);
    await expect(handleGitHubOAuthCallback(req, makeEnv())).rejects.toThrow("Invalid OAuth state signature");
  });

  it("rejects expired state", async () => {
    const { signHmac } = await import("./jwt");
    const { base64urlEncode, base64urlEncodeString } = await import("./base64url");
    const nonce = base64urlEncode(crypto.getRandomValues(new Uint8Array(16)));
    const expiredExp = Math.floor(Date.now() / 1000) - 10;
    const payload = JSON.stringify({ nonce, exp: expiredExp });
    const data = base64urlEncodeString(payload);
    const sig = await signHmac(data, SESSION_SECRET);
    const state = `${data}.${base64urlEncode(sig)}`;

    vi.restoreAllMocks();
    const req = makeRequest(`https://api.orun.dev/v1/auth/github/callback?code=testcode&state=${state}`);
    await expect(handleGitHubOAuthCallback(req, makeEnv())).rejects.toThrow("OAuth state expired");
  });

  it("includes org admin repos and deduplicates", async () => {
    const state = await getValidState();
    vi.restoreAllMocks();
    fetchSpy = vi.spyOn(globalThis, "fetch");

    mockGitHubApis(
      { login: "admin", id: 1 },
      [{ id: 100, full_name: "org/repo1", permissions: { admin: true } }],
      [{ organization: { login: "myorg" }, role: "admin" }],
      { myorg: [{ id: 100, full_name: "org/repo1" }, { id: 400, full_name: "myorg/newrepo" }] },
    );

    const req = makeRequest(`https://api.orun.dev/v1/auth/github/callback?code=testcode&state=${state}`);
    const result = await handleGitHubOAuthCallback(req, makeEnv());

    expect(result.allowedNamespaceIds).toContain("100");
    expect(result.allowedNamespaceIds).toContain("400");
    const unique = new Set(result.allowedNamespaceIds);
    expect(unique.size).toBe(result.allowedNamespaceIds.length);
  });

  it("handles token exchange failure", async () => {
    const state = await getValidState();
    vi.restoreAllMocks();
    fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockResolvedValue(new Response("error", { status: 401 }) as any);

    const req = makeRequest(`https://api.orun.dev/v1/auth/github/callback?code=badcode&state=${state}`);
    await expect(handleGitHubOAuthCallback(req, makeEnv())).rejects.toThrow("Failed to exchange OAuth code");
  });

  it("handles GitHub user fetch failure", async () => {
    const state = await getValidState();
    vi.restoreAllMocks();
    fetchSpy = vi.spyOn(globalThis, "fetch");

    let callCount = 0;
    fetchSpy.mockImplementation((async () => {
      callCount++;
      if (callCount === 1) {
        return new Response(JSON.stringify({ access_token: "tok" }), { status: 200 });
      }
      return new Response("error", { status: 500 });
    }) as any);

    const req = makeRequest(`https://api.orun.dev/v1/auth/github/callback?code=testcode&state=${state}`);
    await expect(handleGitHubOAuthCallback(req, makeEnv())).rejects.toThrow("Failed to fetch GitHub user");
  });

  it("handles pagination via Link header", async () => {
    const state = await getValidState();
    vi.restoreAllMocks();
    fetchSpy = vi.spyOn(globalThis, "fetch");

    fetchSpy.mockImplementation((async (input: any) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url === "https://github.com/login/oauth/access_token") {
        return new Response(JSON.stringify({ access_token: "tok" }), { status: 200 });
      }
      if (url === "https://api.github.com/user") {
        return new Response(JSON.stringify({ login: "paginated", id: 1 }), { status: 200 });
      }
      if (url === "https://api.github.com/user/repos?type=all&per_page=100") {
        return new Response(
          JSON.stringify([{ id: 1, full_name: "a/b", permissions: { admin: true } }]),
          {
            status: 200,
            headers: { Link: '<https://api.github.com/user/repos?type=all&per_page=100&page=2>; rel="next"' },
          },
        );
      }
      if (url === "https://api.github.com/user/repos?type=all&per_page=100&page=2") {
        return new Response(
          JSON.stringify([{ id: 2, full_name: "c/d", permissions: { admin: true } }]),
          { status: 200 },
        );
      }
      if (url.startsWith("https://api.github.com/user/memberships/orgs")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response("Not Found", { status: 404 });
    }) as any);

    const req = makeRequest(`https://api.orun.dev/v1/auth/github/callback?code=testcode&state=${state}`);
    const result = await handleGitHubOAuthCallback(req, makeEnv());
    expect(result.allowedNamespaceIds).toContain("1");
    expect(result.allowedNamespaceIds).toContain("2");
  });
});
