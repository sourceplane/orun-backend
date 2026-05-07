import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { CatalogComponentSummary, CatalogComponentDetail, Run } from "@orun/types";
import { CatalogView } from "./CatalogView";
import { ComponentDetail } from "./ComponentDetail";

const makeSummary = (overrides: Partial<CatalogComponentSummary> = {}): CatalogComponentSummary => ({
  componentId: "github:12345:api-worker",
  namespace: { namespaceId: "ns-1", namespaceSlug: "acme/api" },
  repoId: "12345",
  repoFullName: "acme/api",
  name: "api-worker",
  title: "API Worker",
  description: "Main API worker",
  type: "cloudflare-worker",
  owner: "team-platform",
  system: "saas",
  lifecycle: "production",
  repoPath: "apps/api-worker",
  tags: ["edge", "api"],
  environments: [{ name: "production", status: "healthy" }],
  latestPlanChecksum: "abc12345",
  latestCommitSha: "deadbeef0000",
  latestStatus: "healthy",
  currentStateRef: "ns-1/catalog/commits/deadbeef/components/api-worker.json",
  firstSeenAt: "2026-01-01T00:00:00Z",
  lastSeenAt: "2026-05-07T10:00:00Z",
  ...overrides,
});

const makeDetail = (overrides: Partial<CatalogComponentDetail> = {}): CatalogComponentDetail => ({
  ...makeSummary(),
  relations: [],
  ...overrides,
});

const makeRun = (overrides: Partial<Run> = {}): Run => ({
  runId: "run-abcdef12",
  namespace: { namespaceId: "ns1", namespaceSlug: "acme/api" },
  status: "completed",
  planChecksum: "abc",
  triggerType: "ci",
  actor: "octocat",
  createdAt: "2026-05-07T10:00:00Z",
  updatedAt: "2026-05-07T10:01:00Z",
  finishedAt: "2026-05-07T10:01:00Z",
  jobTotal: 1,
  jobDone: 1,
  jobFailed: 0,
  dryRun: false,
  expiresAt: "2026-05-14T10:00:00Z",
  ...overrides,
});

function makeClient(overrides: Record<string, unknown> = {}) {
  return {
    listCatalogComponents: vi.fn().mockResolvedValue({ components: [], total: 0 }),
    getCatalogComponent: vi.fn().mockResolvedValue({ component: makeDetail() }),
    getCatalogComponentDependencies: vi.fn().mockResolvedValue({ outgoing: [], incoming: [] }),
    getCatalogComponentRuns: vi.fn().mockResolvedValue({ runs: [] }),
    getCatalogComponentHistory: vi.fn().mockResolvedValue({ events: [] }),
    ...overrides,
  };
}

const noRepos: never[] = [];
const oneRepo = [{ namespaceId: "ns1", namespaceSlug: "acme/api", linkedAt: "2026-01-01T00:00:00Z" }];

describe("CatalogView", () => {
  it("shows loading state initially", () => {
    const client = makeClient({ listCatalogComponents: vi.fn().mockReturnValue(new Promise(() => {})) });
    render(<CatalogView client={client as never} repos={noRepos} onSelectComponent={() => {}} />);
    expect(screen.getByText(/Loading catalog/i)).toBeInTheDocument();
  });

  it("shows no linked repos empty state", async () => {
    const client = makeClient({ listCatalogComponents: vi.fn().mockResolvedValue({ components: [], total: 0 }) });
    render(<CatalogView client={client as never} repos={noRepos} onSelectComponent={() => {}} />);
    await waitFor(() => expect(screen.getByText(/No linked repositories/i)).toBeInTheDocument());
  });

  it("shows no synced components state when repos exist but catalog empty", async () => {
    const client = makeClient({ listCatalogComponents: vi.fn().mockResolvedValue({ components: [], total: 0 }) });
    render(<CatalogView client={client as never} repos={oneRepo} onSelectComponent={() => {}} />);
    await waitFor(() => expect(screen.getByText(/No components synced yet/i)).toBeInTheDocument());
  });

  it("shows error state with retry button", async () => {
    const client = makeClient({ listCatalogComponents: vi.fn().mockRejectedValue(new Error("Failed to fetch")) });
    render(<CatalogView client={client as never} repos={oneRepo} onSelectComponent={() => {}} />);
    await waitFor(() => expect(screen.getByText(/Failed to fetch/i)).toBeInTheDocument());
    expect(screen.getByText("Retry")).toBeInTheDocument();
  });

  it("renders components in table by default", async () => {
    const comp = makeSummary();
    const client = makeClient({ listCatalogComponents: vi.fn().mockResolvedValue({ components: [comp], total: 1 }) });
    render(<CatalogView client={client as never} repos={oneRepo} onSelectComponent={() => {}} />);
    await waitFor(() => expect(screen.getByText("api-worker")).toBeInTheDocument());
    // type-chip renders in table - check the table body for it
    const table = screen.getByRole("table");
    expect(within(table).getAllByText("cloudflare-worker").length).toBeGreaterThanOrEqual(1);
    expect(within(table).getByText("team-platform")).toBeInTheDocument();
    expect(within(table).getByText("healthy")).toBeInTheDocument();
  });

  it("toggles to card view", async () => {
    const comp = makeSummary();
    const client = makeClient({ listCatalogComponents: vi.fn().mockResolvedValue({ components: [comp], total: 1 }) });
    render(<CatalogView client={client as never} repos={oneRepo} onSelectComponent={() => {}} />);
    await waitFor(() => expect(screen.getByText("api-worker")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Cards/i }));
    expect(screen.getByRole("list")).toBeInTheDocument();
    expect(screen.getByLabelText(/View component api-worker/i)).toBeInTheDocument();
  });

  it("table view is the default", async () => {
    const comp = makeSummary();
    const client = makeClient({ listCatalogComponents: vi.fn().mockResolvedValue({ components: [comp], total: 1 }) });
    render(<CatalogView client={client as never} repos={oneRepo} onSelectComponent={() => {}} />);
    await waitFor(() => expect(screen.getByText("api-worker")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Table/i })).toHaveAttribute("aria-pressed", "true");
  });

  it("calls listCatalogComponents with filter params when filters change", async () => {
    const listFn = vi.fn().mockResolvedValue({ components: [], total: 0 });
    const client = makeClient({ listCatalogComponents: listFn });
    render(<CatalogView client={client as never} repos={oneRepo} onSelectComponent={() => {}} />);
    await waitFor(() => expect(listFn).toHaveBeenCalledTimes(1));

    const searchInput = screen.getByLabelText(/Search catalog/i);
    fireEvent.change(searchInput, { target: { value: "worker" } });
    await waitFor(() => {
      const calls = listFn.mock.calls;
      const lastCall = calls[calls.length - 1][0];
      expect(lastCall?.q).toBe("worker");
    });
  });

  it("calls onSelectComponent when a row is clicked", async () => {
    const comp = makeSummary();
    const onSelect = vi.fn();
    const client = makeClient({ listCatalogComponents: vi.fn().mockResolvedValue({ components: [comp], total: 1 }) });
    render(<CatalogView client={client as never} repos={oneRepo} onSelectComponent={onSelect} />);
    await waitFor(() => expect(screen.getByText("api-worker")).toBeInTheDocument());
    fireEvent.click(screen.getByText("api-worker").closest("tr")!);
    expect(onSelect).toHaveBeenCalledWith("github:12345:api-worker");
  });

  it("shows no-matches empty state when filters active and no results", async () => {
    const client = makeClient({ listCatalogComponents: vi.fn().mockResolvedValue({ components: [], total: 0 }) });
    render(<CatalogView client={client as never} repos={oneRepo} onSelectComponent={() => {}} />);

    // Set a filter so we get the "no matches" state
    const searchInput = screen.getByLabelText(/Search catalog/i);
    fireEvent.change(searchInput, { target: { value: "notfound" } });
    await waitFor(() => expect(screen.getByText(/No matches/i)).toBeInTheDocument());
  });
});

describe("ComponentDetail", () => {
  it("renders loading state initially", () => {
    const client = makeClient({ getCatalogComponent: vi.fn().mockReturnValue(new Promise(() => {})) });
    render(<ComponentDetail componentId="comp-1" client={client as never} onBack={() => {}} onSelectRun={() => {}} />);
    expect(screen.getByText(/Loading component/i)).toBeInTheDocument();
  });

  it("renders overview fields", async () => {
    const detail = makeDetail();
    const client = makeClient({ getCatalogComponent: vi.fn().mockResolvedValue({ component: detail }) });
    render(<ComponentDetail componentId="comp-1" client={client as never} onBack={() => {}} onSelectRun={() => {}} />);
    await waitFor(() => expect(screen.getAllByText("api-worker").length).toBeGreaterThan(0));
    expect(screen.getByText("team-platform")).toBeInTheDocument();
    expect(screen.getByText(/deadbeef0000/)).toBeInTheDocument();
    expect(screen.getAllByText(/acme\/api/).length).toBeGreaterThan(0);
  });

  it("shows error state when component not found", async () => {
    const { OrunClientError } = await import("@orun/client");
    const client = makeClient({
      getCatalogComponent: vi.fn().mockRejectedValue(new OrunClientError(404, "NOT_FOUND", "not found", "")),
    });
    render(<ComponentDetail componentId="missing" client={client as never} onBack={() => {}} onSelectRun={() => {}} />);
    await waitFor(() => expect(screen.getByText(/not found/i)).toBeInTheDocument());
  });

  it("renders dependencies tab with outgoing and incoming sections", async () => {
    const detail = makeDetail();
    const client = makeClient({
      getCatalogComponent: vi.fn().mockResolvedValue({ component: detail }),
      getCatalogComponentDependencies: vi.fn().mockResolvedValue({
        outgoing: [{ relationType: "depends_on", targetKind: "component", targetRef: "component:auth-worker" }],
        incoming: [],
      }),
    });
    render(<ComponentDetail componentId="comp-1" client={client as never} onBack={() => {}} onSelectRun={() => {}} />);
    await waitFor(() => expect(screen.getByRole("tab", { name: /Dependencies/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("tab", { name: /Dependencies/i }));
    await waitFor(() => expect(screen.getByText(/component:auth-worker/i)).toBeInTheDocument());
    expect(screen.getAllByText(/Incoming/i).length).toBeGreaterThan(0);
  });

  it("renders recent runs in runs tab", async () => {
    const run = makeRun();
    const client = makeClient({
      getCatalogComponent: vi.fn().mockResolvedValue({ component: makeDetail() }),
      getCatalogComponentRuns: vi.fn().mockResolvedValue({ runs: [run] }),
    });
    render(<ComponentDetail componentId="comp-1" client={client as never} onBack={() => {}} onSelectRun={() => {}} />);
    await waitFor(() => expect(screen.getByRole("tab", { name: /Runs/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("tab", { name: /Runs/i }));
    // run-abcdef12.slice(0,8) = "run-abcd"
    await waitFor(() => expect(screen.getByText("run-abcd")).toBeInTheDocument());
  });

  it("calls onSelectRun when a run row is clicked from component detail", async () => {
    const run = makeRun();
    const onSelectRun = vi.fn();
    const client = makeClient({
      getCatalogComponent: vi.fn().mockResolvedValue({ component: makeDetail() }),
      getCatalogComponentRuns: vi.fn().mockResolvedValue({ runs: [run] }),
    });
    render(<ComponentDetail componentId="comp-1" client={client as never} onBack={() => {}} onSelectRun={onSelectRun} />);
    await waitFor(() => expect(screen.getByRole("tab", { name: /Runs/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("tab", { name: /Runs/i }));
    // run-abcdef12.slice(0,8) = "run-abcd"
    await waitFor(() => expect(screen.getByText("run-abcd")).toBeInTheDocument());
    fireEvent.click(screen.getByText("run-abcd").closest("tr")!);
    expect(onSelectRun).toHaveBeenCalledWith("run-abcdef12");
  });

  it("calls onBack when back button clicked", async () => {
    const onBack = vi.fn();
    const client = makeClient({
      getCatalogComponent: vi.fn().mockResolvedValue({ component: makeDetail() }),
    });
    render(<ComponentDetail componentId="comp-1" client={client as never} onBack={onBack} onSelectRun={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText(/Back to catalog/i)).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText(/Back to catalog/i));
    expect(onBack).toHaveBeenCalled();
  });
});
