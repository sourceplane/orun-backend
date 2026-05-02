import { OrunClient } from "@orun/client";

const API_BASE = import.meta.env.VITE_ORUN_API_BASE_URL ?? "http://localhost:8787";

export function createClient(token?: string | null): OrunClient {
  return new OrunClient({
    baseUrl: API_BASE,
    token: token ?? undefined,
  });
}

export function getAuthUrl(): string {
  const client = createClient();
  const callbackUrl = `${window.location.origin}${window.location.pathname}`;
  return client.getGitHubAuthUrl(callbackUrl);
}

export { API_BASE };
