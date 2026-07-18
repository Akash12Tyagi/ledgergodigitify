import { describe, expect, it } from "vitest";

import { assertPasswordStrength } from "@/lib/password-strength";
import { AppError } from "@/lib/errors";

// Section 10.1 — zxcvbn score ≥ 3 required for new passwords.
describe("assertPasswordStrength", () => {
  it("rejects common/weak passwords", () => {
    expect(() => assertPasswordStrength("password123")).toThrow(AppError);
    expect(() => assertPasswordStrength("12345678")).toThrow(AppError);
    expect(() => assertPasswordStrength("qwertyuiop")).toThrow(AppError);
  });

  it("accepts a strong, non-trivial password", () => {
    expect(() => assertPasswordStrength("Correct-Horse-Battery-Staple-9")).not.toThrow();
  });

  it("throws a VALIDATION AppError with a field error", () => {
    try {
      assertPasswordStrength("password");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe("VALIDATION");
      expect((error as AppError).fields?.password).toBeDefined();
    }
  });
});
