import { headers as nextHeaders } from "next/headers";

import { getAuth } from "@/server/auth/auth";
import { ROLE_RANK, type UserRole } from "@/constants/roles";
import { findUserById } from "@/server/repositories/users.repository";
import { AppError } from "@/lib/errors";

export type AuthedUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
};

/**
 * Reads the session cookie (Better Auth) and re-reads the user's role fresh
 * from the `users` collection on every call — never trusts the role on the
 * session/cookie-cache payload. This is what makes edge case 40 (role
 * downgraded mid-session) work: the very next request re-derives FORBIDDEN
 * from the database, not from a claim that could be up to
 * SESSION_COOKIE_CACHE_MAX_AGE_S stale.
 *
 * @param minRoleOrList Either a minimum role rank ("at least this role",
 *   covers every row of the Section 1.2 permission matrix) or an explicit
 *   allow-list of roles for anything the matrix didn't anticipate.
 */
export async function requireUser(
  minRoleOrList: UserRole | UserRole[]
): Promise<AuthedUser> {
  const auth = await getAuth();
  const requestHeaders = await nextHeaders();
  const session = await auth.api.getSession({ headers: requestHeaders });

  if (!session?.user) {
    throw new AppError("UNAUTHORIZED", "You must be signed in to do that.");
  }

  const user = await findUserById(session.user.id);
  if (!user || !user.isActive) {
    throw new AppError("UNAUTHORIZED", "This account is no longer active.");
  }

  const role = user.role as UserRole;
  const allowed = Array.isArray(minRoleOrList)
    ? minRoleOrList.includes(role)
    : ROLE_RANK[role] >= ROLE_RANK[minRoleOrList];

  if (!allowed) {
    throw new AppError(
      "FORBIDDEN",
      "You don't have permission to do that."
    );
  }

  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    role,
  };
}

/** Authentication-only check (any active role), for read paths that every
 * signed-in user may see (Section 1.2 "View everything" — all roles). */
export async function requireAuthenticated(): Promise<AuthedUser> {
  return requireUser("viewer");
}
