import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "@/lib/argon2";

describe("argon2id hashing", () => {
  it("round-trips a password and rejects the wrong one", async () => {
    const hash = await hashPassword("Correct-Horse-Battery-Staple-9");
    expect(hash).toMatch(/^\$argon2id\$/);
    await expect(verifyPassword(hash, "Correct-Horse-Battery-Staple-9")).resolves.toBe(true);
    await expect(verifyPassword(hash, "wrong-password")).resolves.toBe(false);
  });
});
