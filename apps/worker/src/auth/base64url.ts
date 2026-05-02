const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function base64urlEncode(data: Uint8Array): string {
  let result = "";
  for (let i = 0; i < data.length; i += 3) {
    const a = data[i];
    const b = data[i + 1] ?? 0;
    const c = data[i + 2] ?? 0;
    const triplet = (a << 16) | (b << 8) | c;

    result += CHARS[(triplet >> 18) & 0x3f];
    result += CHARS[(triplet >> 12) & 0x3f];
    result += i + 1 < data.length ? CHARS[(triplet >> 6) & 0x3f] : "";
    result += i + 2 < data.length ? CHARS[triplet & 0x3f] : "";
  }
  return result.replace(/\+/g, "-").replace(/\//g, "_");
}

export function base64urlDecode(str: string): Uint8Array {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function base64urlEncodeString(str: string): string {
  return base64urlEncode(new TextEncoder().encode(str));
}

export function base64urlDecodeString(b64url: string): string {
  return new TextDecoder().decode(base64urlDecode(b64url));
}
