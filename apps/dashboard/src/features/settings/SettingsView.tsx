import type { Session } from "../../auth";
import { API_BASE } from "../../api";

interface Props {
  session: Session;
  accountId: string | null;
  onSignOut: () => void;
}

export function SettingsView({ session, accountId, onSignOut }: Props) {
  return (
    <div className="view-settings">
      <div className="panel-header">
        <h2>Settings</h2>
      </div>
      <div className="settings-section">
        <h3 className="section-label">Session</h3>
        <dl className="overview-grid">
          <div className="field-row">
            <dt className="field-label">GitHub login</dt>
            <dd className="field-value">{session.githubLogin}</dd>
          </div>
          <div className="field-row">
            <dt className="field-label">Account</dt>
            <dd className="field-value">
              {accountId
                ? <span className="cell-mono">{accountId}</span>
                : <span className="cell-dim">Not created</span>}
            </dd>
          </div>
          <div className="field-row">
            <dt className="field-label">Linked namespaces</dt>
            <dd className="field-value">{session.allowedNamespaceIds.length}</dd>
          </div>
        </dl>
      </div>
      <div className="settings-section">
        <h3 className="section-label">API</h3>
        <dl className="overview-grid">
          <div className="field-row">
            <dt className="field-label">Base URL</dt>
            <dd className="field-value cell-mono">{API_BASE}</dd>
          </div>
        </dl>
      </div>
      <div className="settings-section">
        <button className="btn" onClick={onSignOut} aria-label="Sign out">Sign out</button>
      </div>
    </div>
  );
}
