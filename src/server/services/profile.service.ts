import { AppError } from "@/lib/errors";
import {
  findUserById,
  updateUserProfile as updateUserProfileRepo,
} from "@/server/repositories/users.repository";
import { getEntityAuditLog, logAudit } from "@/server/services/audit.service";
import type { AuthedUser } from "@/server/auth/guards";
import type { UpdateProfileInput } from "@/schemas/profile.schema";
import type { UserRole } from "@/constants/roles";

export type ProfileData = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  phone: string | null;
  image: string | null;
  createdAt: string;
  lastLoginAt: string | null;
};

export type ProfileActivityRow = {
  id: string;
  action: string;
  summary: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
};

function toProfileData(user: NonNullable<Awaited<ReturnType<typeof findUserById>>>): ProfileData {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    role: user.role as UserRole,
    isActive: user.isActive,
    phone: user.phone ?? null,
    image: user.image ?? null,
    createdAt: user.createdAt.toISOString(),
    lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
  };
}

export async function getProfile(userId: string): Promise<ProfileData> {
  const user = await findUserById(userId);
  if (!user) throw new AppError("NOT_FOUND", "User not found");
  return toProfileData(user);
}

/** Section 7 Profile "Activity" section — reuses the same auth-entity audit
 * trail LOGIN/LOGIN_FAILED/LOGOUT/PASSWORD_CHANGED already write to
 * (features/auth/actions.ts), newest first. `ip`/`userAgent` double as the
 * lightweight "device/session information" the spec asks for — there is no
 * separate session-listing API in scope. */
export async function getProfileActivity(userId: string, limit = 10): Promise<ProfileActivityRow[]> {
  const rows = await getEntityAuditLog("auth", userId);
  return rows.slice(0, limit).map((r) => ({
    id: r._id.toString(),
    action: r.action,
    summary: r.summary,
    ip: r.ip ?? null,
    userAgent: r.userAgent ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** Section 7 — self-service profile edit. Actor may only ever edit their own
 * record; role/email/isActive stay owner-controlled via /settings/users. */
export async function updateProfile(input: UpdateProfileInput, actor: AuthedUser): Promise<ProfileData> {
  const updated = await updateUserProfileRepo(actor.id, {
    name: input.name,
    phone: input.phone?.trim() ? input.phone.trim() : null,
    image: input.image ?? null,
  });
  if (!updated) throw new AppError("NOT_FOUND", "User not found");

  await logAudit({
    actorUserId: actor.id,
    actorName: input.name,
    action: "PROFILE_UPDATED",
    entity: { kind: "auth", id: actor.id },
    summary: `${input.name} updated their profile`,
  });

  return toProfileData(updated);
}
