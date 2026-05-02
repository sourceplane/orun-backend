import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { verifyOIDCToken, extractNamespaceFromOIDC, looksLikeOIDC, _clearJwksCache, _getJwksCacheSize } from "./oidc";
import { base64urlEncode, base64urlEncodeString } from "./base64url";
import type { Env } from "@orun/types";

let rsaKeyPair: CryptoKeyPair;
let rsaJwk: JsonWebKey;

const TEST_KID = "test-key-1";
const TEST_AUDIENCE = "orun";
const TEST_JWKS_URL = "https://token.actions.githubusercontent.com/.well-known/jwks";

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    COORDINATOR: {} as any,
    STORAGE: {} as any,
    DB: {} as any,
    GITHUB_JWKS_URL: TEST_JWKS_URL,
    GITHUB_OIDC_AUDIENCE: TEST_AUDIENCE,
    ...overrides,
  };
}

function validClaims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
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
    actor: "test-user",
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
  return signRS256({ alg: "RS256", typ: "JWT", kid: TEST_KID }, validClaims(overrides));
}

function mockJwksFetch() {
  const jwks = {
    keys: [
      { ...rsaJwk, kid: TEST_KID, alg: "RS256", use: "sig" },
    ],
  };
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify(jwks), { status: 200 }),
  );
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

describe("looksLikeOIDC", () => {
  it("returns true for GitHub OIDC issuer", async () => {
    const token = await makeValidToken();
    expect(looksLikeOIDC(token)).toBe(true);
  });

  it("returns false for non-OIDC token", () => {
    const h = base64urlEncodeString(JSON.stringify({ alg: "HS256" }));
    const p = base64urlEncodeString(JSON.stringify({ iss: "self", sub: "test" }));
    expect(looksLikeOIDC(`${h}.${p}.sig`)).toBe(false);
  });

  it("returns false for malformed token", () => {
    expect(looksLikeOIDC("not-a-jwt")).toBe(false);
  });
});

describe("verifyOIDCToken", () => {
  it("verifies a valid RS256 token", async () => {
    const fetchSpy = mockJwksFetch();
    const token = await makeValidToken();
    const env = makeEnv();

    const claims = await verifyOIDCToken(token, env);
    expect(claims.repository).toBe("sourceplane/orun");
    expect(claims.repository_id).toBe("123456789");
    expect(claims.actor).toBe("test-user");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid signature", async () => {
    mockJwksFetch();
    const token = await makeValidToken();
    const parts = token.split(".");
    parts[2] = base64urlEncode(crypto.getRandomValues(new Uint8Array(256)));
    const tampered = parts.join(".");

    await expect(verifyOIDCToken(tampered, makeEnv())).rejects.toThrow("Invalid OIDC signature");
  });

  it("rejects unknown kid", async () => {
    mockJwksFetch();
    const token = await signRS256(
      { alg: "RS256", typ: "JWT", kid: "unknown-kid" },
      validClaims(),
    );

    await expect(verifyOIDCToken(token, makeEnv())).rejects.toThrow("Unknown key ID");
  });

  it("rejects wrong issuer", async () => {
    mockJwksFetch();
    const token = await makeValidToken({ iss: "https://evil.example.com" });

    await expect(verifyOIDCToken(token, makeEnv())).rejects.toThrow("Invalid issuer");
  });

  it("rejects wrong audience", async () => {
    mockJwksFetch();
    const token = await makeValidToken({ aud: "wrong-audience" });

    await expect(verifyOIDCToken(token, makeEnv())).rejects.toThrow("Invalid audience");
  });

  it("accepts audience as array containing expected value", async () => {
    mockJwksFetch();
    const token = await makeValidToken({ aud: [TEST_AUDIENCE, "other"] });

    const claims = await verifyOIDCToken(token, makeEnv());
    expect(claims.repository).toBe("sourceplane/orun");
  });

  it("rejects audience array missing expected value", async () => {
    mockJwksFetch();
    const token = await makeValidToken({ aud: ["other1", "other2"] });

    await expect(verifyOIDCToken(token, makeEnv())).rejects.toThrow("Invalid audience");
  });

  it("rejects expired token", async () => {
    mockJwksFetch();
    const token = await makeValidToken({ exp: Math.floor(Date.now() / 1000) - 10 });

    await expect(verifyOIDCToken(token, makeEnv())).rejects.toThrow("Token expired");
  });

  it("rejects future iat", async () => {
    mockJwksFetch();
    const token = await makeValidToken({ iat: Math.floor(Date.now() / 1000) + 120 });

    await expect(verifyOIDCToken(token, makeEnv())).rejects.toThrow("Token not yet valid");
  });

  it("rejects missing required claims", async () => {
    mockJwksFetch();
    for (const claim of ["repository", "repository_id", "repository_owner", "repository_owner_id", "actor"]) {
      const token = await makeValidToken({ [claim]: "" });
      await expect(verifyOIDCToken(token, makeEnv())).rejects.toThrow(`Missing required claim: ${claim}`);
    }
  });

  it("rejects malformed JWT", async () => {
    mockJwksFetch();
    await expect(verifyOIDCToken("not.a.valid-jwt-at-all", makeEnv())).rejects.toThrow();
  });

  it("rejects unsupported algorithm", async () => {
    mockJwksFetch();
    const token = await signRS256({ alg: "RS384", typ: "JWT", kid: TEST_KID }, validClaims());

    await expect(verifyOIDCToken(token, makeEnv())).rejects.toThrow("Unsupported algorithm");
  });

  it("uses JWKS cache on second call", async () => {
    const fetchSpy = mockJwksFetch();
    const env = makeEnv();

    const token1 = await makeValidToken();
    await verifyOIDCToken(token1, env);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const token2 = await makeValidToken({ actor: "user2" });
    const claims = await verifyOIDCToken(token2, env);
    expect(claims.actor).toBe("user2");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(_getJwksCacheSize()).toBe(1);
  });
});

describe("extractNamespaceFromOIDC", () => {
  it("maps repository_id and repository to namespace", () => {
    const ns = extractNamespaceFromOIDC({
      repository: "sourceplane/orun",
      repository_id: "123456789",
      repository_owner: "sourceplane",
      repository_owner_id: "987654321",
      actor: "user",
      aud: "orun",
      iss: "https://token.actions.githubusercontent.com",
      exp: 0,
      iat: 0,
    });
    expect(ns.namespaceId).toBe("123456789");
    expect(ns.namespaceSlug).toBe("sourceplane/orun");
  });
});
