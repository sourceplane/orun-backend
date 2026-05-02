import type { Run, Job, ApiError } from "@orun/types";

export class OrunClientError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly body: string;

  constructor(status: number, code: string, message: string, body: string) {
    super(message);
    this.name = "OrunClientError";
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

export type TokenProvider = string | (() => string | null) | (() => Promise<string | null>);

export interface OrunClientOptions {
  baseUrl: string;
  token?: TokenProvider;
  fetch?: typeof globalThis.fetch;
}

export class OrunClient {
  private readonly baseUrl: string;
  private readonly tokenProvider: TokenProvider | undefined;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(options: OrunClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.tokenProvider = options.token;
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  private async resolveToken(): Promise<string | null> {
    if (!this.tokenProvider) return null;
    if (typeof this.tokenProvider === "string") return this.tokenProvider;
    const result = this.tokenProvider();
    if (result instanceof Promise) return result;
    return result;
  }

  private async request(method: string, path: string, opts?: { body?: unknown; query?: Record<string, string>; expectText?: boolean }): Promise<unknown> {
    let url = `${this.baseUrl}${path}`;
    if (opts?.query) {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(opts.query)) {
        if (v !== undefined && v !== "") params.set(k, v);
      }
      const qs = params.toString();
      if (qs) url += `?${qs}`;
    }

    const headers: Record<string, string> = {};
    const token = await this.resolveToken();
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    if (opts?.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    const resp = await this.fetchImpl(url, {
      method,
      headers,
      body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });

    if (!resp.ok) {
      const text = await resp.text();
      let code = "UNKNOWN";
      let message = text;
      try {
        const parsed = JSON.parse(text) as ApiError;
        if (parsed.code) code = parsed.code;
        if (parsed.error) message = parsed.error;
      } catch {}
      throw new OrunClientError(resp.status, code, message, text);
    }

    if (opts?.expectText) {
      return resp.text();
    }
    return resp.json();
  }

  getGitHubAuthUrl(returnTo?: string): string {
    const base = `${this.baseUrl}/v1/auth/github`;
    if (!returnTo) return base;
    return `${base}?returnTo=${encodeURIComponent(returnTo)}`;
  }

  async createAccount(): Promise<{ accountId: string; githubLogin: string; createdAt: string }> {
    return this.request("POST", "/v1/accounts") as Promise<{ accountId: string; githubLogin: string; createdAt: string }>;
  }

  async getAccount(): Promise<{ accountId: string; githubLogin: string; createdAt: string }> {
    return this.request("GET", "/v1/accounts/me") as Promise<{ accountId: string; githubLogin: string; createdAt: string }>;
  }

  async listLinkedRepos(): Promise<{ repos: Array<{ namespaceId: string; namespaceSlug: string; linkedAt: string }> }> {
    return this.request("GET", "/v1/accounts/repos") as Promise<{ repos: Array<{ namespaceId: string; namespaceSlug: string; linkedAt: string }> }>;
  }

  async unlinkRepo(namespaceId: string): Promise<{ ok: true }> {
    return this.request("DELETE", `/v1/accounts/repos/${encodeURIComponent(namespaceId)}`) as Promise<{ ok: true }>;
  }

  async linkRepo(repoFullName: string, githubAccessToken: string): Promise<{ namespaceId: string; namespaceSlug: string; linkedAt: string }> {
    const url = `${this.baseUrl}/v1/accounts/repos`;
    const token = await this.resolveToken();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-GitHub-Access-Token": githubAccessToken,
    };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const resp = await this.fetchImpl(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ repoFullName }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      let code = "UNKNOWN";
      let message = text;
      try {
        const parsed = JSON.parse(text) as ApiError;
        if (parsed.code) code = parsed.code;
        if (parsed.error) message = parsed.error;
      } catch {}
      throw new OrunClientError(resp.status, code, message, text);
    }

    return resp.json() as Promise<{ namespaceId: string; namespaceSlug: string; linkedAt: string }>;
  }

  async listRuns(params?: { limit?: number; offset?: number }): Promise<{ runs: Run[] }> {
    const query: Record<string, string> = {};
    if (params?.limit !== undefined) query.limit = String(params.limit);
    if (params?.offset !== undefined) query.offset = String(params.offset);
    return this.request("GET", "/v1/runs", { query }) as Promise<{ runs: Run[] }>;
  }

  async getRun(runId: string): Promise<{ run: Run | Partial<Run> }> {
    return this.request("GET", `/v1/runs/${encodeURIComponent(runId)}`) as Promise<{ run: Run | Partial<Run> }>;
  }

  async listJobs(runId: string): Promise<{ jobs: Array<Job | Partial<Job>> }> {
    return this.request("GET", `/v1/runs/${encodeURIComponent(runId)}/jobs`) as Promise<{ jobs: Array<Job | Partial<Job>> }>;
  }

  async getJobStatus(runId: string, jobId: string): Promise<Job | Partial<Job>> {
    return this.request("GET", `/v1/runs/${encodeURIComponent(runId)}/jobs/${encodeURIComponent(jobId)}/status`) as Promise<Job | Partial<Job>>;
  }

  async getLog(runId: string, jobId: string): Promise<string> {
    return this.request("GET", `/v1/runs/${encodeURIComponent(runId)}/logs/${encodeURIComponent(jobId)}`, { expectText: true }) as Promise<string>;
  }
}
