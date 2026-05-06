import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleCliToken, handleCliLogout } from "./auth";
import { hashRefreshToken } from "../auth/github-oauth";
import type { Env } from "@orun/types";
import type { RequestContext } from "../auth";

const SESSION_SECRET = "handler-auth-test-secret-32bytes";

function makeEnv(dbOverride?: any): Env {
  return {
    COORDINATOR: {} as any,
    RATE_LIMITER: {} as any,
    STORAGE: {} as any,
    DB: dbOverride ?? makeD1(),
    GITHUB_JWKS_URL: "https://example.com/.well-known/jwks",
    GITHUB_OIDC_AUDIENCE: "orun",
    ORUN_SESSION_SECRET: SESSION_SECRET,
    GITHUB_CLIENT_ID: "test-client-id",
    GITHUB_CLIENT_SECRET: "test-client-secret",
  };
}

function makeDeploy(): RequestContext {
  return { type: "deploy", namespace: null, allowedNamespaceIds: ["*"], actor: "system" };
}

function makeRouteContext(
  body: Record<string, unknown>,
  env?: Env,
): any {
  const request = new Request("https://api.orun.dev/v1/auth/cli/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return {
    request,
    env: env ?? makeEnv(),
    ctx: { waitUntil: vi.fn() } as any,
    params: {},
    authCtx: makeDeploy(),
  };
}

interface CliSessionRow {
  session_id: string;
  account_id: string;
  github_login: string;
  refresh_token_hash: string;
  allowed_namespace_ids_json: string;
  created_at: string;
  last_used_at: string | null;
  expires_at: string;
  revoked_at: string | null;
  user_agent: string | null;
  device_label: string | null;
}

function makeD1(sessions: CliSessionRow[] = []): any {
  const rows = [...sessions];
  return {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => ({
        run: vi.fn(async () => {
          const norm = sql.replace(/\s+/g, " ").trim().toUpperCase();
          if (norm.startsWith("UPDATE CLI_SESSIONS SET LAST_USED_AT")) {
            const row = rows.find((r) => r.session_id === args[1]);
            if (row) row.last_used_at = args[0] as string;
          }
          if (norm.startsWith("UPDATE CLI_SESSIONS SET REVOKED_AT")) {
            const row = rows.find((r) => r.session_id === args[1]);
            if (row) row.revoked_at = args[0] as string;
          }
          return { meta: { changes: 1 } };
        }),
        first: vi.fn(async () => {
          const norm = sql.replace(/\s+/g, " ").trim().toUpperCase();
          if (norm.includes("FROM CLI_SESSIONS") && norm.includes("REFRESH_TOKEN_HASH")) {
            const row = rows.find((r) => r.refresh_token_hash === args[0]);
            if (!row) return null;
            return {
              session_id: row.session_id,
              account_id: row.account_id,
              github_login: row.github_login,
              allowed_namespace_ids_json: row.allowed_namespace_ids_json,
              created_at: row.created_at,
              last_used_at: row.last_used_at,
              expires_at: row.expires_at,
              revoked_at: row.revoked_at,
              user_agent: row.user_agent,
              device_label: row.device_label,
            };
          }
          return null;
        }),
      }),
    }),
  };
}

describe("handleCliToken", () => {
  let rawToken: string;
  let hash: string;

  beforeEach(async () => {
    const { generateRefreshToken } = await import("../auth/github-oauth");
    const t = await generateRefreshToken();
    rawToken = t.raw;
    hash = t.hash;
  });

  it("returns a new access token for a valid refresh token", async () => {
    const expiresAt = new Date(Date.now() + 86400000).toISOString();
    const session: CliSessionRow = {
      session_id: "sess-1",
      account_id: "acct-1",
      github_login: "testuser",
      refresh_token_hash: hash,
      allowed_namespace_ids_json: JSON.stringify(["ns-1"]),
      created_at: new Date().toISOString(),
      last_used_at: null,
      expires_at: expiresAt,
      revoked_at: null,
      user_agent: null,
      device_label: null,
    };

    const rc = makeRouteContext({ refreshToken: rawToken }, makeEnv(makeD1([session])));
    const resp = await handleCliToken(rc);
    expect(resp.status).toBe(200);

    const body = await resp.json() as any;
    expect(body.accessToken).toBeDefined();
    expect(body.githubLogin).toBe("testuser");
    expect(body.allowedNamespaceIds).toEqual(["ns-1"]);
    expect(body.expiresAt).toBeDefined();
  });

  it("rejects unknown refresh token with 401", async () => {
    const rc = makeRouteContext({ refreshToken: rawToken }, makeEnv(makeD1([])));
    try {
      const resp = await handleCliToken(rc);
      expect(resp.status).toBe(401);
    } catch (err: any) {
      expect(err.code).toBe("UNAUTHORIZED");
    }
  });

  it("rejects expired refresh token with 401", async () => {
    const expiresAt = new Date(Date.now() - 1000).toISOString();
    const session: CliSessionRow = {
      session_id: "sess-exp",
      account_id: "acct-1",
      github_login: "testuser",
      refresh_token_hash: hash,
      allowed_namespace_ids_json: JSON.stringify([]),
      created_at: new Date().toISOString(),
      last_used_at: null,
      expires_at: expiresAt,
      revoked_at: null,
      user_agent: null,
      device_label: null,
    };

    const rc = makeRouteContext({ refreshToken: rawToken }, makeEnv(makeD1([session])));
    try {
      const resp = await handleCliToken(rc);
      expect(resp.status).toBe(401);
    } catch (err: any) {
      expect(err.code).toBe("UNAUTHORIZED");
    }
  });

  it("rejects revoked refresh token with 401", async () => {
    const expiresAt = new Date(Date.now() + 86400000).toISOString();
    const session: CliSessionRow = {
      session_id: "sess-rev",
      account_id: "acct-1",
      github_login: "testuser",
      refresh_token_hash: hash,
      allowed_namespace_ids_json: JSON.stringify([]),
      created_at: new Date().toISOString(),
      last_used_at: null,
      expires_at: expiresAt,
      revoked_at: new Date().toISOString(),
      user_agent: null,
      device_label: null,
    };

    const rc = makeRouteContext({ refreshToken: rawToken }, makeEnv(makeD1([session])));
    try {
      const resp = await handleCliToken(rc);
      expect(resp.status).toBe(401);
    } catch (err: any) {
      expect(err.code).toBe("UNAUTHORIZED");
    }
  });

  it("returns 400 when refreshToken is missing from request body", async () => {
    const rc = makeRouteContext({}, makeEnv(makeD1([])));
    try {
      const resp = await handleCliToken(rc);
      expect(resp.status).toBe(400);
    } catch (err: any) {
      expect(err.code).toBe("INVALID_REQUEST");
    }
  });
});

describe("handleCliLogout", () => {
  let rawToken: string;
  let hash: string;

  beforeEach(async () => {
    const { generateRefreshToken } = await import("../auth/github-oauth");
    const t = await generateRefreshToken();
    rawToken = t.raw;
    hash = t.hash;
  });

  function makeLogoutContext(body: Record<string, unknown>, db: any): any {
    const request = new Request("https://api.orun.dev/v1/auth/cli/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return {
      request,
      env: makeEnv(db),
      ctx: { waitUntil: vi.fn() } as any,
      params: {},
      authCtx: makeDeploy(),
    };
  }

  it("revokes session and returns ok:true", async () => {
    const session: CliSessionRow = {
      session_id: "sess-logout",
      account_id: "acct-1",
      github_login: "testuser",
      refresh_token_hash: hash,
      allowed_namespace_ids_json: JSON.stringify([]),
      created_at: new Date().toISOString(),
      last_used_at: null,
      expires_at: new Date(Date.now() + 86400000).toISOString(),
      revoked_at: null,
      user_agent: null,
      device_label: null,
    };
    const db = makeD1([session]);

    const rc = makeLogoutContext({ refreshToken: rawToken }, db);
    const resp = await handleCliLogout(rc);
    expect(resp.status).toBe(200);
    const body = await resp.json() as any;
    expect(body.ok).toBe(true);
    expect(session.revoked_at).not.toBeNull();
  });

  it("returns ok:true even for unknown token (idempotent logout)", async () => {
    const db = makeD1([]);
    const rc = makeLogoutContext({ refreshToken: rawToken }, db);
    const resp = await handleCliLogout(rc);
    expect(resp.status).toBe(200);
    const body = await resp.json() as any;
    expect(body.ok).toBe(true);
  });

  it("returns 400 when refreshToken is missing", async () => {
    const db = makeD1([]);
    const rc = makeLogoutContext({}, db);
    try {
      const resp = await handleCliLogout(rc);
      expect(resp.status).toBe(400);
    } catch (err: any) {
      expect(err.code).toBe("INVALID_REQUEST");
    }
  });
});
