import { base64urlDecode, base64urlDecodeString, base64urlEncode, base64urlEncodeString } from "./base64url";
import { OrunError } from "./errors";

export interface JwtHeader {
  alg: string;
  typ?: string;
  kid?: string;
}

export interface JwtParts {
  header: JwtHeader;
  payload: Record<string, unknown>;
  signatureBytes: Uint8Array;
  signingInput: string;
}

export function decodeJwt(token: string): JwtParts {
  const segments = token.split(".");
  if (segments.length !== 3) {
    throw new OrunError("UNAUTHORIZED", "Malformed JWT: expected 3 segments");
  }

  let header: JwtHeader;
  try {
    header = JSON.parse(base64urlDecodeString(segments[0]));
  } catch {
    throw new OrunError("UNAUTHORIZED", "Malformed JWT header");
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(base64urlDecodeString(segments[1]));
  } catch {
    throw new OrunError("UNAUTHORIZED", "Malformed JWT payload");
  }

  const signatureBytes = base64urlDecode(segments[2]);
  const signingInput = segments[0] + "." + segments[1];

  return { header, payload, signatureBytes, signingInput };
}

export async function signHmac(
  signingInput: string,
  secret: string,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(signingInput),
  );
  return new Uint8Array(sig);
}

export async function verifyHmac(
  signingInput: string,
  signatureBytes: Uint8Array,
  secret: string,
): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    "HMAC",
    key,
    signatureBytes,
    new TextEncoder().encode(signingInput),
  );
}

export function buildJwt(
  header: JwtHeader,
  payload: Record<string, unknown>,
  signatureBytes: Uint8Array,
): string {
  const h = base64urlEncodeString(JSON.stringify(header));
  const p = base64urlEncodeString(JSON.stringify(payload));
  const s = base64urlEncode(signatureBytes);
  return `${h}.${p}.${s}`;
}

export async function buildSignedHmacJwt(
  payload: Record<string, unknown>,
  secret: string,
): Promise<string> {
  const header: JwtHeader = { alg: "HS256", typ: "JWT" };
  const h = base64urlEncodeString(JSON.stringify(header));
  const p = base64urlEncodeString(JSON.stringify(payload));
  const signingInput = `${h}.${p}`;
  const sig = await signHmac(signingInput, secret);
  return `${signingInput}.${base64urlEncode(sig)}`;
}
