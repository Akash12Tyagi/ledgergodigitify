// Section 8.1 — the closed list of error codes every action/handler can
// return. AppError is the one exception type raised anywhere in server
// code; the action/handler wrapper (lib/result.ts) catches it and maps it
// to the ApiResult envelope. Never throw a raw Error from a service —
// throw AppError so the boundary can respond correctly instead of leaking
// a stack trace (Section 8.1: INTERNAL never leaks stack/details).
export type ErrorCode =
  | "VALIDATION"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INSUFFICIENT_BALANCE"
  | "NONZERO_BALANCE"
  | "ARCHIVED_CLIENT"
  | "RATE_LIMITED"
  | "IDEMPOTENT_REPLAY"
  | "LOCKED"
  | "INTERNAL";

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly fields?: Record<string, string>;
  readonly data?: unknown;

  constructor(
    code: ErrorCode,
    message: string,
    options?: { fields?: Record<string, string>; data?: unknown }
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    if (options?.fields) this.fields = options.fields;
    if (options?.data !== undefined) this.data = options.data;
  }
}

// HTTP status mapping for route handlers (Section 8.1).
export const ERROR_CODE_STATUS: Record<ErrorCode, number> = {
  VALIDATION: 422,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INSUFFICIENT_BALANCE: 409,
  NONZERO_BALANCE: 409,
  ARCHIVED_CLIENT: 409,
  RATE_LIMITED: 429,
  IDEMPOTENT_REPLAY: 200,
  LOCKED: 423,
  INTERNAL: 500,
};
