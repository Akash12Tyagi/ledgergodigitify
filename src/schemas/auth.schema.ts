import { z } from "zod";

import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/constants/finance";

// Section 8.2/10.5 — shared verbatim by the client form and the Server
// Action. z.strictObject rejects unknown keys (Section 10.5).

// Section 10.14 — open-redirect guard: must be a same-origin path starting
// with a single "/", never "//..." (protocol-relative) or an absolute URL.
const safeReturnTo = z
  .string()
  .regex(/^\/(?!\/)/, "returnTo must be a same-origin path")
  .optional();

export const loginSchema = z.strictObject({
  email: z.email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
  returnTo: safeReturnTo,
});
export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = z.strictObject({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z
    .string()
    .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
    .max(PASSWORD_MAX_LENGTH, "Password is too long"),
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
