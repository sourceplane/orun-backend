import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { App } from "./App";

// ─── Mock auth module ─────────────────────────────────────────────────────────

vi.mock("./auth", () => ({
  handleOAuthCallback: vi.fn().mockReturnValue(null),
  loadSession: vi.fn().mockReturnValue(null),
  clearSession: vi.fn(),
  parseOAuthFragment: vi.fn().mockReturnValue(null),
  storeSession: vi.fn(),
}));

// ─── Mock api module ──────────────────────────────────────────────────────────

vi.mock("./api", () => ({
  createClient: vi.fn(),
  getAuthUrl: vi.fn().mockReturnValue("http://api.test/v1/auth/github?returnTo=http%3A%2F%2Flocalhost%2F"),
  API_BASE: "http://api.test",
}));

// ─── Shared mock client factory ────────────────────────────────────────────────

function buildMockClient(overrides: Record<string, unknown> = {}) {
  return {
    getAccount: vi.fn().mockResolvedValue({ accountId: "acct-1", githubLogin: "octocat", createdAt: "2026-01-01" }),
    listLinkedRepos: vi.fn().mockResolvedValue({ repos: [] }),
    listCatalogComponents: vi.fn().mockResolvedValue({ components: [], total: 0 }),
    getCatalogComponent: vi.fn().mockReturnValue(new Promise(() => {})),
    getCatalogComponentDependencies: vi.fn().mockResolvedValue({ outgoing: [], incoming: [] }),
    getCatalogComponentRuns: vi.fn().mockResolvedValue({ runs: [] }),
    getCatalogComponentHistory: vi.fn().mockResolvedValue({ events: [] }),
    listRuns: vi.fn().mockResolvedValue({ runs: [] }),
    getRun: vi.fn().mockReturnValue(new Promise(() => {})),
    listJobs: vi.fn().mockReturnValue(new Promise(() => {})),
    ...overrides,
  };
}

const mockSession = {
  sessionToken: "tok-abc",
  githubLogin: "octocat",
  allowedNamespaceIds: ["ns-1"],
};

describe("App — unauthenticated", () => {
  it("shows login screen when no session", async () => {
    const { loadSession, handleOAuthCallback } = await import("./auth");
    vi.mocked(loadSession).mockReturnValue(null);
    vi.mocked(handleOAuthCallback).mockReturnValue(null);

    render(<App />);
    await waitFor(() => expect(screen.getByLabelText(/Sign in with GitHub/i)).toBeInTheDocument());
  });

  it("login link uses returnTo URL", async () => {
    const { loadSession, handleOAuthCallback } = await import("./auth");
    vi.mocked(loadSession).mockReturnValue(null);
    vi.mocked(handleOAuthCallback).mockReturnValue(null);

    render(<App />);
    await waitFor(() => {
      const link = screen.getByLabelText(/Sign in with GitHub/i);
      expect(link).toHaveAttribute("href");
      const href = link.getAttribute("href") ?? "";
      expect(href).toContain("returnTo=");
    });
  });
});

describe("App — authenticated shell", () => {
  beforeEach(async () => {
    const { loadSession, handleOAuthCallback } = await import("./auth");
    const { createClient } = await import("./api");
    vi.mocked(handleOAuthCallback).mockReturnValue(null);
    vi.mocked(loadSession).mockReturnValue(mockSession);
    vi.mocked(createClient).mockReturnValue(buildMockClient() as never);
    window.location.hash = "#/catalog";
  });

  afterEach(() => {
    window.location.hash = "";
  });

  it("defaults to Catalog view when authenticated", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Catalog" })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Catalog" })).toHaveAttribute("aria-current", "page");
  });

  it("shows nav items for all sections", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Catalog" })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Runs" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Repositories" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
  });

  it("shows github login in topbar", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByText("octocat")).toBeInTheDocument());
  });

  it("navigates to Runs view when Runs nav item clicked", async () => {
    const { createClient } = await import("./api");
    const client = buildMockClient({ listRuns: vi.fn().mockResolvedValue({ runs: [] }) });
    vi.mocked(createClient).mockReturnValue(client as never);

    render(<App />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Runs" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Runs" }));
    await waitFor(() => expect(screen.getByText(/No runs found/i)).toBeInTheDocument());
  });

  it("navigates to Repositories when nav item clicked", async () => {
    const { createClient } = await import("./api");
    const client = buildMockClient({ listLinkedRepos: vi.fn().mockResolvedValue({ repos: [] }) });
    vi.mocked(createClient).mockReturnValue(client as never);

    render(<App />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Repositories" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Repositories" }));
    await waitFor(() => expect(screen.getByText(/No linked repositories/i)).toBeInTheDocument());
  });

  it("navigates to Settings when nav item clicked", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    await waitFor(() => expect(screen.getByText(/GitHub login/i)).toBeInTheDocument());
    expect(screen.getAllByText("octocat").length).toBeGreaterThanOrEqual(1);
  });

  it("calls clearSession and shows login screen on sign out", async () => {
    const { clearSession } = await import("./auth");

    render(<App />);
    await waitFor(() => expect(screen.getByLabelText(/Sign out/i)).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText(/Sign out/i));
    await waitFor(() => expect(screen.getByLabelText(/Sign in with GitHub/i)).toBeInTheDocument());
    expect(vi.mocked(clearSession)).toHaveBeenCalled();
  });
});

describe("App — OAuth callback", () => {
  it("parses OAuth callback and stores session", async () => {
    const { handleOAuthCallback, loadSession } = await import("./auth");
    const { createClient } = await import("./api");
    vi.mocked(handleOAuthCallback).mockReturnValue(mockSession);
    vi.mocked(loadSession).mockReturnValue(null);
    vi.mocked(createClient).mockReturnValue(buildMockClient() as never);

    render(<App />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Catalog" })).toBeInTheDocument());
    expect(vi.mocked(handleOAuthCallback)).toHaveBeenCalled();
  });
});

describe("App — Catalog defaults to catalog view", () => {
  it("shows catalog search input in default view", async () => {
    const { loadSession, handleOAuthCallback } = await import("./auth");
    const { createClient } = await import("./api");
    vi.mocked(handleOAuthCallback).mockReturnValue(null);
    vi.mocked(loadSession).mockReturnValue(mockSession);
    vi.mocked(createClient).mockReturnValue(buildMockClient() as never);
    window.location.hash = "#/catalog";

    render(<App />);
    await waitFor(() => expect(screen.getByLabelText(/Search catalog/i)).toBeInTheDocument());
  });
});
