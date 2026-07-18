"use server";

import { headers as nextHeaders } from "next/headers";

import { getAuth } from "@/server/auth/auth";
import { requireAuthenticated } from "@/server/auth/guards";
import { logAudit } from "@/server/services/audit.service";
import {
  findUserByEmail,
  incrementFailedLoginAttempts,
  lockUserUntil,
  recordSuccessfulLogin,
} from "@/server/repositories/users.repository";
import { changePasswordSchema, loginSchema } from "@/schemas/auth.schema";
import { checkRateLimit } from "@/lib/rate-limit";
import { AppError } from "@/lib/errors";
import { runAction, type ApiResult } from "@/lib/result";
import { parseActionInput } from "@/lib/validate-action";
import { LOGIN_LOCKOUT_MS, LOGIN_MAX_FAILED_ATTEMPTS } from "@/constants/finance";

async function requestMeta() {
  const requestHeaders = await nextHeaders();
  const forwardedFor = requestHeaders.get("x-forwarded-for");
  const ip = forwardedFor?.split(",")[0]?.trim() ?? requestHeaders.get("x-real-ip") ?? "unknown";
  return { requestHeaders, ip, userAgent: requestHeaders.get("user-agent") };
}

/**
 * Section 6.10 — login flow. Deliberately does NOT follow the generic
 * requireUser-first action skeleton (Section 8.2): there is no user yet.
 * Lockout/attempt-counting is implemented in our own code (not a Better
 * Auth hook) so it stays testable and independent of Better Auth's
 * internal request-lifecycle shape — see server/auth/auth.ts.
 */
export async function loginAction(
  input: unknown
): Promise<ApiResult<{ returnTo: string }>> {
  return runAction(async () => {
    const { requestHeaders, ip, userAgent } = await requestMeta();
    await checkRateLimit("auth", ip);

    const { email, password, returnTo } = parseActionInput(loginSchema, input);

    const existingUser = await findUserByEmail(email);

    if (existingUser?.lockedUntil && existingUser.lockedUntil.getTime() > Date.now()) {
      const minutes = Math.ceil((existingUser.lockedUntil.getTime() - Date.now()) / 60_000);
      throw new AppError(
        "UNAUTHORIZED",
        `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`
      );
    }

    const auth = await getAuth();
    let signedIn = false;
    if (existingUser?.isActive) {
      try {
        const result = await auth.api.signInEmail({
          body: { email, password },
          headers: requestHeaders,
          asResponse: false,
        });
        signedIn = Boolean(result?.user);
      } catch {
        signedIn = false;
      }
    }

    if (!signedIn || !existingUser) {
      if (existingUser) {
        const updated = await incrementFailedLoginAttempts(String(existingUser._id));
        if ((updated?.failedLoginAttempts ?? 0) >= LOGIN_MAX_FAILED_ATTEMPTS) {
          await lockUserUntil(String(existingUser._id), new Date(Date.now() + LOGIN_LOCKOUT_MS));
        }
        await logAudit({
          actorUserId: existingUser._id,
          actorName: existingUser.name,
          action: "LOGIN_FAILED",
          entity: { kind: "auth", id: existingUser._id },
          summary: `Failed sign-in attempt for ${existingUser.email}`,
          ip,
          userAgent,
        });
      }
      // Generic message — never reveal whether the email or the password
      // was wrong (Section 6.10 / 7.14).
      throw new AppError("UNAUTHORIZED", "Invalid email or password");
    }

    await recordSuccessfulLogin(String(existingUser._id));
    await logAudit({
      actorUserId: existingUser._id,
      actorName: existingUser.name,
      action: "LOGIN",
      entity: { kind: "auth", id: existingUser._id },
      summary: `${existingUser.name} signed in`,
      ip,
      userAgent,
    });

    return {
      returnTo: returnTo ?? "/dashboard",
    };
  });
}

export async function logoutAction(): Promise<ApiResult<null>> {
  return runAction(async () => {
    const user = await requireAuthenticated();
    const { requestHeaders, ip, userAgent } = await requestMeta();

    const auth = await getAuth();
    await auth.api.signOut({ headers: requestHeaders });

    await logAudit({
      actorUserId: user.id,
      actorName: user.name,
      action: "LOGOUT",
      entity: { kind: "auth", id: user.id },
      summary: `${user.name} signed out`,
      ip,
      userAgent,
    });

    return null;
  });
}

/**
 * Section 6.10 — revokes all other sessions on password change (handled by
 * Better Auth's `revokeSessionsOnPasswordReset`, server/auth/auth.ts).
 */
export async function changePasswordAction(input: unknown): Promise<ApiResult<null>> {
  return runAction(async () => {
    await checkRateLimit("mutation", "changePassword");
    const user = await requireAuthenticated();
    const { requestHeaders, ip, userAgent } = await requestMeta();

    const { currentPassword, newPassword } = parseActionInput(changePasswordSchema, input);

    const auth = await getAuth();
    try {
      await auth.api.changePassword({
        body: { currentPassword, newPassword, revokeOtherSessions: true },
        headers: requestHeaders,
      });
    } catch {
      throw new AppError("VALIDATION", "Current password is incorrect.", {
        fields: { currentPassword: "Incorrect password" },
      });
    }

    await logAudit({
      actorUserId: user.id,
      actorName: user.name,
      action: "PASSWORD_CHANGED",
      entity: { kind: "auth", id: user.id },
      summary: `${user.name} changed their password`,
      ip,
      userAgent,
    });

    return null;
  });
}
