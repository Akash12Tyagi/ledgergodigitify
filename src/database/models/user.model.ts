import { Schema, type InferSchemaType } from "mongoose";
import { registerModel } from "@/database/models/register-model";

import { USER_ROLES } from "@/constants/roles";

// Section 5.1 — the `users` collection. This is also the collection Better
// Auth's adapter reads/writes for authentication (server/auth/auth.ts
// configures `user: { modelName: "users" }`), so it is the single source of
// truth for both identity and role data (Law 1). The credential hash itself
// is NOT stored here — Better Auth stores it on its own linkage document
// (see server/auth/auth.ts's `account` model config); see
// docs/IMPLEMENTATION_PLAN.md for why `passwordHash` is not a field on this
// schema. Role type/rank live in constants/roles.ts, not here, so
// components can use them without importing the data layer.

const userSchema = new Schema(
  {
    name: { type: String, required: true, minlength: 2, maxlength: 80 },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    // Better Auth core fields — populated by Better Auth's adapter, not by
    // our own service code.
    emailVerified: { type: Boolean, default: false },
    image: { type: String, default: null },

    role: { type: String, enum: USER_ROLES, required: true, default: "staff" },
    isActive: { type: Boolean, default: true },
    failedLoginAttempts: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
    mustChangePassword: { type: Boolean, default: false },

    // Section 7 Profile page — self-service account details, not part of
    // Better Auth's core schema. Optional; nothing else in the app reads
    // these yet.
    phone: { type: String, default: null },
  },
  { timestamps: true, collection: "users" }
);

userSchema.index({ email: 1 }, { unique: true });

export type UserDoc = InferSchemaType<typeof userSchema>;

export const UserModel = registerModel<UserDoc>("User", userSchema);
