import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { Run, Job } from "@orun/types";
import { RunsView } from "./RunsView";
import { RunDetailView } from "./RunDetailView";

const makeRun = (overrides: Partial<Run> = {}): Run => ({
  runId: "run-aabbccdd-1234",
  namespace: { namespaceId: "ns1", namespaceSlug: "acme/api" },
  status: "completed",
  planChecksum: "abc123",
  triggerType: "ci",
  actor: "octocat",
  createdAt: "2026-05-07T10:00:00Z",
  updatedAt: "2026-05-07T10:01:00Z",
  finishedAt: "2026-05-07T10:01:00Z",
  jobTotal: 2,
  jobDone: 2,
  jobFailed: 0,
  dryRun: false,
  expiresAt: "2026-05-14T10:00:00Z",
  ...overrides,
});

const makeJob = (overrides: Partial<Job> = {}): Job => ({
  jobId: "job-001",
  runId: "run-aabbccdd-1234",
  component: "api-worker",
  status: "success",
  deps: [],
  runnerId: "runner-xyz",
  startedAt: "2026-05-07T10:00:10Z",
  finishedAt: "2026-05-07T10:01:00Z",
  lastError: null,
  heartbeatAt: null,
  logRef: "logs/run-1/job-001",
  ...overrides,
});

function makeClient(overrides: Partial<ReturnType<typeof buildMockClient>> = {}) {
  return { ...buildMockClient(), ...overrides };
}

function buildMockClient() {
  return {
    listRuns: vi.fn().mockResolvedValue({ runs: [] }),
    getRun: vi.fn().mockResolvedValue({ run: makeRun() }),
    listJobs: vi.fn().mockResolvedValue({ jobs: [] }),
    getLog: vi.fn().mockResolvedValue("log line 1\nlog line 2"),
  };
}

describe("RunsView", () => {
  it("shows loading state initially", () => {
    const client = makeClient({ listRuns: vi.fn().mockReturnValue(new Promise(() => {})) });
    render(<RunsView client={client as never} repos={[]} onSelectRun={() => {}} />);
    expect(screen.getByText(/Loading runs/i)).toBeInTheDocument();
  });

  it("shows empty state when no runs", async () => {
    const client = makeClient({ listRuns: vi.fn().mockResolvedValue({ runs: [] }) });
    render(<RunsView client={client as never} repos={[]} onSelectRun={() => {}} />);
    await waitFor(() => expect(screen.getByText(/No runs found/i)).toBeInTheDocument());
  });

  it("renders runs in table", async () => {
    const run = makeRun();
    const client = makeClient({ listRuns: vi.fn().mockResolvedValue({ runs: [run] }) });
    render(<RunsView client={client as never} repos={[]} onSelectRun={() => {}} />);
    await waitFor(() => expect(screen.getByText("acme/api")).toBeInTheDocument());
    expect(screen.getByText("run-aabb")).toBeInTheDocument();
    expect(screen.getByText("completed")).toBeInTheDocument();
  });

  it("filters runs by text", async () => {
    const runs = [
      makeRun({ runId: "run-aaaaaa", namespace: { namespaceId: "ns1", namespaceSlug: "acme/api" } }),
      makeRun({ runId: "run-bbbbbb", namespace: { namespaceId: "ns2", namespaceSlug: "acme/worker" } }),
    ];
    const client = makeClient({ listRuns: vi.fn().mockResolvedValue({ runs }) });
    render(<RunsView client={client as never} repos={[]} onSelectRun={() => {}} />);
    await waitFor(() => expect(screen.getByText("acme/api")).toBeInTheDocument());

    const input = screen.getByLabelText(/Filter runs/i);
    fireEvent.change(input, { target: { value: "worker" } });

    expect(screen.getByText("acme/worker")).toBeInTheDocument();
    expect(screen.queryByText("acme/api")).not.toBeInTheDocument();
  });

  it("shows repo chips when repos provided", async () => {
    const client = makeClient({ listRuns: vi.fn().mockResolvedValue({ runs: [] }) });
    const repos = [{ namespaceId: "ns1", namespaceSlug: "acme/api", linkedAt: "2026-01-01T00:00:00Z" }];
    render(<RunsView client={client as never} repos={repos} onSelectRun={() => {}} />);
    await waitFor(() => expect(screen.getByText("acme/api")).toBeInTheDocument());
  });

  it("calls onSelectRun when a run row is clicked", async () => {
    const run = makeRun();
    const onSelect = vi.fn();
    const client = makeClient({ listRuns: vi.fn().mockResolvedValue({ runs: [run] }) });
    render(<RunsView client={client as never} repos={[]} onSelectRun={onSelect} />);
    await waitFor(() => expect(screen.getByText("acme/api")).toBeInTheDocument());
    fireEvent.click(screen.getByText("run-aabb").closest("tr")!);
    expect(onSelect).toHaveBeenCalledWith("run-aabbccdd-1234");
  });

  it("shows error state with retry button on load failure", async () => {
    const client = makeClient({ listRuns: vi.fn().mockRejectedValue(new Error("Network error")) });
    render(<RunsView client={client as never} repos={[]} onSelectRun={() => {}} />);
    await waitFor(() => expect(screen.getByText(/Network error/i)).toBeInTheDocument());
    expect(screen.getByText("Retry")).toBeInTheDocument();
  });
});

describe("RunDetailView", () => {
  it("shows loading state initially", () => {
    const client = makeClient({
      getRun: vi.fn().mockReturnValue(new Promise(() => {})),
      listJobs: vi.fn().mockReturnValue(new Promise(() => {})),
    });
    render(<RunDetailView runId="run-001" client={client as never} onBack={() => {}} />);
    expect(screen.getByText(/Loading run details/i)).toBeInTheDocument();
  });

  it("renders run metadata after load", async () => {
    const run = makeRun({ status: "completed", actor: "octocat" });
    const client = makeClient({
      getRun: vi.fn().mockResolvedValue({ run }),
      listJobs: vi.fn().mockResolvedValue({ jobs: [] }),
    });
    render(<RunDetailView runId="run-aabbccdd-1234" client={client as never} onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText("completed")).toBeInTheDocument());
    expect(screen.getByText("octocat")).toBeInTheDocument();
  });

  it("groups jobs by component", async () => {
    const jobs = [
      makeJob({ jobId: "job-001", component: "api-worker", status: "success" }),
      makeJob({ jobId: "job-002", component: "frontend", status: "failed" }),
    ];
    const client = makeClient({
      getRun: vi.fn().mockResolvedValue({ run: makeRun() }),
      listJobs: vi.fn().mockResolvedValue({ jobs }),
    });
    render(<RunDetailView runId="run-001" client={client as never} onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText("api-worker")).toBeInTheDocument());
    expect(screen.getByText("frontend")).toBeInTheDocument();
  });

  it("loads and displays log when a job is clicked", async () => {
    const jobs = [makeJob({ jobId: "job-001", component: "api-worker" })];
    const client = makeClient({
      getRun: vi.fn().mockResolvedValue({ run: makeRun() }),
      listJobs: vi.fn().mockResolvedValue({ jobs }),
      getLog: vi.fn().mockResolvedValue("log line 1"),
    });
    render(<RunDetailView runId="run-001" client={client as never} onBack={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText(/View logs for job job-001/i)).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText(/View logs for job job-001/i));
    await waitFor(() => expect(screen.getByText("log line 1")).toBeInTheDocument());
  });

  it("handles 404 log gracefully", async () => {
    const { OrunClientError } = await import("@orun/client");
    const jobs = [makeJob({ jobId: "job-001", component: "api-worker" })];
    const client = makeClient({
      getRun: vi.fn().mockResolvedValue({ run: makeRun() }),
      listJobs: vi.fn().mockResolvedValue({ jobs }),
      getLog: vi.fn().mockRejectedValue(new OrunClientError(404, "NOT_FOUND", "not found", "")),
    });
    render(<RunDetailView runId="run-001" client={client as never} onBack={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText(/View logs for job job-001/i)).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText(/View logs for job job-001/i));
    await waitFor(() => expect(screen.getByText(/No logs available/i)).toBeInTheDocument());
  });

  it("calls onBack when back button is clicked", async () => {
    const onBack = vi.fn();
    const client = makeClient({
      getRun: vi.fn().mockResolvedValue({ run: makeRun() }),
      listJobs: vi.fn().mockResolvedValue({ jobs: [] }),
    });
    render(<RunDetailView runId="run-001" client={client as never} onBack={onBack} />);
    fireEvent.click(screen.getByLabelText(/Back to runs/i));
    expect(onBack).toHaveBeenCalled();
  });
});
