import type { Env } from "@orun/types";
import { OrunError } from "./errors";
import { decodeJwt } from "./jwt";
import { base64urlDecodeString } from "./base64url";

export interface SupabaseClaims {
  sub: string;
  email?: string;
  iss: string;
  aud: string | string[];
  exp: number;
  iat: number;
  user_metadata?: {
    avatar_url?: string;
    email?: string;
    full_name?: string;
    name?: string;
    user_name?: string;
    provider_id?: string;
  };
}

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
const cache = new Map<string, JwksCache>();

export function _clearSupabaseJwksCache(): void {
  cache.clear();
}

export function _getSupabaseJwksCacheSize(): number {
  return cache.size;
}

async function fetchJwks(jwksUrl: string, nowMs = Date.now()): Promise<JwksResponse> {
  const cached = cache.get(jwksUrl);
  if (cached && cached.expiresAt > nowMs) return cached.value;

  const resp = await fetch(jwksUrl);
  if (!resp.ok) throw new OrunError("UNAUTHORIZED", "Failed to fetch Supabase JWKS");

  const jwks = (await resp.json()) as JwksResponse;
  cache.set(jwksUrl, { value: jwks, expiresAt: nowMs + JWKS_TTL_MS });
  return jwks;
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

export function looksLikeSupabaseJwt(token: string, env: Env): boolean {
  if (!env.SUPABASE_JWKS_URL) return false;
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return false;
    const payload = JSON.parse(base64urlDecodeString(parts[1])) as Record<string, unknown>;
    if (typeof payload.iss !== "string") return false;
    const issuer = env.SUPABASE_JWT_ISSUER;
    if (issuer) return payload.iss === issuer;
    // Default heuristic: Supabase issuers contain supabase.co/auth/v1
    return payload.iss.includes("supabase.co/auth/v1") || payload.iss.includes("supabase.in/auth/v1");
  } catch {
    return false;
  }
}

export async function verifySupabaseJwt(token: string, env: Env): Promise<SupabaseClaims> {
  if (!env.SUPABASE_JWKS_URL) {
    throw new OrunError("UNAUTHORIZED", "Supabase auth not configured");
  }

  const { header, payload, signatureBytes, signingInput } = decodeJwt(token);

  if (header.alg !== "RS256") {
    throw new OrunError("UNAUTHORIZED", "Unsupported Supabase JWT algorithm");
  }
  if (!header.kid) {
    throw new OrunError("UNAUTHORIZED", "Missing key ID in Supabase JWT");
  }

  const jwks = await fetchJwks(env.SUPABASE_JWKS_URL);
  const jwk = jwks.keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new OrunError("UNAUTHORIZED", "Unknown Supabase key ID");

  const key = await importRsaKey(jwk);
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    signatureBytes,
    new TextEncoder().encode(signingInput),
  );
  if (!valid) throw new OrunError("UNAUTHORIZED", "Invalid Supabase JWT signature");

  if (env.SUPABASE_JWT_ISSUER && payload.iss !== env.SUPABASE_JWT_ISSUER) {
    throw new OrunError("UNAUTHORIZED", "Invalid Supabase issuer");
  }

  const expectedAudience = env.SUPABASE_JWT_AUDIENCE ?? "authenticated";
  const aud = payload.aud;
  const audOk = Array.isArray(aud)
    ? aud.includes(expectedAudience)
    : aud === expectedAudience;
  if (!audOk) throw new OrunError("UNAUTHORIZED", "Invalid Supabase audience");

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp <= now) {
    throw new OrunError("UNAUTHORIZED", "Supabase JWT expired");
  }

  if (!payload.sub || typeof payload.sub !== "string") {
    throw new OrunError("UNAUTHORIZED", "Missing sub in Supabase JWT");
  }

  return {
    sub: payload.sub as string,
    email: typeof payload.email === "string" ? payload.email : undefined,
    iss: payload.iss as string,
    aud: payload.aud as string | string[],
    exp: payload.exp as number,
    iat: typeof payload.iat === "number" ? payload.iat : 0,
    user_metadata: (payload.user_metadata as SupabaseClaims["user_metadata"]) ?? undefined,
  };
}
