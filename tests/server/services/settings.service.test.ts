import { afterEach, describe, expect, it } from "vitest";

import {
  createUser,
  deactivateUser,
  reactivateUser,
  updateSettings,
  updateUserRole,
} from "@/server/services/settings.service";
import { nativeDb } from "@/database/connection";
import { UserModel } from "@/database/models/user.model";
import { AuditLogModel } from "@/database/models/audit-log.model";
import { SettingsModel } from "@/database/models/settings.model";
import { seedUser, clearAllCollections } from "../../helpers/seed-user";
import type { AuthedUser } from "@/server/auth/guards";

const PASSWORD = "Correct-Horse-Battery-Staple-9";

function actorFrom(user: { _id: unknown; name: string; email: string; role: string }): AuthedUser {
  return { id: String(user._id), name: user.name, email: user.email, role: user.role as AuthedUser["role"] };
}

afterEach(async () => {
  await clearAllCollections();
});

describe("settings.service — updateSettings (Section 5.13/7.14)", () => {
  it("owner can update settings, audited with before/after", async () => {
    const owner = await seedUser({ name: "Owner", email: `set1-${Date.now()}@example.com`, password: PASSWORD, role: "owner" });
    const actor = actorFrom(owner);

    const updated = await updateSettings(
      {
        companyName: "Acme Bookkeeping",
        largeExpenseAlertPaise: 60_000_00,
        lowBalanceDefaultPaise: 15_000_00,
        dueSoonDays: 5,
        financialYearStartMonth: 4,
        goLiveDate: null,
      },
      actor
    );

    expect(updated.companyName).toBe("Acme Bookkeeping");
    expect(updated.largeExpenseAlertPaise).toBe(60_000_00);

    const persisted = await SettingsModel.findById("global").lean();
    expect(persisted?.companyName).toBe("Acme Bookkeeping");

    const audit = await AuditLogModel.findOne({ action: "SETTINGS_UPDATED" }).lean();
    expect(audit).not.toBeNull();
  });

  it("rejects a non-owner", async () => {
    const admin = await seedUser({ name: "Admin", email: `set2-${Date.now()}@example.com`, password: PASSWORD, role: "admin" });
    const actor = actorFrom(admin);

    await expect(
      updateSettings(
        {
          companyName: "Should Fail",
          largeExpenseAlertPaise: 0,
          lowBalanceDefaultPaise: 0,
          dueSoonDays: 3,
          financialYearStartMonth: 1,
          goLiveDate: null,
        },
        actor
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("settings.service — createUser (Section 6.10/11)", () => {
  it("creates a user + authAccounts credential doc, returns the temp password once, forces password change", async () => {
    const owner = await seedUser({ name: "Owner2", email: `set3-${Date.now()}@example.com`, password: PASSWORD, role: "owner" });
    const actor = actorFrom(owner);

    const result = await createUser({ name: "New Staffer", email: `newstaff-${Date.now()}@example.com`, role: "staff" }, actor);

    expect(result.temporaryPassword.length).toBeGreaterThan(15);
    expect(result.user.mustChangePassword).toBe(true);
    expect(result.user.role).toBe("staff");

    const { database } = await nativeDb();
    const authAccount = await database.collection("authAccounts").findOne({ accountId: result.user.id });
    expect(authAccount).not.toBeNull();
    expect(authAccount?.password).not.toBe(result.temporaryPassword); // stored hashed, never plaintext

    const audit = await AuditLogModel.findOne({ action: "USER_CREATED" }).lean();
    expect(audit).not.toBeNull();
  });

  it("rejects a duplicate email", async () => {
    const owner = await seedUser({ name: "Owner3", email: `set4-${Date.now()}@example.com`, password: PASSWORD, role: "owner" });
    const actor = actorFrom(owner);
    const email = `dup-${Date.now()}@example.com`;
    await createUser({ name: "First", email, role: "staff" }, actor);

    await expect(createUser({ name: "Second", email, role: "staff" }, actor)).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });
});

describe("settings.service — last-active-owner guard (Section 14/M7 acceptance criteria)", () => {
  it("blocks demoting the last active owner", async () => {
    const owner = await seedUser({ name: "SoleOwner", email: `set5-${Date.now()}@example.com`, password: PASSWORD, role: "owner" });
    const actor = actorFrom(owner);

    await expect(updateUserRole({ userId: owner._id.toString(), role: "admin" }, actor)).rejects.toMatchObject({
      code: "VALIDATION",
    });

    const unchanged = await UserModel.findById(owner._id).lean();
    expect(unchanged?.role).toBe("owner");
  });

  it("allows demoting an owner when another active owner exists", async () => {
    const owner1 = await seedUser({ name: "Owner4", email: `set6-${Date.now()}@example.com`, password: PASSWORD, role: "owner" });
    const owner2 = await seedUser({ name: "Owner5", email: `set7-${Date.now()}@example.com`, password: PASSWORD, role: "owner" });
    const actor = actorFrom(owner1);

    const updated = await updateUserRole({ userId: owner2._id.toString(), role: "admin" }, actor);
    expect(updated.role).toBe("admin");

    const audit = await AuditLogModel.findOne({ action: "USER_ROLE_CHANGED" }).lean();
    expect(audit?.summary).toContain("owner to admin");
  });

  it("allows deactivating an owner when another active owner exists, and reactivating restores access", async () => {
    const owner1 = await seedUser({ name: "Owner6", email: `set10-${Date.now()}@example.com`, password: PASSWORD, role: "owner" });
    const owner2 = await seedUser({ name: "Owner7", email: `set11-${Date.now()}@example.com`, password: PASSWORD, role: "owner" });
    const actor = actorFrom(owner1);

    const deactivated = await deactivateUser(owner2._id.toString(), actor);
    expect(deactivated.isActive).toBe(false);

    const reactivated = await reactivateUser(owner2._id.toString(), actor);
    expect(reactivated.isActive).toBe(true);
  });

  // Self-deactivation is blocked unconditionally (even with other owners
  // present) — this is also the only way deactivateUser's own
  // last-active-owner guard would ever be reachable in practice, since
  // the actor calling it must itself be an active owner: excluding any
  // OTHER target, that actor is always counted as ≥1 remaining. The
  // guard is real defense-in-depth for this function, not dead code —
  // but the self-check is what actually fires first here.
  it("an owner cannot deactivate their own account, even with another active owner present", async () => {
    const owner1 = await seedUser({ name: "Owner8", email: `set12-${Date.now()}@example.com`, password: PASSWORD, role: "owner" });
    await seedUser({ name: "Owner9", email: `set13-${Date.now()}@example.com`, password: PASSWORD, role: "owner" });
    const actor = actorFrom(owner1);

    await expect(deactivateUser(owner1._id.toString(), actor)).rejects.toMatchObject({ code: "VALIDATION" });
  });
});
