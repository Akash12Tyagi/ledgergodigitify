import { afterEach, describe, expect, it } from "vitest";

import { checkRateLimit } from "@/lib/rate-limit";
import { AppError } from "@/lib/errors";
import { RATE_AUTH_PER_MIN } from "@/constants/finance";
import { clearAllCollections } from "../helpers/seed-user";

describe("checkRateLimit", () => {
  afterEach(async () => {
    await clearAllCollections();
  });

  it("allows requests under the per-minute limit", async () => {
    const id = `test-ip-${Math.random()}`;
    for (let i = 0; i < RATE_AUTH_PER_MIN; i++) {
      await expect(checkRateLimit("auth", id)).resolves.toBeUndefined();
    }
  });

  it("throws RATE_LIMITED once the limit is exceeded (Section 10.10 — 5/min auth)", async () => {
    const id = `test-ip-${Math.random()}`;
    for (let i = 0; i < RATE_AUTH_PER_MIN; i++) {
      await checkRateLimit("auth", id);
    }
    await expect(checkRateLimit("auth", id)).rejects.toMatchObject({
      code: "RATE_LIMITED",
    } satisfies Partial<AppError>);
  });

  it("scopes limits independently per identifier", async () => {
    const idA = `test-ip-a-${Math.random()}`;
    const idB = `test-ip-b-${Math.random()}`;
    for (let i = 0; i < RATE_AUTH_PER_MIN; i++) {
      await checkRateLimit("auth", idA);
    }
    // idB has its own bucket — should not be rate limited yet.
    await expect(checkRateLimit("auth", idB)).resolves.toBeUndefined();
  });
});
