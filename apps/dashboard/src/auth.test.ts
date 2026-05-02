import { describe, it, expect } from "vitest";
import { parseOAuthFragment } from "./auth";

describe("parseOAuthFragment", () => {
  it("parses valid fragment with all fields", () => {
    const hash = "#sessionToken=tok123&githubLogin=octocat&allowedNamespaceIds=%5B%22100%22%2C%22200%22%5D";
    const result = parseOAuthFragment(hash);
    expect(result).toEqual({
      sessionToken: "tok123",
      githubLogin: "octocat",
      allowedNamespaceIds: ["100", "200"],
    });
  });

  it("returns null for empty hash", () => {
    expect(parseOAuthFragment("")).toBeNull();
    expect(parseOAuthFragment("#")).toBeNull();
  });

  it("returns null when sessionToken missing", () => {
    const hash = "#githubLogin=octocat";
    expect(parseOAuthFragment(hash)).toBeNull();
  });

  it("returns null when githubLogin missing", () => {
    const hash = "#sessionToken=tok";
    expect(parseOAuthFragment(hash)).toBeNull();
  });

  it("handles missing allowedNamespaceIds gracefully", () => {
    const hash = "#sessionToken=tok&githubLogin=user";
    const result = parseOAuthFragment(hash);
    expect(result).toEqual({
      sessionToken: "tok",
      githubLogin: "user",
      allowedNamespaceIds: [],
    });
  });

  it("handles invalid JSON in allowedNamespaceIds", () => {
    const hash = "#sessionToken=tok&githubLogin=user&allowedNamespaceIds=invalid";
    const result = parseOAuthFragment(hash);
    expect(result?.allowedNamespaceIds).toEqual([]);
  });

  it("does not expose raw token in toString", () => {
    const hash = "#sessionToken=secret&githubLogin=user";
    const result = parseOAuthFragment(hash);
    expect(result?.sessionToken).toBe("secret");
  });
});
