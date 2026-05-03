import { describe, it, expect, vi } from "vitest";

vi.mock("@orun/client", () => ({
  OrunClient: class {
    private baseUrl: string;
    constructor(opts: { baseUrl: string }) {
      this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    }
    getGitHubAuthUrl(returnTo?: string) {
      return returnTo
        ? `${this.baseUrl}/v1/auth/github?returnTo=${encodeURIComponent(returnTo)}`
        : `${this.baseUrl}/v1/auth/github`;
    }
  },
  OrunClientError: class extends Error {
    status: number;
    code: string;
    constructor(status: number, code: string, message: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
}));

describe("api module", () => {
  it("createClient creates a client with the configured base URL", async () => {
    const { createClient } = await import("./api");
    const client = createClient("test-token");
    expect(client).toBeDefined();
  });

  it("getAuthUrl returns expected URL shape", async () => {
    const { getAuthUrl } = await import("./api");
    const url = getAuthUrl();
    expect(url).toContain("/v1/auth/github");
    expect(url).toContain("returnTo=");
  });
});
