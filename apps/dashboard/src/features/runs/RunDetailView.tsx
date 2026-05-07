import { useState, useEffect, useCallback } from "react";
import type { Job, Run } from "@orun/types";
import type { OrunClient } from "@orun/client";
import { OrunClientError } from "@orun/client";

interface Props {
  runId: string;
  client: OrunClient;
  onBack: () => void;
}

export function RunDetailView({ runId, client, onBack }: Props) {
  const [run, setRun] = useState<Partial<Run> | null>(null);
  const [jobs, setJobs] = useState<Array<Partial<Job>>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedJob, setSelectedJob] = useState<string | null>(null);
  const [logContent, setLogContent] = useState<string | null>(null);
  const [logLoading, setLogLoading] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);

  const load = useCallback(async () => {
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
  }, [runId, client]);

  useEffect(() => { load(); }, [load]);

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

  const grouped = groupByComponent(jobs);

  return (
    <div className="run-detail">
      <div className="panel-header">
        <button className="btn btn-sm" onClick={onBack} aria-label="Back to runs">← Runs</button>
        <h2>Run {runId.slice(0, 8)}</h2>
        <button className="btn btn-sm" onClick={load} aria-label="Refresh run">Refresh</button>
      </div>

      {loading && <div className="state-msg">Loading run details…</div>}
      {!loading && error && <div className="state-msg state-error">{error}</div>}

      {run && (
        <div className="run-meta">
          <span className={`status-chip status-${run.status}`}>{run.status}</span>
          {run.dryRun && <span className="badge-dry">dry-run</span>}
          <span>{run.namespace?.namespaceSlug}</span>
          <span>{run.triggerType}</span>
          <span>{run.actor ?? "—"}</span>
          <span>{run.jobDone ?? 0}/{run.jobTotal ?? 0} jobs</span>
          {run.createdAt && <span className="cell-dim">{formatTime(run.createdAt)}</span>}
        </div>
      )}

      <div className="detail-panels">
        <div className="jobs-panel">
          <h3>Jobs</h3>
          {!loading && jobs.length === 0 && <div className="state-msg">No jobs.</div>}
          {Object.entries(grouped).map(([component, cjobs]) => (
            <div key={component} className="job-group">
              <div className="job-group-label">{component}</div>
              {cjobs.map((j) => (
                <button
                  key={j.jobId}
                  className={`job-item${selectedJob === j.jobId ? " job-selected" : ""}`}
                  onClick={() => j.jobId && loadLog(j.jobId)}
                  aria-label={`View logs for job ${j.jobId}`}
                >
                  <span className={`status-dot status-dot-${j.status}`} />
                  <span className="job-id cell-mono">{j.jobId}</span>
                  <span className="job-status cell-dim">{j.status}</span>
                  {j.runnerId && <span className="cell-dim cell-mono">{j.runnerId.slice(0, 6)}</span>}
                  {j.lastError && <span className="text-error" title={j.lastError}>err</span>}
                </button>
              ))}
            </div>
          ))}
        </div>

        <div className="log-panel">
          <h3>Log{selectedJob ? ` — ${selectedJob}` : ""}</h3>
          {!selectedJob && <div className="state-msg">Select a job to view logs.</div>}
          {logLoading && <div className="state-msg">Loading log…</div>}
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
    return new Date(iso).toLocaleString(undefined, {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
