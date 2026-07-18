import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const headersState = vi.hoisted(() => ({
  current: new Headers({ "x-forwarded-for": "203.0.113.10" }) as Headers,
}));

vi.mock("next/headers", () => ({
  headers: async () => headersState.current,
}));

const { loginAction } = await import("@/features/auth/actions");
const { seedUser, clearAllCollections } = await import("../../helpers/seed-user");
const { UserModel } = await import("@/database/models/user.model");
const { AuditLogModel } = await import("@/database/models/audit-log.model");
const { LOGIN_MAX_FAILED_ATTEMPTS } = await import("@/constants/finance");

const PASSWORD = "Correct-Horse-Battery-Staple-9";

// Section 10.2 / 6.10 / 7.14 — 5 failed attempts locks the account for 15
// minutes; the UI message is always generic (never reveals which field was
// wrong); every attempt is audit-logged.
describe("loginAction lockout", () => {
  beforeEach(() => {
    headersState.current = new Headers({ "x-forwarded-for": `203.0.113.${Math.floor(Math.random() * 250)}` });
  });

  afterEach(async () => {
    await clearAllCollections();
  });

  it("returns a generic error and never reveals whether the email exists", async () => {
    const unknownResult = await loginAction({
      email: "nobody@example.com",
      password: "whatever-Password-1",
    });
    expect(unknownResult.success).toBe(false);
    const genericMessage = "Invalid email or password";
    if (!unknownResult.success) {
      expect(unknownResult.message).toBe(genericMessage);
    }

    const user = await seedUser({
      name: "Wrong Password User",
      email: `wrongpw-${Date.now()}@example.com`,
      password: PASSWORD,
      role: "staff",
    });
    const wrongPasswordResult = await loginAction({
      email: user.email,
      password: "not-the-right-password",
    });
    expect(wrongPasswordResult.success).toBe(false);
    if (!wrongPasswordResult.success) {
      // Identical message for "no such user" and "wrong password".
      expect(wrongPasswordResult.message).toBe(genericMessage);
    }
  });

  it("locks the account after 5 failed attempts and audit-logs each one", async () => {
    const user = await seedUser({
      name: "Lockout User",
      email: `lockout-${Date.now()}@example.com`,
      password: PASSWORD,
      role: "staff",
    });

    // Each attempt uses a distinct source IP so this test isolates the
    // per-ACCOUNT lockout mechanism from the separate per-IP rate limiter
    // (Section 10.2 — both are 5/min, and both are real, simultaneously
    // active defenses; tests/lib/rate-limit.test.ts covers the IP one).
    for (let i = 0; i < LOGIN_MAX_FAILED_ATTEMPTS; i++) {
      headersState.current = new Headers({ "x-forwarded-for": `198.51.100.${i}` });
      const result = await loginAction({ email: user.email, password: "wrong-password" });
      expect(result.success).toBe(false);
    }

    const updated = await UserModel.findById(user._id).lean();
    expect(updated?.failedLoginAttempts).toBe(LOGIN_MAX_FAILED_ATTEMPTS);
    expect(updated?.lockedUntil).not.toBeNull();
    expect(updated!.lockedUntil!.getTime()).toBeGreaterThan(Date.now());

    // The 6th attempt — even with the CORRECT password — is blocked by the
    // lockout, with a message stating how long to wait.
    headersState.current = new Headers({ "x-forwarded-for": "198.51.100.99" });
    const lockedResult = await loginAction({ email: user.email, password: PASSWORD });
    expect(lockedResult.success).toBe(false);
    if (!lockedResult.success) {
      expect(lockedResult.message).toMatch(/too many attempts/i);
    }

    const failedAudits = await AuditLogModel.find({
      actorUserId: user._id,
      action: "LOGIN_FAILED",
    }).lean();
    expect(failedAudits.length).toBe(LOGIN_MAX_FAILED_ATTEMPTS);
  });

  it("resets the failed-attempt counter on a successful login", async () => {
    const user = await seedUser({
      name: "Reset User",
      email: `reset-${Date.now()}@example.com`,
      password: PASSWORD,
      role: "staff",
    });

    await loginAction({ email: user.email, password: "wrong-1" });
    await loginAction({ email: user.email, password: "wrong-2" });

    const midway = await UserModel.findById(user._id).lean();
    expect(midway?.failedLoginAttempts).toBe(2);

    const success = await loginAction({ email: user.email, password: PASSWORD });
    expect(success.success).toBe(true);

    const after = await UserModel.findById(user._id).lean();
    expect(after?.failedLoginAttempts).toBe(0);
    expect(after?.lockedUntil).toBeNull();
    expect(after?.lastLoginAt).not.toBeNull();

    const loginAudit = await AuditLogModel.findOne({
      actorUserId: user._id,
      action: "LOGIN",
    }).lean();
    expect(loginAudit).not.toBeNull();
  });

  it("blocks a deactivated user with the same generic message", async () => {
    const user = await seedUser({
      name: "Inactive User",
      email: `inactive-${Date.now()}@example.com`,
      password: PASSWORD,
      role: "staff",
      isActive: false,
    });

    const result = await loginAction({ email: user.email, password: PASSWORD });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.message).toBe("Invalid email or password");
    }
  });
});
