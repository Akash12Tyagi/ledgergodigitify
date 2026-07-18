import { db } from "@/database/connection";
import { RateLimitModel } from "@/database/models/rate-limit.model";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import {
  RATE_AUTH_PER_MIN,
  RATE_EXPORT_PER_MIN,
  RATE_MUTATIONS_PER_MIN,
} from "@/constants/finance";

export type RateLimitScope = "mutation" | "auth" | "export";

const LIMITS: Record<RateLimitScope, number> = {
  mutation: RATE_MUTATIONS_PER_MIN,
  auth: RATE_AUTH_PER_MIN,
  export: RATE_EXPORT_PER_MIN,
};

const WINDOW_MS = 60_000;

/**
 * Fixed 1-minute-bucket sliding window, Mongo-backed (Section 10.2/10.10).
 *
 * Fail-open vs fail-closed policy (not specified by the spec — see
 * docs/IMPLEMENTATION_PLAN.md "Open Assumptions" #2): a transient failure
 * writing to the rate_limits collection must not either (a) lock out every
 * mutation because Mongo hiccuped, or (b) silently disable rate limiting
 * forever. Reads (`checkRateLimit` called for non-mutating scopes) fail
 * open after one retry; the `mutation` scope fails **closed** (throws
 * RATE_LIMITED) after one bounded retry, since an attacker exploiting a
 * DB blip to bypass the 30/min mutation cap is the worse outcome.
 */
export async function checkRateLimit(
  scope: RateLimitScope,
  identifier: string
): Promise<void> {
  const limit = LIMITS[scope];
  const windowStart = new Date(Math.floor(Date.now() / WINDOW_MS) * WINDOW_MS);
  const key = `${scope}:${identifier}:${windowStart.getTime()}`;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await db();
      const doc = await RateLimitModel.findOneAndUpdate(
        { key },
        { $inc: { count: 1 }, $setOnInsert: { windowStart } },
        { upsert: true, returnDocument: "after" }
      ).lean();

      const count = doc?.count ?? 1;
      if (count > limit) {
        throw new AppError(
          "RATE_LIMITED",
          "Too many requests. Please slow down and try again shortly.",
          { data: { retryAfterSeconds: 60 } }
        );
      }
      return;
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (attempt === 1) {
        logger.error({ err: error, scope, identifier }, "Rate limiter storage failure");
        if (scope === "mutation") {
          throw new AppError(
            "RATE_LIMITED",
            "Rate limiting is temporarily unavailable; mutations are paused for safety."
          );
        }
        return; // fail-open for non-mutation scopes
      }
    }
  }
}
