import { useState, useEffect, useCallback } from "react";
import type { CatalogComponentSummary } from "@orun/types";
import type { OrunClient } from "@orun/client";

interface LinkedRepo {
  namespaceId: string;
  namespaceSlug: string;
  linkedAt: string;
}

interface Props {
  client: OrunClient;
  repos: LinkedRepo[];
  onSelectComponent: (componentId: string) => void;
}

type ViewMode = "table" | "card";

interface Filters {
  q: string;
  repoId: string;
  type: string;
  owner: string;
  status: string;
}

export function CatalogView({ client, repos, onSelectComponent }: Props) {
  const [components, setComponents] = useState<CatalogComponentSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const [filters, setFilters] = useState<Filters>({ q: "", repoId: "", type: "", owner: "", status: "" });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await client.listCatalogComponents({
        q: filters.q || undefined,
        repoId: filters.repoId || undefined,
        type: filters.type || undefined,
        owner: filters.owner || undefined,
        status: filters.status || undefined,
      });
      setComponents(res.components);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load catalog");
    } finally {
      setLoading(false);
    }
  }, [client, filters]);

  useEffect(() => { load(); }, [load]);

  const setFilter = (key: keyof Filters, value: string) =>
    setFilters((prev) => ({ ...prev, [key]: value }));

  const uniqueRepos = Array.from(
    new Map(components.map((c) => [c.repoId, c.repoFullName])).entries()
  );
  const uniqueTypes = Array.from(new Set(components.map((c) => c.type)));
  const uniqueOwners = Array.from(new Set(components.map((c) => c.owner).filter(Boolean))) as string[];

  return (
    <div className="view-catalog">
      <div className="catalog-toolbar">
        <h2>Catalog</h2>
        <div className="catalog-filters">
          <input
            type="text"
            className="filter-input"
            placeholder="Search components…"
            value={filters.q}
            onChange={(e) => setFilter("q", e.target.value)}
            aria-label="Search catalog"
          />
          <select
            className="filter-select"
            value={filters.repoId}
            onChange={(e) => setFilter("repoId", e.target.value)}
            aria-label="Filter by repo"
          >
            <option value="">All repos</option>
            {uniqueRepos.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
          <select
            className="filter-select"
            value={filters.type}
            onChange={(e) => setFilter("type", e.target.value)}
            aria-label="Filter by type"
          >
            <option value="">All types</option>
            {uniqueTypes.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select
            className="filter-select"
            value={filters.owner}
            onChange={(e) => setFilter("owner", e.target.value)}
            aria-label="Filter by owner"
          >
            <option value="">All owners</option>
            {uniqueOwners.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          <select
            className="filter-select"
            value={filters.status}
            onChange={(e) => setFilter("status", e.target.value)}
            aria-label="Filter by status"
          >
            <option value="">All statuses</option>
            <option value="healthy">healthy</option>
            <option value="failing">failing</option>
            <option value="stale">stale</option>
            <option value="unknown">unknown</option>
          </select>
        </div>
        <div className="view-toggle" role="group" aria-label="View mode">
          <button
            className={`btn btn-sm${viewMode === "table" ? " btn-active" : ""}`}
            onClick={() => setViewMode("table")}
            aria-pressed={viewMode === "table"}
          >Table</button>
          <button
            className={`btn btn-sm${viewMode === "card" ? " btn-active" : ""}`}
            onClick={() => setViewMode("card")}
            aria-pressed={viewMode === "card"}
          >Cards</button>
        </div>
        <button className="btn btn-sm" onClick={load} aria-label="Refresh catalog">Refresh</button>
        {!loading && <span className="catalog-count cell-dim">{total} component{total !== 1 ? "s" : ""}</span>}
      </div>

      {loading && <div className="state-msg">Loading catalog…</div>}

      {!loading && error && (
        <div className="state-msg state-error">
          {error}
          <button className="btn btn-sm" style={{ marginLeft: "0.5rem" }} onClick={load}>Retry</button>
        </div>
      )}

      {!loading && !error && repos.length === 0 && (
        <div className="empty-state">
          <div className="empty-title">No linked repositories</div>
          <div className="empty-desc">Link a repository to start syncing components.</div>
        </div>
      )}

      {!loading && !error && repos.length > 0 && components.length === 0 && !Object.values(filters).some(Boolean) && (
        <div className="empty-state">
          <div className="empty-title">No components synced yet</div>
          <div className="empty-desc">Run <code>orun catalog export</code> and <code>orun cloud sync</code> in a linked repo to populate the catalog.</div>
        </div>
      )}

      {!loading && !error && components.length === 0 && Object.values(filters).some(Boolean) && (
        <div className="empty-state">
          <div className="empty-title">No matches</div>
          <div className="empty-desc">Try adjusting your filters.</div>
        </div>
      )}

      {!loading && !error && components.length > 0 && viewMode === "table" && (
        <CatalogTable components={components} onSelect={onSelectComponent} />
      )}

      {!loading && !error && components.length > 0 && viewMode === "card" && (
        <CatalogCards components={components} onSelect={onSelectComponent} />
      )}
    </div>
  );
}

function CatalogTable({ components, onSelect }: { components: CatalogComponentSummary[]; onSelect: (id: string) => void }) {
  return (
    <div className="table-wrap">
      <table className="data-table catalog-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Repo</th>
            <th>Owner</th>
            <th>System</th>
            <th>Lifecycle</th>
            <th>Status</th>
            <th>Checksum</th>
            <th>Last Seen</th>
          </tr>
        </thead>
        <tbody>
          {components.map((c) => (
            <tr key={c.componentId} onClick={() => onSelect(c.componentId)} className="clickable-row">
              <td>
                <span className="comp-name">{c.name}</span>
                {c.title && c.title !== c.name && (
                  <span className="comp-title cell-dim"> — {c.title}</span>
                )}
                {c.tags.length > 0 && (
                  <span className="tags-inline">
                    {c.tags.slice(0, 3).map((t) => (
                      <span key={t} className="tag-chip">{t}</span>
                    ))}
                  </span>
                )}
              </td>
              <td><span className="type-chip">{c.type}</span></td>
              <td className="cell-trunc cell-mono">{c.repoFullName}</td>
              <td className="cell-trunc">{c.owner ?? "—"}</td>
              <td className="cell-trunc">{c.system ?? "—"}</td>
              <td>{c.lifecycle ?? "—"}</td>
              <td><span className={`status-chip status-${c.latestStatus}`}>{c.latestStatus}</span></td>
              <td className="cell-mono cell-dim">
                {c.latestPlanChecksum ? c.latestPlanChecksum.slice(0, 8) : "—"}
              </td>
              <td className="cell-dim">{formatTimeShort(c.lastSeenAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CatalogCards({ components, onSelect }: { components: CatalogComponentSummary[]; onSelect: (id: string) => void }) {
  return (
    <div className="catalog-cards" role="list">
      {components.map((c) => (
        <button
          key={c.componentId}
          role="listitem"
          className="catalog-card"
          onClick={() => onSelect(c.componentId)}
          aria-label={`View component ${c.name}`}
        >
          <div className="card-header">
            <span className="comp-name">{c.name}</span>
            <span className={`status-chip status-${c.latestStatus}`}>{c.latestStatus}</span>
          </div>
          {c.title && c.title !== c.name && <div className="card-title cell-dim">{c.title}</div>}
          <div className="card-meta">
            <span className="type-chip">{c.type}</span>
            <span className="cell-mono cell-dim">{c.repoFullName}</span>
          </div>
          {(c.owner || c.system) && (
            <div className="card-meta">
              {c.owner && <span>{c.owner}</span>}
              {c.system && <span className="cell-dim">{c.system}</span>}
            </div>
          )}
          {c.environments.length > 0 && (
            <div className="env-chips">
              {c.environments.map((e) => (
                <span key={e.name} className={`env-chip env-${e.status ?? "unknown"}`}>{e.name}</span>
              ))}
            </div>
          )}
          {c.tags.length > 0 && (
            <div className="tags-inline">
              {c.tags.slice(0, 4).map((t) => <span key={t} className="tag-chip">{t}</span>)}
            </div>
          )}
          <div className="card-footer cell-dim">{formatTimeShort(c.lastSeenAt)}</div>
        </button>
      ))}
    </div>
  );
}

function formatTimeShort(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
