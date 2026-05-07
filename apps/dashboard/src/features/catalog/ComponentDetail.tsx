import { useState, useEffect, useCallback } from "react";
import type { CatalogComponentDetail, CatalogComponentEvent, CatalogComponentRelation, CatalogComponentRelationsResponse, Run } from "@orun/types";
import type { OrunClient } from "@orun/client";

interface Props {
  componentId: string;
  client: OrunClient;
  onBack: () => void;
  onSelectRun: (runId: string) => void;
}

type Tab = "overview" | "dependencies" | "runs" | "history";

export function ComponentDetail({ componentId, client, onBack, onSelectRun }: Props) {
  const [component, setComponent] = useState<CatalogComponentDetail | null>(null);
  const [deps, setDeps] = useState<CatalogComponentRelationsResponse | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [events, setEvents] = useState<CatalogComponentEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const detailRes = await client.getCatalogComponent(componentId);
      setComponent(detailRes.component);

      const [depsRes, runsRes, histRes] = await Promise.allSettled([
        client.getCatalogComponentDependencies(componentId),
        client.getCatalogComponentRuns(componentId),
        client.getCatalogComponentHistory(componentId),
      ]);
      if (depsRes.status === "fulfilled") setDeps(depsRes.value);
      if (runsRes.status === "fulfilled") setRuns(runsRes.value.runs);
      if (histRes.status === "fulfilled") setEvents(histRes.value.events);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Component not found");
    } finally {
      setLoading(false);
    }
  }, [componentId, client]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="state-msg">Loading component…</div>;
  if (error || !component) {
    return (
      <div className="view-detail">
        <div className="panel-header">
          <button className="btn btn-sm" onClick={onBack} aria-label="Back to catalog">← Catalog</button>
        </div>
        <div className="state-msg state-error">{error ?? "Component not found"}</div>
      </div>
    );
  }

  return (
    <div className="view-detail">
      <div className="panel-header">
        <button className="btn btn-sm" onClick={onBack} aria-label="Back to catalog">← Catalog</button>
        <h2 className="comp-name">{component.name}</h2>
        <span className="type-chip">{component.type}</span>
        <span className={`status-chip status-${component.latestStatus}`}>{component.latestStatus}</span>
        {component.lifecycle && <span className="lifecycle-chip">{component.lifecycle}</span>}
      </div>

      <div className="tabs" role="tablist">
        {(["overview", "dependencies", "runs", "history"] as Tab[]).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={`tab-btn${tab === t ? " tab-active" : ""}`}
            onClick={() => setTab(t)}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
            {t === "runs" && runs.length > 0 && <span className="tab-count">{runs.length}</span>}
            {t === "dependencies" && deps && (deps.outgoing.length + deps.incoming.length) > 0 && (
              <span className="tab-count">{deps.outgoing.length + deps.incoming.length}</span>
            )}
          </button>
        ))}
      </div>

      <div className="tab-content">
        {tab === "overview" && <OverviewTab component={component} />}
        {tab === "dependencies" && <DepsTab deps={deps} />}
        {tab === "runs" && <RunsTab runs={runs} onSelectRun={onSelectRun} />}
        {tab === "history" && <HistoryTab events={events} />}
      </div>
    </div>
  );
}

function OverviewTab({ component }: { component: CatalogComponentDetail }) {
  return (
    <div className="overview-grid">
      <Field label="Name" value={component.name} />
      {component.title && component.title !== component.name && <Field label="Title" value={component.title} />}
      {component.description && <Field label="Description" value={component.description} />}
      <Field label="Type" value={<span className="type-chip">{component.type}</span>} />
      <Field label="Repo" value={<span className="cell-mono">{component.repoFullName}</span>} />
      <Field label="Path" value={<span className="cell-mono">{component.repoPath}</span>} />
      {component.owner && <Field label="Owner" value={component.owner} />}
      {component.system && <Field label="System" value={component.system} />}
      {component.lifecycle && <Field label="Lifecycle" value={component.lifecycle} />}
      <Field label="Status" value={<span className={`status-chip status-${component.latestStatus}`}>{component.latestStatus}</span>} />
      <Field label="Latest commit" value={<span className="cell-mono">{component.latestCommitSha.slice(0, 12)}</span>} />
      {component.latestPlanChecksum && (
        <Field label="Plan checksum" value={<span className="cell-mono">{component.latestPlanChecksum.slice(0, 16)}</span>} />
      )}
      <Field label="State ref" value={
        <span className="cell-mono artifact-ref" title={component.currentStateRef}>
          {component.currentStateRef.length > 60
            ? `…${component.currentStateRef.slice(-52)}`
            : component.currentStateRef}
          <CopyBtn text={component.currentStateRef} />
        </span>
      } />
      <Field label="First seen" value={formatTime(component.firstSeenAt)} />
      <Field label="Last synced" value={formatTime(component.lastSeenAt)} />
      {component.tags.length > 0 && (
        <Field label="Tags" value={
          <div className="tags-inline">
            {component.tags.map((t) => <span key={t} className="tag-chip">{t}</span>)}
          </div>
        } />
      )}
      {component.environments.length > 0 && (
        <Field label="Environments" value={
          <div className="env-chips">
            {component.environments.map((e) => (
              <span key={e.name} className={`env-chip env-${e.status ?? "unknown"}`}>{e.name}</span>
            ))}
          </div>
        } />
      )}
    </div>
  );
}

function DepsTab({ deps }: { deps: CatalogComponentRelationsResponse | null }) {
  if (!deps) return <div className="state-msg">Loading dependencies…</div>;
  return (
    <div className="deps-view">
      <section>
        <h3 className="section-label">Outgoing ({deps.outgoing.length})</h3>
        {deps.outgoing.length === 0
          ? <div className="state-msg">No outgoing dependencies.</div>
          : <RelationList relations={deps.outgoing} />}
      </section>
      <section>
        <h3 className="section-label">Incoming ({deps.incoming.length})</h3>
        {deps.incoming.length === 0
          ? <div className="state-msg">No incoming dependents.</div>
          : <IncomingList relations={deps.incoming} />}
      </section>
    </div>
  );
}

function RelationList({ relations }: { relations: CatalogComponentRelation[] }) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead><tr><th>Type</th><th>Target kind</th><th>Target ref</th><th>Env</th></tr></thead>
        <tbody>
          {relations.map((r, i) => (
            <tr key={i}>
              <td><span className="type-chip">{r.relationType}</span></td>
              <td>{r.targetKind}</td>
              <td className="cell-mono cell-trunc">{r.targetRef}</td>
              <td>{r.environment ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function IncomingList({ relations }: { relations: Array<CatalogComponentRelation & { sourceComponentId: string; sourceName: string }> }) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead><tr><th>Source</th><th>Type</th><th>Target ref</th><th>Env</th></tr></thead>
        <tbody>
          {relations.map((r, i) => (
            <tr key={i}>
              <td className="cell-mono">{r.sourceName}</td>
              <td><span className="type-chip">{r.relationType}</span></td>
              <td className="cell-mono cell-trunc">{r.targetRef}</td>
              <td>{r.environment ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RunsTab({ runs, onSelectRun }: { runs: Run[]; onSelectRun: (id: string) => void }) {
  if (runs.length === 0) return <div className="state-msg">No recent runs for this component.</div>;
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr><th>Run ID</th><th>Repo</th><th>Status</th><th>Trigger</th><th>Actor</th><th>Jobs</th><th>Created</th></tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.runId} onClick={() => onSelectRun(r.runId)} className="clickable-row">
              <td className="cell-mono">{r.runId.slice(0, 8)}</td>
              <td className="cell-trunc">{r.namespace.namespaceSlug}</td>
              <td><span className={`status-chip status-${r.status}`}>{r.status}</span></td>
              <td>{r.triggerType}</td>
              <td className="cell-trunc">{r.actor ?? "—"}</td>
              <td>{r.jobDone}/{r.jobTotal}</td>
              <td className="cell-dim">{formatTime(r.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HistoryTab({ events }: { events: CatalogComponentEvent[] }) {
  if (events.length === 0) return <div className="state-msg">No history events.</div>;
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr><th>Event</th><th>Commit</th><th>PR</th><th>Upload</th><th>Date</th></tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.eventId}>
              <td><span className="type-chip">{e.eventType}</span></td>
              <td className="cell-mono">{e.commitSha.slice(0, 10)}</td>
              <td>{e.prNumber ? `#${e.prNumber}` : "—"}</td>
              <td className="cell-mono cell-dim">{e.uploadId.slice(0, 12)}</td>
              <td className="cell-dim">{formatTime(e.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="field-row">
      <dt className="field-label">{label}</dt>
      <dd className="field-value">{value}</dd>
    </div>
  );
}

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };
  return (
    <button className="copy-btn" onClick={copy} aria-label="Copy to clipboard" title="Copy">
      {copied ? "✓" : "⧉"}
    </button>
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
