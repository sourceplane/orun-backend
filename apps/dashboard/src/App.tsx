import { useState, useEffect, useCallback } from "react";
import { OrunClientError } from "@orun/client";
import { handleOAuthCallback, loadSession, clearSession, type Session } from "./auth";
import { createClient, getAuthUrl } from "./api";
import { CatalogView } from "./features/catalog/CatalogView";
import { ComponentDetail } from "./features/catalog/ComponentDetail";
import { RunsView } from "./features/runs/RunsView";
import { RunDetailView } from "./features/runs/RunDetailView";
import { ReposView } from "./features/repos/ReposView";
import { SettingsView } from "./features/settings/SettingsView";

type NavView = "catalog" | "runs" | "repos" | "settings";

interface RouteState {
  nav: NavView;
  detailId: string | null;
}

function parseHash(hash: string): RouteState {
  const path = hash.startsWith("#/") ? hash.slice(2) : "";
  const [nav, ...rest] = path.split("/");
  const detailId = rest.length > 0 ? decodeURIComponent(rest.join("/")) : null;
  if (nav === "runs" || nav === "repos" || nav === "settings") {
    return { nav, detailId };
  }
  return { nav: "catalog", detailId };
}

function routeToHash(nav: NavView, detailId?: string | null): string {
  if (detailId) return `#/${nav}/${encodeURIComponent(detailId)}`;
  return `#/${nav}`;
}

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
      // After OAuth fragment is cleared, default to catalog
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search + "#/catalog",
      );
    } else {
      setSession(loadSession());
      // Ensure a valid hash if authenticated
      if (loadSession() && (!window.location.hash || window.location.hash === "#")) {
        window.history.replaceState(
          null,
          "",
          window.location.pathname + window.location.search + "#/catalog",
        );
      }
    }
    setLoading(false);
  }, []);

  if (loading) {
    return <div className="app-loading">Loading…</div>;
  }

  if (!session) {
    return <LoginScreen />;
  }

  return (
    <AuthenticatedApp
      session={session}
      onSignOut={() => {
        clearSession();
        setSession(null);
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
      }}
    />
  );
}

function LoginScreen() {
  return (
    <div className="login-screen">
      <div className="login-card">
        <h1 className="login-title">orun</h1>
        <p className="login-subtitle">Git-native software catalog</p>
        <a href={getAuthUrl()} className="login-btn" aria-label="Sign in with GitHub">
          Sign in with GitHub
        </a>
      </div>
    </div>
  );
}

function AuthenticatedApp({ session, onSignOut }: { session: Session; onSignOut: () => void }) {
  const [route, setRoute] = useState<RouteState>(() => parseHash(window.location.hash));
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [accountMissing, setAccountMissing] = useState(false);
  const [repos, setRepos] = useState<LinkedRepo[]>([]);
  const [unauthorized, setUnauthorized] = useState(false);

  const client = createClient(session.sessionToken);

  const navigate = useCallback((nav: NavView, detailId?: string | null) => {
    const hash = routeToHash(nav, detailId);
    window.history.pushState(null, "", window.location.pathname + window.location.search + hash);
    setRoute({ nav, detailId: detailId ?? null });
  }, []);

  // Sync route from hash (browser back/forward)
  useEffect(() => {
    const handler = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);

  // Load account and repos on mount
  useEffect(() => {
    async function init() {
      try {
        const [accountRes, reposRes] = await Promise.allSettled([
          client.getAccount(),
          client.listLinkedRepos(),
        ]);
        if (accountRes.status === "fulfilled") {
          setAccount(accountRes.value);
          setAccountMissing(false);
        } else {
          const err = accountRes.reason;
          if (err instanceof OrunClientError && err.status === 404) {
            setAccountMissing(true);
          } else if (err instanceof OrunClientError && (err.status === 401 || err.status === 403)) {
            setUnauthorized(true);
          }
        }
        if (reposRes.status === "fulfilled") {
          setRepos(reposRes.value.repos);
        }
      } catch {}
    }
    init();
  }, [session.sessionToken]);

  const handleCreateAccount = async () => {
    try {
      const res = await client.createAccount();
      setAccount(res);
      setAccountMissing(false);
    } catch {}
  };

  if (unauthorized) {
    return (
      <div className="login-screen">
        <div className="login-card">
          <h1 className="login-title">orun</h1>
          <p className="login-subtitle">Your session has expired.</p>
          <a href={getAuthUrl()} className="login-btn">Sign in again</a>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <aside className="nav-sidebar" aria-label="Main navigation">
        <div className="nav-brand">orun</div>
        <nav>
          <ul className="nav-list" role="list">
            {(["catalog", "runs", "repos", "settings"] as NavView[]).map((v) => (
              <li key={v}>
                <button
                  className={`nav-item${route.nav === v ? " nav-active" : ""}`}
                  onClick={() => navigate(v)}
                  aria-current={route.nav === v ? "page" : undefined}
                >
                  {navLabel(v)}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      <div className="app-body">
        <header className="topbar">
          <div className="topbar-left">
            {account && (
              <span className="topbar-user" title={session.githubLogin}>
                {session.githubLogin}
              </span>
            )}
            {repos.length > 0 && (
              <span className="topbar-scope cell-dim">{repos.length} repo{repos.length !== 1 ? "s" : ""}</span>
            )}
          </div>
          <div className="topbar-right">
            <button
              className="btn btn-sm btn-ghost"
              onClick={onSignOut}
              aria-label="Sign out"
            >
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

        <main className="main-content" id="main-content">
          {route.nav === "catalog" && !route.detailId && (
            <CatalogView
              client={client}
              repos={repos}
              onSelectComponent={(id) => navigate("catalog", id)}
            />
          )}
          {route.nav === "catalog" && route.detailId && (
            <ComponentDetail
              componentId={route.detailId}
              client={client}
              onBack={() => navigate("catalog")}
              onSelectRun={(runId) => navigate("runs", runId)}
            />
          )}
          {route.nav === "runs" && !route.detailId && (
            <RunsView
              client={client}
              repos={repos}
              onSelectRun={(id) => navigate("runs", id)}
            />
          )}
          {route.nav === "runs" && route.detailId && (
            <RunDetailView
              runId={route.detailId}
              client={client}
              onBack={() => navigate("runs")}
            />
          )}
          {route.nav === "repos" && (
            <ReposView client={client} />
          )}
          {route.nav === "settings" && (
            <SettingsView
              session={session}
              accountId={account?.accountId ?? null}
              onSignOut={onSignOut}
            />
          )}
        </main>
      </div>
    </div>
  );
}

function navLabel(v: NavView): string {
  switch (v) {
    case "catalog": return "Catalog";
    case "runs": return "Runs";
    case "repos": return "Repositories";
    case "settings": return "Settings";
  }
}
