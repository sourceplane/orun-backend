import { describe, it, expect } from "vitest";
import { base64urlEncode, base64urlDecode, base64urlEncodeString, base64urlDecodeString } from "./base64url";

describe("base64url", () => {
  it("round-trips binary data", () => {
    const input = new Uint8Array([0, 1, 2, 255, 254, 253]);
    const encoded = base64urlEncode(input);
    expect(encoded).not.toContain("+");
    expect(encoded).not.toContain("/");
    expect(encoded).not.toContain("=");
    const decoded = base64urlDecode(encoded);
    expect(decoded).toEqual(input);
  });

  it("round-trips string data", () => {
    const input = '{"alg":"RS256","kid":"abc"}';
    const encoded = base64urlEncodeString(input);
    const decoded = base64urlDecodeString(encoded);
    expect(decoded).toBe(input);
  });

  it("handles empty input", () => {
    const encoded = base64urlEncode(new Uint8Array(0));
    expect(encoded).toBe("");
    const decoded = base64urlDecode("");
    expect(decoded).toEqual(new Uint8Array(0));
  });

  it("decodes standard base64url without padding", () => {
    const encoded = base64urlEncodeString("test");
    const noPad = encoded.replace(/=+$/, "");
    expect(base64urlDecodeString(noPad)).toBe("test");
  });

  it("handles single-byte and two-byte inputs", () => {
    expect(base64urlDecodeString(base64urlEncodeString("a"))).toBe("a");
    expect(base64urlDecodeString(base64urlEncodeString("ab"))).toBe("ab");
    expect(base64urlDecodeString(base64urlEncodeString("abc"))).toBe("abc");
  });
});
