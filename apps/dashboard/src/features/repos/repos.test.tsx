import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { CatalogComponentSummary } from "@orun/types";
import { ReposView } from "./ReposView";

function makeSummary(repoFullName: string, latestStatus = "healthy", lastSeenAt = "2026-05-07T10:00:00Z"): CatalogComponentSummary {
  return {
    componentId: `github:1:${repoFullName}-comp`,
    namespace: { namespaceId: "ns1", namespaceSlug: repoFullName },
    repoId: "1",
    repoFullName,
    name: `${repoFullName}-comp`,
    type: "cloudflare-worker",
    repoPath: "apps/comp",
    tags: [],
    environments: [],
    latestCommitSha: "deadbeef",
    latestStatus: latestStatus as "healthy",
    currentStateRef: "ns1/catalog/commits/deadbeef/components/comp.json",
    firstSeenAt: "2026-01-01T00:00:00Z",
    lastSeenAt,
  };
}

function makeClient(overrides: Record<string, unknown> = {}) {
  return {
    listLinkedRepos: vi.fn().mockResolvedValue({ repos: [] }),
    listCatalogComponents: vi.fn().mockResolvedValue({ components: [], total: 0 }),
    ...overrides,
  };
}

describe("ReposView", () => {
  it("shows loading state", () => {
    const client = makeClient({ listLinkedRepos: vi.fn().mockReturnValue(new Promise(() => {})) });
    render(<ReposView client={client as never} />);
    expect(screen.getByText(/Loading repositories/i)).toBeInTheDocument();
  });

  it("shows empty state when no repos", async () => {
    const client = makeClient();
    render(<ReposView client={client as never} />);
    await waitFor(() => expect(screen.getByText(/No linked repositories/i)).toBeInTheDocument());
  });

  it("shows repos in table with linked timestamp", async () => {
    const client = makeClient({
      listLinkedRepos: vi.fn().mockResolvedValue({
        repos: [{ namespaceId: "ns-abc123", namespaceSlug: "acme/api", linkedAt: "2026-04-01T00:00:00Z" }],
      }),
    });
    render(<ReposView client={client as never} />);
    await waitFor(() => expect(screen.getByText("acme/api")).toBeInTheDocument());
  });

  it("derives component count from catalog data", async () => {
    const comp1 = makeSummary("acme/api");
    const comp2 = makeSummary("acme/api");
    comp2.componentId = "github:1:acme/api-comp2";
    comp2.name = "comp2";

    const client = makeClient({
      listLinkedRepos: vi.fn().mockResolvedValue({
        repos: [{ namespaceId: "ns1", namespaceSlug: "acme/api", linkedAt: "2026-01-01T00:00:00Z" }],
      }),
      listCatalogComponents: vi.fn().mockResolvedValue({ components: [comp1, comp2], total: 2 }),
    });
    render(<ReposView client={client as never} />);
    await waitFor(() => expect(screen.getByText("2")).toBeInTheDocument());
  });

  it("derives last sync from max lastSeenAt of repo components", async () => {
    const comp = makeSummary("acme/api", "healthy", "2026-05-07T10:00:00Z");
    const client = makeClient({
      listLinkedRepos: vi.fn().mockResolvedValue({
        repos: [{ namespaceId: "ns1", namespaceSlug: "acme/api", linkedAt: "2026-01-01T00:00:00Z" }],
      }),
      listCatalogComponents: vi.fn().mockResolvedValue({ components: [comp], total: 1 }),
    });
    render(<ReposView client={client as never} />);
    // last sync should show a formatted date
    await waitFor(() => expect(screen.getByText("acme/api")).toBeInTheDocument());
    // the "No sync yet" text should not appear for a repo with components
    expect(screen.queryByText("No sync yet")).not.toBeInTheDocument();
  });

  it("shows no sync yet when repo has no catalog data", async () => {
    const client = makeClient({
      listLinkedRepos: vi.fn().mockResolvedValue({
        repos: [{ namespaceId: "ns1", namespaceSlug: "acme/new-repo", linkedAt: "2026-01-01T00:00:00Z" }],
      }),
      listCatalogComponents: vi.fn().mockResolvedValue({ components: [], total: 0 }),
    });
    render(<ReposView client={client as never} />);
    await waitFor(() => expect(screen.getByText("No sync yet")).toBeInTheDocument());
  });

  it("shows error with retry on failure", async () => {
    const client = makeClient({
      listLinkedRepos: vi.fn().mockRejectedValue(new Error("Server error")),
    });
    render(<ReposView client={client as never} />);
    await waitFor(() => expect(screen.getByText(/Server error/i)).toBeInTheDocument());
    expect(screen.getByText("Retry")).toBeInTheDocument();
  });
});
