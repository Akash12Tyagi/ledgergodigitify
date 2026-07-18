import { db, nativeDb } from "@/database/connection";
import { UserModel } from "@/database/models/user.model";
import { hashPassword } from "@/lib/argon2";
import type { UserRole } from "@/constants/roles";

/** Mirrors exactly what scripts/bootstrap-owner.ts writes, for tests that
 * need a real, sign-in-able user without going through Better Auth's
 * disabled public sign-up endpoint. */
export async function seedUser(input: {
  name: string;
  email: string;
  password: string;
  role: UserRole;
  isActive?: boolean;
  mustChangePassword?: boolean;
}) {
  await db();
  const user = await UserModel.create({
    name: input.name,
    email: input.email.toLowerCase(),
    emailVerified: true,
    role: input.role,
    isActive: input.isActive ?? true,
    failedLoginAttempts: 0,
    lockedUntil: null,
    lastLoginAt: null,
    mustChangePassword: input.mustChangePassword ?? false,
  });

  const passwordHash = await hashPassword(input.password);
  const { database } = await nativeDb();
  await database.collection("authAccounts").insertOne({
    providerId: "credential",
    accountId: user._id.toString(),
    userId: user._id,
    password: passwordHash,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  return user;
}

export async function clearAllCollections() {
  const { database } = await nativeDb();
  const collections = await database.listCollections().toArray();
  await Promise.all(
    collections.map((c) => database.collection(c.name).deleteMany({}))
  );
}
