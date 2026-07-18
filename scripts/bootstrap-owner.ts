/**
 * Section 6.10 / 17.3 — creates the first owner user from env-provided
 * email + password, only if the `users` collection is empty. Run once,
 * locally, with production env vars, per the go-live runbook (Section 17.3
 * step 2): `npx tsx scripts/bootstrap-owner.ts`.
 *
 * This bypasses Better Auth's public sign-up endpoint on purpose —
 * `emailAndPassword.disableSignUp` is `true` (Section 11: internal tool, no
 * public signup) and that flag blocks `auth.api.signUpEmail` too, since
 * it's the same endpoint under the hood. Writing the user + credential
 * documents directly is the only bootstrap path, matching exactly what
 * Better Auth's own sign-up route writes (verified against
 * node_modules/better-auth/dist/api/routes/sign-up.mjs): a `users` document
 * plus an `authAccounts` document with { providerId: "credential",
 * accountId: userId, password: argon2idHash }.
 */
import { config as loadDotenv } from "dotenv";
import { z } from "zod";

// Mirrors Next.js's own precedence for local dev: .env.local overrides
// .env. In production (Vercel), env vars are already in process.env and
// these files don't exist, so both calls are harmless no-ops. This MUST
// run before config/env.ts is ever imported (even transitively), which is
// why everything below is a dynamic import rather than a static one —
// static imports are hoisted and would evaluate config/env.ts's
// boot-time validation before these calls ever ran.
loadDotenv({ path: ".env" });
loadDotenv({ path: ".env.local", override: true });

const bootstrapEnvSchema = z.object({
  BOOTSTRAP_OWNER_EMAIL: z.email(),
  BOOTSTRAP_OWNER_PASSWORD: z.string().min(10),
  BOOTSTRAP_OWNER_NAME: z.string().min(2).max(80),
});

async function main() {
  const { db, nativeDb } = await import("@/database/connection");
  const { UserModel } = await import("@/database/models/user.model");
  const { assertPasswordStrength } = await import("@/lib/password-strength");
  const { hashPassword } = await import("@/lib/argon2");

  const env = bootstrapEnvSchema.parse(process.env);

  await db();

  const existingCount = await UserModel.countDocuments({});
  if (existingCount > 0) {
    console.log(
      `users collection already has ${existingCount} document(s) — refusing to bootstrap. ` +
        "Use /settings/users to invite additional users instead."
    );
    process.exitCode = 0;
    return;
  }

  assertPasswordStrength(env.BOOTSTRAP_OWNER_PASSWORD);
  const passwordHash = await hashPassword(env.BOOTSTRAP_OWNER_PASSWORD);

  const owner = await UserModel.create({
    name: env.BOOTSTRAP_OWNER_NAME,
    email: env.BOOTSTRAP_OWNER_EMAIL.toLowerCase().trim(),
    emailVerified: true,
    role: "owner",
    isActive: true,
    failedLoginAttempts: 0,
    lockedUntil: null,
    lastLoginAt: null,
    mustChangePassword: true,
  });

  const { database } = await nativeDb();
  await database.collection("authAccounts").insertOne({
    providerId: "credential",
    accountId: owner._id.toString(),
    userId: owner._id,
    password: passwordHash,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  console.log(`Owner created: ${owner.email} (id ${owner._id.toString()}).`);
  console.log("mustChangePassword is set — they will be forced to change it on first login.");
  process.exitCode = 0;
}

main()
  .catch((error) => {
    console.error("bootstrap-owner failed:", error);
    process.exitCode = 1;
  })
  .finally(() => {
    process.exit(process.exitCode ?? 0);
  });
