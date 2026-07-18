import zxcvbn from "zxcvbn";

import { AppError } from "@/lib/errors";
import { PASSWORD_MIN_ZXCVBN_SCORE } from "@/constants/finance";

/** Section 10.1 — require non-trivial (zxcvbn score ≥ 3) for new passwords. */
export function assertPasswordStrength(password: string): void {
  const result = zxcvbn(password);
  if (result.score < PASSWORD_MIN_ZXCVBN_SCORE) {
    throw new AppError(
      "VALIDATION",
      "This password is too easy to guess. Try adding more length or a less common phrase.",
      { fields: { password: "Password is too weak" } }
    );
  }
}
