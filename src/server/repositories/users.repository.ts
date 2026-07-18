import { Types } from "mongoose";

import { db, nativeDb } from "@/database/connection";
import { UserModel } from "@/database/models/user.model";
import type { UserRole } from "@/constants/roles";

// Section 3 — repositories are the ONLY files importing models; pure data
// access, no business rules.

export async function findUserById(id: string) {
  await db();
  if (!Types.ObjectId.isValid(id)) return null;
  return UserModel.findById(id).lean();
}

export async function findUserByEmail(email: string) {
  await db();
  return UserModel.findOne({ email: email.toLowerCase().trim() }).lean();
}

/** Section 7.14 — /settings/users. */
export async function findAllUsers() {
  await db();
  return UserModel.find({}).sort({ name: 1 }).lean();
}

export type InsertUserInput = {
  name: string;
  email: string;
  role: UserRole;
  passwordHash: string;
};

/**
 * Section 6.10/11 — Better Auth's public sign-up is disabled (internal
 * tool, no self-serve accounts), so the owner-facing "add user" flow
 * writes the `users` + `authAccounts` documents directly, mirroring
 * exactly what scripts/bootstrap-owner.ts writes for the first owner
 * (verified against Better Auth's own sign-up route at that script's
 * authoring time). Not wrapped in a transaction — same as
 * bootstrap-owner.ts — since user provisioning is a rare, owner-only,
 * non-money operation, consistent with that established precedent.
 */
export async function insertUser(input: InsertUserInput) {
  await db();
  const user = await UserModel.create({
    name: input.name,
    email: input.email.toLowerCase().trim(),
    emailVerified: true,
    role: input.role,
    isActive: true,
    failedLoginAttempts: 0,
    lockedUntil: null,
    lastLoginAt: null,
    mustChangePassword: true,
  });

  const { database } = await nativeDb();
  await database.collection("authAccounts").insertOne({
    providerId: "credential",
    accountId: user._id.toString(),
    userId: user._id,
    password: input.passwordHash,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  return user;
}

export async function incrementFailedLoginAttempts(userId: string) {
  await db();
  return UserModel.findByIdAndUpdate(
    userId,
    { $inc: { failedLoginAttempts: 1 } },
    { returnDocument: "after" }
  ).lean();
}

export async function lockUserUntil(userId: string, lockedUntil: Date) {
  await db();
  await UserModel.findByIdAndUpdate(userId, { $set: { lockedUntil } });
}

export async function recordSuccessfulLogin(userId: string) {
  await db();
  await UserModel.findByIdAndUpdate(userId, {
    $set: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
  });
}

export async function countActiveOwners(excludingUserId?: string) {
  await db();
  const filter: Record<string, unknown> = { role: "owner", isActive: true };
  if (excludingUserId) filter._id = { $ne: new Types.ObjectId(excludingUserId) };
  return UserModel.countDocuments(filter);
}

export async function updateUserRole(userId: string, role: UserRole) {
  await db();
  return UserModel.findByIdAndUpdate(userId, { $set: { role } }, { returnDocument: "after" }).lean();
}

export async function setUserActive(userId: string, isActive: boolean) {
  await db();
  return UserModel.findByIdAndUpdate(userId, { $set: { isActive } }, { returnDocument: "after" }).lean();
}

export type UpdateUserProfileInput = {
  name: string;
  phone: string | null;
  image: string | null;
};

/** Section 7 — Profile page self-service edit (name/phone/image only). */
export async function updateUserProfile(userId: string, input: UpdateUserProfileInput) {
  await db();
  return UserModel.findByIdAndUpdate(
    userId,
    { $set: { name: input.name, phone: input.phone, image: input.image } },
    { returnDocument: "after" }
  ).lean();
}
