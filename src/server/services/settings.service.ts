import { randomBytes } from "node:crypto";

import { AppError } from "@/lib/errors";
import { hashPassword } from "@/lib/argon2";
import { assertPasswordStrength } from "@/lib/password-strength";
import {
  countActiveOwners,
  findAllUsers,
  findUserByEmail,
  findUserById,
  insertUser,
  setUserActive as setUserActiveRepo,
  updateUserRole as updateUserRoleRepo,
} from "@/server/repositories/users.repository";
import { getSettingsOrDefaults, upsertSettings } from "@/server/repositories/settings.repository";
import { logAudit } from "@/server/services/audit.service";
import type { AuthedUser } from "@/server/auth/guards";
import type { UpdateSettingsInput } from "@/schemas/settings.schema";
import type { CreateUserInput, UpdateUserRoleInput } from "@/schemas/user.schema";
import type { UserRole } from "@/constants/roles";

export async function getSettings() {
  return getSettingsOrDefaults();
}

// Section 5.13/7.14 — updateSettings. Owner-only (Section 1.2's most
// restrictive row — operational thresholds affect every notification and
// dashboard figure company-wide).
export async function updateSettings(input: UpdateSettingsInput, actor: AuthedUser) {
  if (actor.role !== "owner") {
    throw new AppError("FORBIDDEN", "Only the owner can change settings.");
  }

  const before = await getSettingsOrDefaults();
  const updated = await upsertSettings({
    companyName: input.companyName,
    largeExpenseAlertPaise: input.largeExpenseAlertPaise,
    lowBalanceDefaultPaise: input.lowBalanceDefaultPaise,
    dueSoonDays: input.dueSoonDays,
    financialYearStartMonth: input.financialYearStartMonth,
    goLiveDate: input.goLiveDate ?? null,
    updatedBy: actor.id,
  });

  await logAudit({
    actorUserId: actor.id,
    actorName: actor.name,
    action: "SETTINGS_UPDATED",
    entity: { kind: "settings", id: null },
    before,
    after: updated,
    summary: `${actor.name} updated company settings`,
  });

  return updated;
}

export type UserRow = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  lastLoginAt: string | null;
  mustChangePassword: boolean;
};

export async function listUsers(): Promise<UserRow[]> {
  const users = await findAllUsers();
  return users.map((u) => ({
    id: u._id.toString(),
    name: u.name,
    email: u.email,
    role: u.role as UserRole,
    isActive: u.isActive,
    lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
    mustChangePassword: u.mustChangePassword,
  }));
}

function generateTemporaryPassword(): string {
  // ~144 bits of entropy, URL-safe — always clears the zxcvbn strength
  // gate, but asserted anyway (Section 10.1) so that gate can never be
  // silently bypassed by a future refactor of this function.
  return randomBytes(18).toString("base64url");
}

export type CreateUserResult = { user: UserRow; temporaryPassword: string };

/**
 * Section 6.10/11 — the owner-facing "add user" flow. Better Auth's
 * public sign-up is disabled, so this writes the credential directly
 * (users.repository.ts#insertUser), mirroring bootstrap-owner.ts. The
 * generated password is returned exactly once in the response — never
 * logged, never stored in plaintext, never emailed (no mail service in
 * scope) — the owner hands it to the new user out-of-band, and
 * mustChangePassword forces a change on first login.
 */
export async function createUser(input: CreateUserInput, actor: AuthedUser): Promise<CreateUserResult> {
  if (actor.role !== "owner") {
    throw new AppError("FORBIDDEN", "Only the owner can add users.");
  }

  const existing = await findUserByEmail(input.email);
  if (existing) {
    throw new AppError("VALIDATION", "A user with this email already exists.", {
      fields: { email: "Email already in use" },
    });
  }

  const temporaryPassword = generateTemporaryPassword();
  assertPasswordStrength(temporaryPassword);
  const passwordHash = await hashPassword(temporaryPassword);

  const user = await insertUser({
    name: input.name,
    email: input.email,
    role: input.role,
    passwordHash,
  });

  await logAudit({
    actorUserId: actor.id,
    actorName: actor.name,
    action: "USER_CREATED",
    entity: { kind: "user", id: user._id },
    after: { name: user.name, email: user.email, role: user.role },
    summary: `${actor.name} added user "${user.name}" (${user.role})`,
  });

  return {
    user: {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role as UserRole,
      isActive: user.isActive,
      lastLoginAt: null,
      mustChangePassword: user.mustChangePassword,
    },
    temporaryPassword,
  };
}

/** Section 14 — a role change/deactivation can never leave zero active
 * owners; `requireUser` re-reads role fresh on every request (edge case
 * 40), so this guard is the only place that invariant needs enforcing. */
async function assertNotLastActiveOwner(targetUserId: string, targetIsCurrentlyActiveOwner: boolean) {
  if (!targetIsCurrentlyActiveOwner) return;
  const remaining = await countActiveOwners(targetUserId);
  if (remaining === 0) {
    throw new AppError(
      "VALIDATION",
      "This is the last active owner. Promote another user to owner before continuing."
    );
  }
}

export async function updateUserRole(input: UpdateUserRoleInput, actor: AuthedUser) {
  if (actor.role !== "owner") {
    throw new AppError("FORBIDDEN", "Only the owner can change roles.");
  }

  const before = await findUserById(input.userId);
  if (!before) throw new AppError("NOT_FOUND", "User not found");

  const wasActiveOwner = before.role === "owner" && before.isActive;
  const stillOwner = input.role === "owner";
  await assertNotLastActiveOwner(input.userId, wasActiveOwner && !stillOwner);

  const updated = await updateUserRoleRepo(input.userId, input.role);
  if (!updated) throw new AppError("NOT_FOUND", "User not found");

  await logAudit({
    actorUserId: actor.id,
    actorName: actor.name,
    action: "USER_ROLE_CHANGED",
    entity: { kind: "user", id: updated._id },
    before: { role: before.role },
    after: { role: updated.role },
    summary: `${actor.name} changed "${updated.name}"'s role from ${before.role} to ${updated.role}`,
  });

  return updated;
}

export async function deactivateUser(userId: string, actor: AuthedUser) {
  if (actor.role !== "owner") {
    throw new AppError("FORBIDDEN", "Only the owner can deactivate users.");
  }
  if (userId === actor.id) {
    throw new AppError("VALIDATION", "You cannot deactivate your own account.");
  }

  const before = await findUserById(userId);
  if (!before) throw new AppError("NOT_FOUND", "User not found");

  await assertNotLastActiveOwner(userId, before.role === "owner" && before.isActive);

  const updated = await setUserActiveRepo(userId, false);
  if (!updated) throw new AppError("NOT_FOUND", "User not found");

  await logAudit({
    actorUserId: actor.id,
    actorName: actor.name,
    action: "USER_DEACTIVATED",
    entity: { kind: "user", id: updated._id },
    before: { isActive: true },
    after: { isActive: false },
    summary: `${actor.name} deactivated "${updated.name}"`,
  });

  return updated;
}

export async function reactivateUser(userId: string, actor: AuthedUser) {
  if (actor.role !== "owner") {
    throw new AppError("FORBIDDEN", "Only the owner can reactivate users.");
  }

  const updated = await setUserActiveRepo(userId, true);
  if (!updated) throw new AppError("NOT_FOUND", "User not found");

  await logAudit({
    actorUserId: actor.id,
    actorName: actor.name,
    action: "USER_REACTIVATED",
    entity: { kind: "user", id: updated._id },
    before: { isActive: false },
    after: { isActive: true },
    summary: `${actor.name} reactivated "${updated.name}"`,
  });

  return updated;
}
