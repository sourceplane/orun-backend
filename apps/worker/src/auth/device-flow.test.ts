import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { startDeviceFlow, pollDeviceFlow } from "./device-flow";
import type { Env } from "@orun/types";

const SESSION_SECRET = "device-test-secret-32-bytes-long!";
const CLIENT_ID = "test-device-client-id";

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
    GITHUB_CLIENT_SECRET: "test-secret",
    ...overrides,
  };
}

let fetchSpy: any;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("startDeviceFlow", () => {
  it("returns device flow start response on success", async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          device_code: "DC123",
          user_code: "ABCD-EFGH",
          verification_uri: "https://github.com/login/device",
          verification_uri_complete: "https://github.com/login/device?user_code=ABCD-EFGH",
          expires_in: 900,
          interval: 5,
        }),
        { status: 200 },
      ),
    );

    const result = await startDeviceFlow(makeEnv());
    expect(result.deviceCode).toBe("DC123");
    expect(result.userCode).toBe("ABCD-EFGH");
    expect(result.verificationUri).toBe("https://github.com/login/device");
    expect(result.interval).toBe(5);
    expect(result.expiresIn).toBe(900);
  });

  it("throws INTERNAL_ERROR when GitHub returns non-ok", async () => {
    fetchSpy.mockResolvedValue(new Response("server error", { status: 500 }));
    await expect(startDeviceFlow(makeEnv())).rejects.toThrow("Failed to start device flow");
  });

  it("throws INTERNAL_ERROR when response is missing required fields", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ device_code: "DC1" }), { status: 200 }),
    );
    await expect(startDeviceFlow(makeEnv())).rejects.toThrow("Invalid device flow response");
  });

  it("throws INTERNAL_ERROR when GITHUB_CLIENT_ID not set", async () => {
    const env = makeEnv({ GITHUB_CLIENT_ID: undefined } as any);
    await expect(startDeviceFlow(env)).rejects.toThrow("GITHUB_CLIENT_ID not configured");
  });

  it("uses fallback values for missing optional fields", async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          device_code: "DC999",
          user_code: "XY12-ZW34",
          verification_uri: "https://github.com/login/device",
        }),
        { status: 200 },
      ),
    );

    const result = await startDeviceFlow(makeEnv());
    expect(result.expiresIn).toBe(900);
    expect(result.interval).toBe(5);
    expect(result.verificationUriComplete).toBe("https://github.com/login/device");
  });
});

describe("pollDeviceFlow", () => {
  function mockGitHubApis() {
    fetchSpy.mockImplementation((async (input: any) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url === "https://github.com/login/oauth/access_token") {
        return new Response(JSON.stringify({ access_token: "gho_device_tok" }), { status: 200 });
      }
      if (url === "https://api.github.com/user") {
        return new Response(JSON.stringify({ login: "deviceuser", id: 55 }), { status: 200 });
      }
      if (url.startsWith("https://api.github.com/user/repos")) {
        return new Response(
          JSON.stringify([{ id: 500, full_name: "deviceuser/repo", permissions: { admin: true } }]),
          { status: 200 },
        );
      }
      if (url.startsWith("https://api.github.com/user/memberships/orgs")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response("Not Found", { status: 404 });
    }) as any);
  }

  it("returns pending when GitHub responds authorization_pending", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ error: "authorization_pending" }), { status: 200 }),
    );

    const result = await pollDeviceFlow("DCCODE", makeEnv());
    expect("status" in result).toBe(true);
    expect((result as any).status).toBe("pending");
  });

  it("throws RATE_LIMITED for slow_down error", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ error: "slow_down", interval: 10 }), { status: 200 }),
    );

    await expect(pollDeviceFlow("DCCODE", makeEnv())).rejects.toThrow("slow_down");
  });

  it("throws UNAUTHORIZED for expired_token error", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ error: "expired_token" }), { status: 200 }),
    );

    await expect(pollDeviceFlow("DCCODE", makeEnv())).rejects.toThrow("expired");
  });

  it("throws FORBIDDEN for access_denied error", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ error: "access_denied" }), { status: 200 }),
    );

    await expect(pollDeviceFlow("DCCODE", makeEnv())).rejects.toThrow("denied");
  });

  it("throws INVALID_REQUEST for unknown error code", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ error: "some_unknown_error" }), { status: 200 }),
    );

    await expect(pollDeviceFlow("DCCODE", makeEnv())).rejects.toThrow("some_unknown_error");
  });

  it("returns success response with accessToken and refreshToken on approval", async () => {
    mockGitHubApis();

    const result = await pollDeviceFlow("DCCODE", makeEnv());

    expect("status" in result).toBe(false);
    const success = result as Exclude<typeof result, { status: "pending" }>;
    expect(success.githubLogin).toBe("deviceuser");
    expect(success.allowedNamespaceIds).toContain("500");
    expect(success.accessToken).toBeDefined();
    expect(success.refreshToken).toBeDefined();
    expect(success._refreshTokenHash).toBeDefined();
    expect(success.refreshToken).not.toBe(success._refreshTokenHash);
  });

  it("throws when ORUN_SESSION_SECRET not set", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ access_token: "gho_tok" }), { status: 200 }),
    );
    const env = makeEnv({ ORUN_SESSION_SECRET: undefined } as any);
    await expect(pollDeviceFlow("DCCODE", env)).rejects.toThrow("ORUN_SESSION_SECRET not configured");
  });

  it("throws INTERNAL_ERROR when GitHub token endpoint returns non-ok", async () => {
    fetchSpy.mockResolvedValue(new Response("error", { status: 503 }));
    await expect(pollDeviceFlow("DCCODE", makeEnv())).rejects.toThrow("Failed to poll device flow");
  });
});
