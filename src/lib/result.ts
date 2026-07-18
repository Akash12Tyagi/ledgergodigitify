import { AppError, ERROR_CODE_STATUS, type ErrorCode } from "@/lib/errors";
import { logger } from "@/lib/logger";

// Section 8.1 — the one response envelope used by every Server Action and
// route handler in the app. Nothing returns a bare value or throws past
// this boundary.
export type ApiResult<T> =
  | {
      success: true;
      message: string;
      data: T;
      meta?: { page: number; pageSize: number; total: number; totalPages: number };
    }
  | {
      success: false;
      message: string;
      data: null;
      error: {
        code: ErrorCode;
        fields?: Record<string, string>;
        data?: unknown;
        correlationId?: string;
      };
    };

export function ok<T>(
  data: T,
  message = "OK",
  meta?: { page: number; pageSize: number; total: number; totalPages: number }
): ApiResult<T> {
  return meta ? { success: true, message, data, meta } : { success: true, message, data };
}

export function fail(
  code: ErrorCode,
  message: string,
  options?: {
    fields?: Record<string, string> | undefined;
    data?: unknown;
    correlationId?: string | undefined;
  }
): ApiResult<never> {
  return {
    success: false,
    message,
    data: null,
    error: {
      code,
      ...(options?.fields ? { fields: options.fields } : {}),
      ...(options?.data !== undefined ? { data: options.data } : {}),
      ...(options?.correlationId ? { correlationId: options.correlationId } : {}),
    },
  };
}

/**
 * Wraps a Server Action / route handler body. Catches AppError and maps it
 * to the envelope; catches anything else, logs it with a correlationId, and
 * returns a generic INTERNAL envelope that never leaks internals
 * (Section 8.1).
 */
export async function runAction<T>(fn: () => Promise<T>): Promise<ApiResult<T>> {
  try {
    const data = await fn();
    return ok(data);
  } catch (error) {
    if (error instanceof AppError) {
      return fail(error.code, error.message, { fields: error.fields, data: error.data });
    }
    const correlationId = crypto.randomUUID().slice(0, 8);
    logger.error({ correlationId, err: error }, "Unhandled error in action");
    return fail("INTERNAL", `Something went wrong — ref #${correlationId}`, {
      correlationId,
    });
  }
}

export function statusForCode(code: ErrorCode): number {
  return ERROR_CODE_STATUS[code];
}
