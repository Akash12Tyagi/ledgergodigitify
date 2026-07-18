import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { nextCookies } from "better-auth/next-js";

import { env } from "@/config/env";
import { hashPassword, verifyPassword } from "@/lib/argon2";
import { nativeDb } from "@/database/connection";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  SESSION_COOKIE_CACHE_MAX_AGE_S,
  SESSION_MAX_AGE_S,
  SESSION_UPDATE_AGE_S,
} from "@/constants/finance";
import { assertPasswordStrength } from "@/lib/password-strength";

/**
 * Better Auth needs a concrete `Db` handle at construction time, but our
 * Mongo connection is async (database/connection.ts's singleton pattern).
 * Lazily build-and-cache the instance the same way `db()` caches the
 * connection promise, so every caller `await`s the same singleton instead
 * of opening a second connection or racing construction.
 */
declare global {
  var __betterAuth: Promise<ReturnType<typeof buildAuth>> | undefined;
}

function buildAuth(client: Awaited<ReturnType<typeof nativeDb>>["client"], database: Awaited<ReturnType<typeof nativeDb>>["database"]) {
  return betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,

    // NOTE: usePlural is deliberately NOT set. Better Auth's getModelName
    // (node_modules/@better-auth/core/dist/db/adapter/get-model-name.mjs)
    // appends an extra "s" to ANY model whose resolved modelName differs
    // from its logical key — which is true for every model below, since
    // all four are explicitly renamed. Combining usePlural:true with
    // explicit modelName overrides double-pluralizes every collection
    // name ("users" -> "userss", "authAccounts" -> "authAccountss"),
    // silently querying collections that don't exist. Each modelName
    // below is already the exact physical collection name we want.
    database: mongodbAdapter(database, { client }),

    // Collection naming decision (see docs/IMPLEMENTATION_PLAN.md): Better
    // Auth's own "account" model is renamed to avoid colliding with the
    // business `accounts` collection (Section 5.5, bank/cash/UPI ledger
    // accounts). `user` is mapped onto the spec's `users` collection
    // (Section 5.1) with our role/lockout fields as additional fields, so
    // it is the single source of truth for identity + role (Law 1).
    user: {
      modelName: "users",
      additionalFields: {
        role: { type: "string", input: false, defaultValue: "staff" },
        isActive: { type: "boolean", input: false, defaultValue: true },
        failedLoginAttempts: { type: "number", input: false, defaultValue: 0 },
        lockedUntil: { type: "date", required: false, input: false },
        lastLoginAt: { type: "date", required: false, input: false },
        mustChangePassword: { type: "boolean", input: false, defaultValue: false },
      },
    },
    account: { modelName: "authAccounts" },
    verification: { modelName: "verifications" },

    // Section 11 — exact session config (the "no random logout" section).
    session: {
      modelName: "sessions",
      expiresIn: SESSION_MAX_AGE_S,
      updateAge: SESSION_UPDATE_AGE_S,
      cookieCache: { enabled: true, maxAge: SESSION_COOKIE_CACHE_MAX_AGE_S },
    },

    advanced: {
      useSecureCookies: env.NODE_ENV === "production",
      defaultCookieAttributes: { sameSite: "lax", httpOnly: true, path: "/" },
    },

    // Internal tool — no public signup (Section 11); owner/admin create
    // users via /settings/users (Section 7.13), never self-registration.
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      requireEmailVerification: false,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      revokeSessionsOnPasswordReset: true,
      autoSignIn: false,
      // Section 10.1 — argon2id, not Better Auth's scrypt default; Section
      // 10.1 also requires zxcvbn score ≥ 3 for any new password, enforced
      // here since every "set a password" flow (signup, change, reset,
      // admin-created temp password) funnels through this one function.
      password: {
        hash: async (password: string) => {
          assertPasswordStrength(password);
          return hashPassword(password);
        },
        verify: async ({ hash, password }: { hash: string; password: string }) =>
          verifyPassword(hash, password),
      },
    },

    plugins: [nextCookies()],
  });
}

export async function getAuth() {
  globalThis.__betterAuth ??= nativeDb().then(({ client, database }) =>
    buildAuth(client, database)
  );
  return globalThis.__betterAuth;
}

export type Auth = Awaited<ReturnType<typeof getAuth>>;
