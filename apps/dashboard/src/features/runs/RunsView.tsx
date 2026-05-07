import { useState, useEffect, useCallback } from "react";
import type { Run } from "@orun/types";
import type { OrunClient } from "@orun/client";

interface LinkedRepo {
  namespaceId: string;
  namespaceSlug: string;
  linkedAt: string;
}

interface Props {
  client: OrunClient;
  repos: LinkedRepo[];
  onSelectRun: (runId: string) => void;
}

export function RunsView({ client, repos, onSelectRun }: Props) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await client.listRuns();
      setRuns(res.runs);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load runs");
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => { load(); }, [load]);

  const filtered = runs.filter((r) => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return (
      r.runId.toLowerCase().includes(q) ||
      r.namespace.namespaceSlug.toLowerCase().includes(q) ||
      r.status.toLowerCase().includes(q)
    );
  });

  return (
    <div className="view-runs">
      <div className="panel-header">
        <h2>Runs</h2>
        <input
          type="text"
          className="filter-input"
          placeholder="Filter by repo, status, or ID…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Filter runs"
        />
        <button className="btn btn-sm" onClick={load} aria-label="Refresh runs">Refresh</button>
      </div>

      {repos.length > 0 && (
        <div className="repos-bar">
          {repos.map((r) => (
            <span key={r.namespaceId} className="repo-chip">{r.namespaceSlug}</span>
          ))}
        </div>
      )}

      {loading && <div className="state-msg">Loading runs…</div>}
      {!loading && error && (
        <div className="state-msg state-error">
          {error}
          <button className="btn btn-sm" style={{ marginLeft: "0.5rem" }} onClick={load}>Retry</button>
        </div>
      )}
      {!loading && !error && runs.length === 0 && (
        <div className="state-msg">No runs found.</div>
      )}
      {!loading && !error && runs.length > 0 && filtered.length === 0 && (
        <div className="state-msg">No runs match the filter.</div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="table-wrap">
          <table className="data-table">
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
              {filtered.map((r) => (
                <tr key={r.runId} onClick={() => onSelectRun(r.runId)} className="clickable-row">
                  <td className="cell-mono">{r.runId.slice(0, 8)}</td>
                  <td className="cell-trunc">{r.namespace.namespaceSlug}</td>
                  <td>
                    <span className={`status-chip status-${r.status}`}>{r.status}</span>
                    {r.dryRun && <span className="badge-dry">dry</span>}
                  </td>
                  <td>{r.triggerType}</td>
                  <td className="cell-trunc">{r.actor ?? "—"}</td>
                  <td>
                    {r.jobDone}/{r.jobTotal}
                    {r.jobFailed > 0 && <span className="text-error"> ({r.jobFailed}F)</span>}
                  </td>
                  <td className="cell-dim">{formatTime(r.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
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
