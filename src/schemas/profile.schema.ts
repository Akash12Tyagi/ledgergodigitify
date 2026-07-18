import { z } from "zod";

// Section 7 — Profile page "Account Settings" form. Self-service only:
// role/email/isActive are never editable here (Section 1.2 — role changes
// stay owner-only via /settings/users).
export const updateProfileSchema = z.strictObject({
  name: z.string().min(2, "Name must be at least 2 characters").max(80),
  phone: z
    .string()
    .trim()
    .max(20, "Phone number is too long")
    .regex(/^[0-9+\-\s()]*$/, "Enter a valid phone number")
    .nullable()
    .optional(),
  image: z.url("Enter a valid image URL").max(2048).nullable().optional(),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
