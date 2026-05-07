import { useState, useEffect, useCallback } from "react";
import type { CatalogComponentSummary } from "@orun/types";
import type { OrunClient } from "@orun/client";

interface LinkedRepo {
  namespaceId: string;
  namespaceSlug: string;
  linkedAt: string;
}

interface RepoHealth {
  repo: LinkedRepo;
  componentCount: number;
  lastSync: string | null;
  latestStatus: string;
}

interface Props {
  client: OrunClient;
}

export function ReposView({ client }: Props) {
  const [repos, setRepos] = useState<LinkedRepo[]>([]);
  const [health, setHealth] = useState<RepoHealth[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const reposRes = await client.listLinkedRepos();
      const linkedRepos = reposRes.repos;
      setRepos(linkedRepos);

      // Fetch catalog components to derive per-repo stats
      let allComponents: CatalogComponentSummary[] = [];
      try {
        const catalogRes = await client.listCatalogComponents({ limit: 100 });
        allComponents = catalogRes.components;
      } catch {
        // catalog may be empty; repos still show
      }

      const repoHealth: RepoHealth[] = linkedRepos.map((repo) => {
        const repoSlug = repo.namespaceSlug;
        const comps = allComponents.filter((c) => c.repoFullName === repoSlug);
        const lastSync = comps.length > 0
          ? comps.reduce((max, c) => (c.lastSeenAt > max ? c.lastSeenAt : max), comps[0].lastSeenAt)
          : null;
        const statuses = comps.map((c) => c.latestStatus);
        const latestStatus = statuses.includes("failing")
          ? "failing"
          : statuses.includes("healthy")
          ? "healthy"
          : statuses.includes("stale")
          ? "stale"
          : "unknown";

        return { repo, componentCount: comps.length, lastSync, latestStatus };
      });

      setHealth(repoHealth);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load repositories");
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="view-repos">
      <div className="panel-header">
        <h2>Repositories</h2>
        <button className="btn btn-sm" onClick={load} aria-label="Refresh repositories">Refresh</button>
      </div>

      {loading && <div className="state-msg">Loading repositories…</div>}
      {!loading && error && (
        <div className="state-msg state-error">
          {error}
          <button className="btn btn-sm" style={{ marginLeft: "0.5rem" }} onClick={load}>Retry</button>
        </div>
      )}
      {!loading && !error && repos.length === 0 && (
        <div className="empty-state">
          <div className="empty-title">No linked repositories</div>
          <div className="empty-desc">Connect GitHub repositories through the Orun Worker to see them here.</div>
        </div>
      )}

      {!loading && !error && health.length > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Repository</th>
                <th>Namespace ID</th>
                <th>Linked</th>
                <th>Components</th>
                <th>Last sync</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {health.map(({ repo, componentCount, lastSync, latestStatus }) => (
                <tr key={repo.namespaceId}>
                  <td className="cell-mono">{repo.namespaceSlug}</td>
                  <td className="cell-mono cell-dim">{repo.namespaceId.slice(0, 16)}…</td>
                  <td className="cell-dim">{formatTime(repo.linkedAt)}</td>
                  <td>{componentCount}</td>
                  <td className="cell-dim">
                    {lastSync ? formatTime(lastSync) : <span className="cell-dim">No sync yet</span>}
                  </td>
                  <td>
                    {componentCount > 0
                      ? <span className={`status-chip status-${latestStatus}`}>{latestStatus}</span>
                      : <span className="status-chip status-unknown">no data</span>}
                  </td>
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
