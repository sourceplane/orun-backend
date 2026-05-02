import type { ErrorCode } from "@orun/types";

const STATUS_MAP: Record<ErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INVALID_REQUEST: 400,
  INTERNAL_ERROR: 500,
};

function statusForCode(code: ErrorCode): number {
  return STATUS_MAP[code] ?? 500;
}

export class OrunError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly httpStatus = statusForCode(code),
  ) {
    super(message);
  }
}
