import type { SessionClaims } from "@orun/types";
import { OrunError } from "./errors";
import { decodeJwt, verifyHmac, buildSignedHmacJwt } from "./jwt";

const DEFAULT_TTL_SECONDS = 3600;

export async function issueSessionToken(
  claims: Omit<SessionClaims, "iat" | "exp">,
  secret: string,
  ttlSeconds = DEFAULT_TTL_SECONDS,
): Promise<string> {
  if (!secret) {
    throw new OrunError("INTERNAL_ERROR", "Session secret not configured");
  }

  const now = Math.floor(Date.now() / 1000);
  const payload: SessionClaims = {
    ...claims,
    iat: now,
    exp: now + ttlSeconds,
  };

  return buildSignedHmacJwt(payload as unknown as Record<string, unknown>, secret);
}

export async function verifySessionToken(
  token: string,
  secret: string,
): Promise<SessionClaims> {
  if (!secret) {
    throw new OrunError("UNAUTHORIZED", "Session secret not configured");
  }

  const { header, payload, signatureBytes, signingInput } = decodeJwt(token);

  if (header.alg === "none") {
    throw new OrunError("UNAUTHORIZED", "Unsigned tokens not accepted");
  }
  if (header.alg !== "HS256") {
    throw new OrunError("UNAUTHORIZED", "Unsupported algorithm");
  }

  const valid = await verifyHmac(signingInput, signatureBytes, secret);
  if (!valid) {
    throw new OrunError("UNAUTHORIZED", "Invalid session signature");
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp <= now) {
    throw new OrunError("UNAUTHORIZED", "Session token expired");
  }

  if (!payload.sub || typeof payload.sub !== "string") {
    throw new OrunError("UNAUTHORIZED", "Missing subject claim");
  }

  if (
    !Array.isArray(payload.allowedNamespaceIds) ||
    !payload.allowedNamespaceIds.every((id: unknown) => typeof id === "string")
  ) {
    throw new OrunError("UNAUTHORIZED", "Invalid allowedNamespaceIds claim");
  }

  return {
    sub: payload.sub as string,
    allowedNamespaceIds: payload.allowedNamespaceIds as string[],
    exp: payload.exp as number,
    iat: payload.iat as number,
  };
}
