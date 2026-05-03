import { useState, useEffect, useCallback } from "react";
import type { Run, Job } from "@orun/types";
import { OrunClientError } from "@orun/client";
import { handleOAuthCallback, loadSession, clearSession, type Session } from "./auth";
import { createClient, getAuthUrl } from "./api";

type View = "runs" | "run-detail";

interface AccountInfo {
  accountId: string;
  githubLogin: string;
  createdAt: string;
}

interface LinkedRepo {
  namespaceId: string;
  namespaceSlug: string;
  linkedAt: string;
}

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fromCallback = handleOAuthCallback();
    if (fromCallback) {
      setSession(fromCallback);
    } else {
      setSession(loadSession());
    }
    setLoading(false);
  }, []);

  if (loading) {
    return <div className="app-loading">Loading...</div>;
  }

  if (!session) {
    return <LoginScreen />;
  }

  return (
    <Dashboard
      session={session}
      onSignOut={() => {
        clearSession();
        setSession(null);
      }}
    />
  );
}

function LoginScreen() {
  return (
    <div className="login-screen">
      <div className="login-card">
        <h1 className="login-title">orun</h1>
        <p className="login-subtitle">Operational Dashboard</p>
        <a href={getAuthUrl()} className="login-btn" aria-label="Sign in with GitHub">
          Sign in with GitHub
        </a>
      </div>
    </div>
  );
}

function Dashboard({ session, onSignOut }: { session: Session; onSignOut: () => void }) {
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [accountMissing, setAccountMissing] = useState(false);
  const [repos, setRepos] = useState<LinkedRepo[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [runsLoading, setRunsLoading] = useState(true);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [view, setView] = useState<View>("runs");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const client = createClient(session.sessionToken);

  const loadData = useCallback(async () => {
    setRunsLoading(true);
    setRunsError(null);
    try {
      const [accountRes, reposRes, runsRes] = await Promise.allSettled([
        client.getAccount(),
        client.listLinkedRepos(),
        client.listRuns(),
      ]);

      if (accountRes.status === "fulfilled") {
        setAccount(accountRes.value);
        setAccountMissing(false);
      } else {
        const err = accountRes.reason;
        if (err instanceof OrunClientError && err.status === 404) {
          setAccountMissing(true);
        }
      }

      if (reposRes.status === "fulfilled") {
        setRepos(reposRes.value.repos);
      }

      if (runsRes.status === "fulfilled") {
        setRuns(runsRes.value.runs);
      } else {
        setRunsError(runsRes.reason instanceof Error ? runsRes.reason.message : "Failed to load runs");
      }
    } finally {
      setRunsLoading(false);
    }
  }, [session.sessionToken]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCreateAccount = async () => {
    try {
      const res = await client.createAccount();
      setAccount(res);
      setAccountMissing(false);
    } catch (err) {
      setRunsError(err instanceof Error ? err.message : "Failed to create account");
    }
  };

  const filteredRuns = runs.filter((r) => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return (
      r.runId.toLowerCase().includes(q) ||
      r.namespace.namespaceSlug.toLowerCase().includes(q) ||
      r.status.toLowerCase().includes(q)
    );
  });

  return (
    <div className="dashboard">
      <header className="toolbar">
        <div className="toolbar-left">
          <span className="brand">orun</span>
          {account && <span className="user-info">{session.githubLogin}</span>}
        </div>
        <div className="toolbar-right">
          <button className="btn btn-sm" onClick={loadData} aria-label="Refresh">
            Refresh
          </button>
          <button className="btn btn-sm btn-ghost" onClick={onSignOut} aria-label="Sign out">
            Sign out
          </button>
        </div>
      </header>

      {accountMissing && (
        <div className="notice">
          <span>No account found.</span>
          <button className="btn btn-sm" onClick={handleCreateAccount}>Create Account</button>
        </div>
      )}

      <main className="main-content">
        {view === "runs" && (
          <RunsView
            runs={filteredRuns}
            repos={repos}
            loading={runsLoading}
            error={runsError}
            filter={filter}
            onFilterChange={setFilter}
            onSelectRun={(runId) => {
              setSelectedRunId(runId);
              setView("run-detail");
            }}
          />
        )}
        {view === "run-detail" && selectedRunId && (
          <RunDetailView
            runId={selectedRunId}
            session={session}
            onBack={() => setView("runs")}
          />
        )}
      </main>
    </div>
  );
}

function RunsView({
  runs, repos, loading, error, filter, onFilterChange, onSelectRun,
}: {
  runs: Run[];
  repos: LinkedRepo[];
  loading: boolean;
  error: string | null;
  filter: string;
  onFilterChange: (v: string) => void;
  onSelectRun: (id: string) => void;
}) {
  return (
    <div className="runs-view">
      <div className="panel-header">
        <h2>Runs</h2>
        <input
          type="text"
          className="filter-input"
          placeholder="Filter by repo, status, or ID..."
          value={filter}
          onChange={(e) => onFilterChange(e.target.value)}
          aria-label="Filter runs"
        />
      </div>

      {repos.length > 0 && (
        <div className="repos-bar">
          {repos.map((r) => (
            <span key={r.namespaceId} className="repo-chip">{r.namespaceSlug}</span>
          ))}
        </div>
      )}

      {loading && <div className="state-msg">Loading runs...</div>}
      {error && <div className="state-msg state-error">{error}</div>}
      {!loading && !error && runs.length === 0 && (
        <div className="state-msg">No runs found.</div>
      )}

      {!loading && runs.length > 0 && (
        <div className="runs-table-wrap">
          <table className="runs-table">
            <thead>
              <tr>
                <th>Run ID</th>
                <th>Repo</th>
                <th>Status</th>
                <th>Trigger</th>
                <th>Actor</th>
                <th>Jobs</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.runId} onClick={() => onSelectRun(r.runId)} className="run-row">
                  <td className="cell-id">{r.runId.slice(0, 8)}</td>
                  <td className="cell-repo">{r.namespace.namespaceSlug}</td>
                  <td>
                    <span className={`status-chip status-${r.status}`}>{r.status}</span>
                    {r.dryRun && <span className="dry-run-badge">dry</span>}
                  </td>
                  <td>{r.triggerType}</td>
                  <td>{r.actor ?? "—"}</td>
                  <td>{r.jobDone}/{r.jobTotal}{r.jobFailed > 0 && <span className="failed-count"> ({r.jobFailed}F)</span>}</td>
                  <td className="cell-time">{formatTime(r.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RunDetailView({ runId, session, onBack }: { runId: string; session: Session; onBack: () => void }) {
  const [run, setRun] = useState<Partial<Run> | null>(null);
  const [jobs, setJobs] = useState<Array<Partial<Job>>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedJob, setSelectedJob] = useState<string | null>(null);
  const [logContent, setLogContent] = useState<string | null>(null);
  const [logLoading, setLogLoading] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);

  const client = createClient(session.sessionToken);

  const loadDetail = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [runRes, jobsRes] = await Promise.allSettled([
        client.getRun(runId),
        client.listJobs(runId),
      ]);
      if (runRes.status === "fulfilled") setRun(runRes.value.run);
      else setError(runRes.reason instanceof Error ? runRes.reason.message : "Failed to load run");
      if (jobsRes.status === "fulfilled") setJobs(jobsRes.value.jobs);
    } finally {
      setLoading(false);
    }
  }, [runId, session.sessionToken]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  const loadLog = async (jobId: string) => {
    setSelectedJob(jobId);
    setLogContent(null);
    setLogError(null);
    setLogLoading(true);
    try {
      const text = await client.getLog(runId, jobId);
      setLogContent(text);
    } catch (err) {
      if (err instanceof OrunClientError && err.status === 404) {
        setLogError("No logs available for this job.");
      } else {
        setLogError(err instanceof Error ? err.message : "Failed to load log");
      }
    } finally {
      setLogLoading(false);
    }
  };

  const groupedJobs = groupByComponent(jobs);

  return (
    <div className="run-detail">
      <div className="panel-header">
        <button className="btn btn-sm" onClick={onBack} aria-label="Back to runs">&larr; Runs</button>
        <h2>Run {runId.slice(0, 8)}</h2>
        <button className="btn btn-sm" onClick={loadDetail} aria-label="Refresh run">Refresh</button>
      </div>

      {loading && <div className="state-msg">Loading run details...</div>}
      {error && <div className="state-msg state-error">{error}</div>}

      {run && (
        <div className="run-meta">
          <span className={`status-chip status-${run.status}`}>{run.status}</span>
          {run.dryRun && <span className="dry-run-badge">dry-run</span>}
          <span>{run.namespace?.namespaceSlug}</span>
          <span>{run.triggerType}</span>
          <span>{run.actor ?? "—"}</span>
          <span>{run.jobDone ?? 0}/{run.jobTotal ?? 0} jobs done</span>
          {run.createdAt && <span className="cell-time">{formatTime(run.createdAt)}</span>}
        </div>
      )}

      <div className="detail-panels">
        <div className="jobs-panel">
          <h3>Jobs</h3>
          {jobs.length === 0 && !loading && <div className="state-msg">No jobs.</div>}
          {Object.entries(groupedJobs).map(([component, componentJobs]) => (
            <div key={component} className="job-group">
              <div className="job-group-header">{component}</div>
              {componentJobs.map((j) => (
                <button
                  key={j.jobId}
                  className={`job-item ${selectedJob === j.jobId ? "job-selected" : ""}`}
                  onClick={() => j.jobId && loadLog(j.jobId)}
                  aria-label={`View logs for job ${j.jobId}`}
                >
                  <span className={`status-dot status-${j.status}`} />
                  <span className="job-id">{j.jobId}</span>
                  <span className="job-status">{j.status}</span>
                  {j.runnerId && <span className="job-runner">{j.runnerId.slice(0, 6)}</span>}
                  {j.lastError && <span className="job-error" title={j.lastError}>err</span>}
                </button>
              ))}
            </div>
          ))}
        </div>

        <div className="log-panel">
          <h3>Log {selectedJob ? `— ${selectedJob}` : ""}</h3>
          {!selectedJob && <div className="state-msg">Select a job to view logs.</div>}
          {logLoading && <div className="state-msg">Loading log...</div>}
          {logError && <div className="state-msg state-error">{logError}</div>}
          {logContent !== null && (
            <pre className="log-content">{logContent || "(empty log)"}</pre>
          )}
        </div>
      </div>
    </div>
  );
}

function groupByComponent(jobs: Array<Partial<Job>>): Record<string, Array<Partial<Job>>> {
  const groups: Record<string, Array<Partial<Job>>> = {};
  for (const j of jobs) {
    const key = j.component ?? "unknown";
    if (!groups[key]) groups[key] = [];
    groups[key].push(j);
  }
  return groups;
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
