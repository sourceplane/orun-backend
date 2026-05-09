import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { verifySupabaseJwt, looksLikeSupabaseJwt, _clearSupabaseJwksCache, _getSupabaseJwksCacheSize } from "./supabase";
import { base64urlEncode, base64urlEncodeString } from "./base64url";
import type { Env } from "@orun/types";

let rsaKeyPair: CryptoKeyPair;
let rsaJwk: JsonWebKey;

const TEST_KID = "supabase-test-key-1";
const TEST_ISSUER = "https://abcxyz.supabase.co/auth/v1";
const TEST_AUDIENCE = "authenticated";
const TEST_JWKS_URL = "https://abcxyz.supabase.co/auth/v1/.well-known/jwks.json";

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    COORDINATOR: {} as any,
    RATE_LIMITER: {} as any,
    STORAGE: {} as any,
    DB: {} as any,
    GITHUB_JWKS_URL: "https://token.actions.githubusercontent.com/.well-known/jwks",
    GITHUB_OIDC_AUDIENCE: "orun",
    SUPABASE_JWKS_URL: TEST_JWKS_URL,
    SUPABASE_JWT_ISSUER: TEST_ISSUER,
    SUPABASE_JWT_AUDIENCE: TEST_AUDIENCE,
    ...overrides,
  } as unknown as Env;
}

function validPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return {
    sub: "user-uuid-1234",
    email: "test@example.com",
    iss: TEST_ISSUER,
    aud: TEST_AUDIENCE,
    exp: now + 3600,
    iat: now - 10,
    user_metadata: {
      full_name: "Test User",
      user_name: "testuser",
      provider_id: "gh-123",
      avatar_url: "https://example.com/avatar.png",
    },
    ...overrides,
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

async function makeValidToken(overrides: Record<string, unknown> = {}): Promise<string> {
  return signRS256({ alg: "RS256", typ: "JWT", kid: TEST_KID }, validPayload(overrides));
}

function mockJwksFetch() {
  const jwks = {
    keys: [{ ...rsaJwk, kid: TEST_KID, alg: "RS256", use: "sig" }],
  };
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify(jwks), { status: 200 }),
  );
}

beforeEach(async () => {
  _clearSupabaseJwksCache();

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

describe("looksLikeSupabaseJwt", () => {
  it("returns true when SUPABASE_JWKS_URL is set and issuer matches configured issuer", async () => {
    const token = await makeValidToken();
    expect(looksLikeSupabaseJwt(token, makeEnv())).toBe(true);
  });

  it("returns false when SUPABASE_JWKS_URL is not set", async () => {
    const token = await makeValidToken();
    expect(looksLikeSupabaseJwt(token, makeEnv({ SUPABASE_JWKS_URL: undefined }))).toBe(false);
  });

  it("returns false when issuer does not match configured issuer", async () => {
    const token = await makeValidToken({ iss: "https://other.example.com/auth" });
    expect(looksLikeSupabaseJwt(token, makeEnv())).toBe(false);
  });

  it("uses heuristic when SUPABASE_JWT_ISSUER is not set (supabase.co domain)", async () => {
    const token = await makeValidToken({ iss: TEST_ISSUER });
    expect(looksLikeSupabaseJwt(token, makeEnv({ SUPABASE_JWT_ISSUER: undefined }))).toBe(true);
  });

  it("returns false for heuristic when issuer is not supabase.co", async () => {
    const token = await makeValidToken({ iss: "https://evil.example.com/auth/v1" });
    expect(looksLikeSupabaseJwt(token, makeEnv({ SUPABASE_JWT_ISSUER: undefined }))).toBe(false);
  });

  it("returns false for malformed token", () => {
    expect(looksLikeSupabaseJwt("not-a-jwt", makeEnv())).toBe(false);
  });
});

describe("verifySupabaseJwt", () => {
  it("verifies a valid RS256 token and returns claims", async () => {
    const fetchSpy = mockJwksFetch();
    const token = await makeValidToken();
    const env = makeEnv();

    const claims = await verifySupabaseJwt(token, env);
    expect(claims.sub).toBe("user-uuid-1234");
    expect(claims.email).toBe("test@example.com");
    expect(claims.user_metadata?.user_name).toBe("testuser");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid signature", async () => {
    mockJwksFetch();
    const token = await makeValidToken();
    const parts = token.split(".");
    parts[2] = base64urlEncode(crypto.getRandomValues(new Uint8Array(256)));
    const tampered = parts.join(".");

    await expect(verifySupabaseJwt(tampered, makeEnv())).rejects.toThrow("Invalid Supabase JWT signature");
  });

  it("rejects unknown kid", async () => {
    mockJwksFetch();
    const token = await signRS256({ alg: "RS256", typ: "JWT", kid: "unknown-kid" }, validPayload());

    await expect(verifySupabaseJwt(token, makeEnv())).rejects.toThrow("Unknown Supabase key ID");
  });

  it("rejects wrong issuer when SUPABASE_JWT_ISSUER is configured", async () => {
    mockJwksFetch();
    const token = await makeValidToken({ iss: "https://other.example.com/auth/v1" });

    await expect(verifySupabaseJwt(token, makeEnv())).rejects.toThrow("Invalid Supabase issuer");
  });

  it("rejects wrong audience (string)", async () => {
    mockJwksFetch();
    const token = await makeValidToken({ aud: "wrong-audience" });

    await expect(verifySupabaseJwt(token, makeEnv())).rejects.toThrow("Invalid Supabase audience");
  });

  it("accepts audience as array containing expected value", async () => {
    mockJwksFetch();
    const token = await makeValidToken({ aud: [TEST_AUDIENCE, "other"] });

    const claims = await verifySupabaseJwt(token, makeEnv());
    expect(claims.sub).toBe("user-uuid-1234");
  });

  it("rejects expired token", async () => {
    mockJwksFetch();
    const token = await makeValidToken({ exp: Math.floor(Date.now() / 1000) - 10 });

    await expect(verifySupabaseJwt(token, makeEnv())).rejects.toThrow("Supabase JWT expired");
  });

  it("rejects token with missing sub", async () => {
    mockJwksFetch();
    const token = await makeValidToken({ sub: "" });

    await expect(verifySupabaseJwt(token, makeEnv())).rejects.toThrow("Missing sub");
  });

  it("rejects unsupported algorithm", async () => {
    mockJwksFetch();
    const token = await signRS256({ alg: "RS384", typ: "JWT", kid: TEST_KID }, validPayload());

    await expect(verifySupabaseJwt(token, makeEnv())).rejects.toThrow("Unsupported Supabase JWT algorithm");
  });

  it("throws when SUPABASE_JWKS_URL is not set", async () => {
    const token = await makeValidToken();
    await expect(verifySupabaseJwt(token, makeEnv({ SUPABASE_JWKS_URL: undefined }))).rejects.toThrow(
      "Supabase auth not configured",
    );
  });

  it("uses JWKS cache on second call", async () => {
    const fetchSpy = mockJwksFetch();
    const env = makeEnv();

    await verifySupabaseJwt(await makeValidToken(), env);
    await verifySupabaseJwt(await makeValidToken({ email: "other@example.com" }), env);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(_getSupabaseJwksCacheSize()).toBe(1);
  });

  it("throws when JWKS endpoint returns non-200", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("error", { status: 500 }));
    const token = await makeValidToken();

    await expect(verifySupabaseJwt(token, makeEnv())).rejects.toThrow("Failed to fetch Supabase JWKS");
  });
});
