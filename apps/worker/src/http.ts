import type { ErrorCode } from "@orun/types";
import { OrunError } from "./auth/errors";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Orun-Deploy-Token",
};

export function corsHeaders(): Record<string, string> {
  return { ...CORS_HEADERS };
}

export function json(body: unknown, status = 200, extra?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS, ...extra },
  });
}

export function errorJson(code: ErrorCode, message: string, status: number, extra?: Record<string, string>): Response {
  return json({ error: message, code }, status, extra);
}

export function handleOptions(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export function handleError(err: unknown): Response {
  if (err instanceof OrunError) {
    return errorJson(err.code, err.message, err.httpStatus);
  }
  return errorJson("INTERNAL_ERROR", "Internal server error", 500);
}
