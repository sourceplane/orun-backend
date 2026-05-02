import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { authenticate, OrunError } from "./index";
import { _clearJwksCache } from "./oidc";
import { base64urlEncode, base64urlEncodeString } from "./base64url";
import type { Env } from "@orun/types";

const SESSION_SECRET = "auth-test-secret-32-bytes-long!!";
const DEPLOY_TOKEN = "deploy-token-value";
const TEST_AUDIENCE = "orun";
const TEST_JWKS_URL = "https://token.actions.githubusercontent.com/.well-known/jwks";

let rsaKeyPair: CryptoKeyPair;
let rsaJwk: JsonWebKey;

interface BoundCall {
  sql: string;
  params: unknown[];
}

function makeFakeDb(): { db: D1Database; calls: BoundCall[] } {
  const calls: BoundCall[] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          calls.push({ sql, params });
          return { run: async () => ({ meta: { changes: 1 }, results: [], success: true }) };
        },
      };
    },
  } as unknown as D1Database;
  return { db, calls };
}

function makeEnv(dbOverride?: D1Database, extra: Partial<Env> = {}): Env {
  const { db } = makeFakeDb();
  return {
    COORDINATOR: {} as any,
    STORAGE: {} as any,
    DB: dbOverride ?? db,
    GITHUB_JWKS_URL: TEST_JWKS_URL,
    GITHUB_OIDC_AUDIENCE: TEST_AUDIENCE,
    ORUN_SESSION_SECRET: SESSION_SECRET,
    ORUN_DEPLOY_TOKEN: DEPLOY_TOKEN,
    ...extra,
  };
}

async function signRS256(header: Record<string, unknown>, payload: Record<string, unknown>): Promise<string> {
  const h = base64urlEncodeString(JSON.stringify(header));
  const p = base64urlEncodeString(JSON.stringify(payload));
  const signingInput = `${h}.${p}`;
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    rsaKeyPair.privateKey,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64urlEncode(new Uint8Array(sig))}`;
}

function mockJwksFetch() {
  const jwks = {
    keys: [{ ...rsaJwk, kid: "test-key-1", alg: "RS256", use: "sig" }],
  };
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify(jwks), { status: 200 }),
  );
}

function validOIDCClaims(): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: "https://token.actions.githubusercontent.com",
    aud: TEST_AUDIENCE,
    exp: now + 3600,
    iat: now - 10,
    repository: "sourceplane/orun",
    repository_id: "123456789",
    repository_owner: "sourceplane",
    repository_owner_id: "987654321",
    actor: "ci-runner",
  };
}

beforeEach(async () => {
  _clearJwksCache();
  if (!rsaKeyPair) {
    rsaKeyPair = (await crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    rsaJwk = (await crypto.subtle.exportKey("jwk", rsaKeyPair.publicKey)) as JsonWebKey;
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("authenticate", () => {
  it("returns deploy context for valid deploy token", async () => {
    const req = new Request("https://api.orun.dev/v1/bootstrap", {
      headers: { "X-Orun-Deploy-Token": DEPLOY_TOKEN },
    });
    const ctx = await authenticate(req, makeEnv());
    expect(ctx.type).toBe("deploy");
    expect(ctx.namespace).toBeNull();
    expect(ctx.allowedNamespaceIds).toEqual(["*"]);
    expect(ctx.actor).toBe("system");
  });

  it("rejects invalid deploy token", async () => {
    const req = new Request("https://api.orun.dev/v1/bootstrap", {
      headers: { "X-Orun-Deploy-Token": "wrong-token" },
    });
    await expect(authenticate(req, makeEnv())).rejects.toThrow("Invalid deploy token");
  });

  it("rejects missing auth header", async () => {
    const req = new Request("https://api.orun.dev/v1/runs");
    await expect(authenticate(req, makeEnv())).rejects.toThrow("Missing authorization header");
  });

  it("returns OIDC context and upserts namespace", async () => {
    mockJwksFetch();
    const { db, calls } = makeFakeDb();
    const token = await signRS256(
      { alg: "RS256", typ: "JWT", kid: "test-key-1" },
      validOIDCClaims(),
    );

    const req = new Request("https://api.orun.dev/v1/runs", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const ctx = await authenticate(req, makeEnv(db));

    expect(ctx.type).toBe("oidc");
    expect(ctx.namespace).toEqual({ namespaceId: "123456789", namespaceSlug: "sourceplane/orun" });
    expect(ctx.allowedNamespaceIds).toEqual(["123456789"]);
    expect(ctx.actor).toBe("ci-runner");
    expect(calls).toHaveLength(1);
    expect(calls[0].params[0]).toBe("123456789");
    expect(calls[0].params[1]).toBe("sourceplane/orun");
  });

  it("uses ctx.waitUntil when provided", async () => {
    mockJwksFetch();
    const { db } = makeFakeDb();
    const token = await signRS256(
      { alg: "RS256", typ: "JWT", kid: "test-key-1" },
      validOIDCClaims(),
    );

    const waitUntilCalls: Promise<unknown>[] = [];
    const execCtx = { waitUntil: (p: Promise<unknown>) => waitUntilCalls.push(p) };

    const req = new Request("https://api.orun.dev/v1/runs", {
      headers: { Authorization: `Bearer ${token}` },
    });
    await authenticate(req, makeEnv(db), execCtx);

    expect(waitUntilCalls).toHaveLength(1);
  });

  it("returns session context for valid session token", async () => {
    const { issueSessionToken } = await import("./session");
    const token = await issueSessionToken(
      { sub: "testuser", allowedNamespaceIds: ["111", "222"] },
      SESSION_SECRET,
    );

    const req = new Request("https://api.orun.dev/v1/runs", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const ctx = await authenticate(req, makeEnv());

    expect(ctx.type).toBe("session");
    expect(ctx.namespace).toBeNull();
    expect(ctx.allowedNamespaceIds).toEqual(["111", "222"]);
    expect(ctx.actor).toBe("testuser");
  });

  it("rejects invalid OIDC token", async () => {
    mockJwksFetch();
    const token = await signRS256(
      { alg: "RS256", typ: "JWT", kid: "test-key-1" },
      { ...validOIDCClaims(), exp: Math.floor(Date.now() / 1000) - 10 },
    );

    const req = new Request("https://api.orun.dev/v1/runs", {
      headers: { Authorization: `Bearer ${token}` },
    });
    await expect(authenticate(req, makeEnv())).rejects.toThrow("Token expired");
  });

  it("OIDC slug upsert is idempotent and updates changed slugs", async () => {
    mockJwksFetch();
    const { db, calls } = makeFakeDb();

    const token1 = await signRS256(
      { alg: "RS256", typ: "JWT", kid: "test-key-1" },
      validOIDCClaims(),
    );
    const req1 = new Request("https://api.orun.dev/v1/runs", {
      headers: { Authorization: `Bearer ${token1}` },
    });
    await authenticate(req1, makeEnv(db));

    const token2 = await signRS256(
      { alg: "RS256", typ: "JWT", kid: "test-key-1" },
      { ...validOIDCClaims(), repository: "sourceplane/renamed-repo" },
    );
    const req2 = new Request("https://api.orun.dev/v1/runs", {
      headers: { Authorization: `Bearer ${token2}` },
    });
    await authenticate(req2, makeEnv(db));

    expect(calls).toHaveLength(2);
    expect(calls[0].params[1]).toBe("sourceplane/orun");
    expect(calls[1].params[1]).toBe("sourceplane/renamed-repo");
  });
});
