import { z } from "zod";

import { USER_ROLES } from "@/constants/roles";
import { objectIdString } from "@/schemas/common.schema";

// Section 6.10/7.14 — /settings/users "add user". No password field: the
// server generates a high-entropy temporary password and returns it once
// (Section 11 — no public sign-up, no email dependency in scope).
export const createUserSchema = z.strictObject({
  name: z.string().min(2).max(80),
  email: z.email("Enter a valid email address"),
  role: z.enum(USER_ROLES),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserRoleSchema = z.strictObject({
  userId: objectIdString,
  role: z.enum(USER_ROLES),
});
export type UpdateUserRoleInput = z.infer<typeof updateUserRoleSchema>;
