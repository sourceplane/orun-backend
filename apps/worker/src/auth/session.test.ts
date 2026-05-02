import { describe, it, expect, vi, afterEach } from "vitest";
import { issueSessionToken, verifySessionToken } from "./session";

const SECRET = "test-session-secret-32-bytes-long";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("issueSessionToken + verifySessionToken", () => {
  it("issues and verifies a valid token", async () => {
    const token = await issueSessionToken(
      { sub: "testuser", allowedNamespaceIds: ["111", "222"] },
      SECRET,
    );
    expect(typeof token).toBe("string");
    expect(token.split(".")).toHaveLength(3);

    const claims = await verifySessionToken(token, SECRET);
    expect(claims.sub).toBe("testuser");
    expect(claims.allowedNamespaceIds).toEqual(["111", "222"]);
    expect(claims.exp).toBeGreaterThan(claims.iat);
  });

  it("uses custom TTL", async () => {
    const token = await issueSessionToken(
      { sub: "u", allowedNamespaceIds: [] },
      SECRET,
      60,
    );
    const claims = await verifySessionToken(token, SECRET);
    expect(claims.exp - claims.iat).toBe(60);
  });
});

describe("verifySessionToken rejections", () => {
  it("rejects expired token", async () => {
    const token = await issueSessionToken(
      { sub: "u", allowedNamespaceIds: ["1"] },
      SECRET,
      -10,
    );
    await expect(verifySessionToken(token, SECRET)).rejects.toThrow("Session token expired");
  });

  it("rejects tampered signature", async () => {
    const token = await issueSessionToken(
      { sub: "u", allowedNamespaceIds: ["1"] },
      SECRET,
    );
    const parts = token.split(".");
    parts[2] = "AAAA" + parts[2].slice(4);
    await expect(verifySessionToken(parts.join("."), SECRET)).rejects.toThrow("Invalid session signature");
  });

  it("rejects wrong secret", async () => {
    const token = await issueSessionToken(
      { sub: "u", allowedNamespaceIds: ["1"] },
      SECRET,
    );
    await expect(verifySessionToken(token, "wrong-secret")).rejects.toThrow("Invalid session signature");
  });

  it("rejects malformed token", async () => {
    await expect(verifySessionToken("not-a-jwt", SECRET)).rejects.toThrow("Malformed JWT");
  });

  it("rejects missing sub claim", async () => {
    const { buildSignedHmacJwt } = await import("./jwt");
    const token = await buildSignedHmacJwt(
      { allowedNamespaceIds: ["1"], exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000) },
      SECRET,
    );
    await expect(verifySessionToken(token, SECRET)).rejects.toThrow("Missing subject claim");
  });

  it("rejects invalid allowedNamespaceIds", async () => {
    const { buildSignedHmacJwt } = await import("./jwt");
    const token = await buildSignedHmacJwt(
      { sub: "u", allowedNamespaceIds: "not-an-array", exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000) },
      SECRET,
    );
    await expect(verifySessionToken(token, SECRET)).rejects.toThrow("Invalid allowedNamespaceIds");
  });

  it("rejects none algorithm", async () => {
    const { base64urlEncodeString } = await import("./base64url");
    const h = base64urlEncodeString(JSON.stringify({ alg: "none", typ: "JWT" }));
    const p = base64urlEncodeString(JSON.stringify({ sub: "u", allowedNamespaceIds: ["1"], exp: 9999999999, iat: 0 }));
    const token = `${h}.${p}.`;
    await expect(verifySessionToken(token, SECRET)).rejects.toThrow();
  });

  it("rejects empty secret", async () => {
    await expect(verifySessionToken("a.b.c", "")).rejects.toThrow("Session secret not configured");
  });
});

describe("issueSessionToken rejections", () => {
  it("rejects empty secret", async () => {
    await expect(
      issueSessionToken({ sub: "u", allowedNamespaceIds: [] }, ""),
    ).rejects.toThrow("Session secret not configured");
  });
});
