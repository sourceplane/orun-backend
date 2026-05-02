import type { Env, Namespace, OIDCClaims } from "@orun/types";
import { base64urlDecode, base64urlDecodeString } from "./base64url";
import { OrunError } from "./errors";
import { decodeJwt } from "./jwt";

interface JwkKey {
  kty: string;
  kid: string;
  alg?: string;
  n?: string;
  e?: string;
  use?: string;
}

interface JwksResponse {
  keys: JwkKey[];
}

interface JwksCache {
  value: JwksResponse;
  expiresAt: number;
}

const JWKS_TTL_MS = 15 * 60 * 1000;
const EXPECTED_ISSUER = "https://token.actions.githubusercontent.com";
const REQUIRED_CLAIMS = [
  "repository",
  "repository_id",
  "repository_owner",
  "repository_owner_id",
  "actor",
] as const;

const cache = new Map<string, JwksCache>();

export function _clearJwksCache(): void {
  cache.clear();
}

export function _getJwksCacheSize(): number {
  return cache.size;
}

async function fetchJwks(
  jwksUrl: string,
  nowMs = Date.now(),
): Promise<JwksResponse> {
  const cached = cache.get(jwksUrl);
  if (cached && cached.expiresAt > nowMs) {
    return cached.value;
  }

  const resp = await fetch(jwksUrl);
  if (!resp.ok) {
    throw new OrunError("UNAUTHORIZED", "Failed to fetch JWKS");
  }

  const jwks: JwksResponse = await resp.json();
  cache.set(jwksUrl, { value: jwks, expiresAt: nowMs + JWKS_TTL_MS });
  return jwks;
}

function findKey(jwks: JwksResponse, kid: string): JwkKey {
  const key = jwks.keys.find((k) => k.kid === kid);
  if (!key) {
    throw new OrunError("UNAUTHORIZED", "Unknown key ID");
  }
  return key;
}

async function importRsaKey(jwk: JwkKey): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "jwk",
    jwk as JsonWebKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
}

export function looksLikeOIDC(token: string): boolean {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return false;
    const payload = JSON.parse(base64urlDecodeString(parts[1]));
    return payload.iss === EXPECTED_ISSUER;
  } catch {
    return false;
  }
}

export async function verifyOIDCToken(
  token: string,
  env: Env,
): Promise<OIDCClaims> {
  const { header, payload, signatureBytes, signingInput } = decodeJwt(token);

  if (header.alg !== "RS256") {
    throw new OrunError("UNAUTHORIZED", "Unsupported algorithm");
  }
  if (!header.kid) {
    throw new OrunError("UNAUTHORIZED", "Missing key ID");
  }

  const jwks = await fetchJwks(env.GITHUB_JWKS_URL);
  const jwk = findKey(jwks, header.kid);
  const key = await importRsaKey(jwk);

  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    signatureBytes,
    new TextEncoder().encode(signingInput),
  );
  if (!valid) {
    throw new OrunError("UNAUTHORIZED", "Invalid OIDC signature");
  }

  if (payload.iss !== EXPECTED_ISSUER) {
    throw new OrunError("UNAUTHORIZED", "Invalid issuer");
  }

  const aud = payload.aud;
  if (Array.isArray(aud)) {
    if (!aud.includes(env.GITHUB_OIDC_AUDIENCE)) {
      throw new OrunError("UNAUTHORIZED", "Invalid audience");
    }
  } else if (aud !== env.GITHUB_OIDC_AUDIENCE) {
    throw new OrunError("UNAUTHORIZED", "Invalid audience");
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp <= now) {
    throw new OrunError("UNAUTHORIZED", "Token expired");
  }
  if (typeof payload.iat !== "number" || payload.iat > now + 60) {
    throw new OrunError("UNAUTHORIZED", "Token not yet valid");
  }

  for (const claim of REQUIRED_CLAIMS) {
    if (!payload[claim] || typeof payload[claim] !== "string") {
      throw new OrunError("UNAUTHORIZED", `Missing required claim: ${claim}`);
    }
  }

  return {
    repository: payload.repository as string,
    repository_id: payload.repository_id as string,
    repository_owner: payload.repository_owner as string,
    repository_owner_id: payload.repository_owner_id as string,
    actor: payload.actor as string,
    aud: typeof aud === "string" ? aud : (aud as string[])[0],
    iss: payload.iss as string,
    exp: payload.exp as number,
    iat: payload.iat as number,
  };
}

export function extractNamespaceFromOIDC(claims: OIDCClaims): Namespace {
  return {
    namespaceId: claims.repository_id,
    namespaceSlug: claims.repository,
  };
}
