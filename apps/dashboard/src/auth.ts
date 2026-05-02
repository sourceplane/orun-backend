const SESSION_KEY = "orun_session";

export interface Session {
  sessionToken: string;
  githubLogin: string;
  allowedNamespaceIds: string[];
}

export function parseOAuthFragment(hash: string): Session | null {
  if (!hash || hash === "#") return null;
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const sessionToken = params.get("sessionToken");
  const githubLogin = params.get("githubLogin");
  const nsRaw = params.get("allowedNamespaceIds");
  if (!sessionToken || !githubLogin) return null;
  let allowedNamespaceIds: string[] = [];
  if (nsRaw) {
    try {
      allowedNamespaceIds = JSON.parse(nsRaw);
    } catch {
      allowedNamespaceIds = [];
    }
  }
  return { sessionToken, githubLogin, allowedNamespaceIds };
}

export function storeSession(session: Session): void {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function loadSession(): Session | null {
  const raw = sessionStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed.sessionToken && parsed.githubLogin) return parsed as Session;
  } catch {}
  return null;
}

export function clearSession(): void {
  sessionStorage.removeItem(SESSION_KEY);
}

export function handleOAuthCallback(): Session | null {
  const hash = window.location.hash;
  const session = parseOAuthFragment(hash);
  if (session) {
    storeSession(session);
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }
  return session;
}
