import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import {
  archiveAccount,
  createAccount,
  setDefaultAccount,
  updateAccount,
} from "@/server/services/accounts.service";
import { AccountModel } from "@/database/models/account.model";
import { AuditLogModel } from "@/database/models/audit-log.model";
import { seedAccount } from "../../helpers/seed-financial";
import { seedUser, clearAllCollections } from "../../helpers/seed-user";
import type { AuthedUser } from "@/server/auth/guards";

const PASSWORD = "Correct-Horse-Battery-Staple-9";

function actorFrom(user: { _id: unknown; name: string; email: string; role: string }): AuthedUser {
  return { id: String(user._id), name: user.name, email: user.email, role: user.role as AuthedUser["role"] };
}

describe("accounts.service — createAccount (Section 6.9)", () => {
  afterEach(async () => {
    await clearAllCollections();
  });

  it("the first account ever created becomes default even without isDefault:true", async () => {
    const owner = await seedUser({ name: "Owner", email: `acc1-${Date.now()}@example.com`, password: PASSWORD, role: "owner" });
    const actor = actorFrom(owner);

    const account = await createAccount(
      { name: "HDFC Current", type: "bank", openingBalancePaise: 5_00_000_00 },
      actor
    );

    expect(account.isDefault).toBe(true);
    expect(account.currentBalancePaise).toBe(5_00_000_00);

    const audit = await AuditLogModel.findOne({ action: "ACCOUNT_CREATED" }).lean();
    expect(audit).not.toBeNull();
  });

  it("setting isDefault:true on a new account unsets every other account's default flag atomically", async () => {
    const owner = await seedUser({ name: "Owner2", email: `acc2-${Date.now()}@example.com`, password: PASSWORD, role: "owner" });
    const actor = actorFrom(owner);

    const first = await createAccount({ name: "First", type: "bank", openingBalancePaise: 0 }, actor);
    expect(first.isDefault).toBe(true);

    const second = await createAccount(
      { name: "Second", type: "cash", openingBalancePaise: 0, isDefault: true },
      actor
    );
    expect(second.isDefault).toBe(true);

    const refreshedFirst = await AccountModel.findById(first._id).lean();
    expect(refreshedFirst?.isDefault).toBe(false);
  });

  it("rejects a duplicate name among active accounts", async () => {
    const owner = await seedUser({ name: "Owner3", email: `acc3-${Date.now()}@example.com`, password: PASSWORD, role: "owner" });
    const actor = actorFrom(owner);

    await createAccount({ name: "Duplicate Name", type: "bank", openingBalancePaise: 0 }, actor);

    await expect(
      createAccount({ name: "Duplicate Name", type: "cash", openingBalancePaise: 0 }, actor)
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("accounts.service — updateAccount / opening balance (Section 6.9, edge case 23)", () => {
  afterEach(async () => {
    await clearAllCollections();
  });

  it("owner can change the opening balance, and currentBalancePaise shifts by the exact same delta", async () => {
    const owner = await seedUser({ name: "Owner4", email: `acc4-${Date.now()}@example.com`, password: PASSWORD, role: "owner" });
    const actor = actorFrom(owner);
    const account = await seedAccount({ openingBalancePaise: 10_000_00, currentBalancePaise: 15_000_00 });

    const updated = await updateAccount(
      { accountId: account._id.toString(), version: account.version, openingBalancePaise: 12_000_00 },
      actor
    );

    expect(updated.openingBalancePaise).toBe(12_000_00);
    // delta = +2,000; current was 15,000 -> 17,000
    expect(updated.currentBalancePaise).toBe(17_000_00);

    const audit = await AuditLogModel.findOne({ action: "ACCOUNT_OPENING_BALANCE_CHANGED" }).lean();
    expect(audit).not.toBeNull();
  });

  it("a non-owner cannot change the opening balance (FORBIDDEN)", async () => {
    const admin = await seedUser({ name: "Admin", email: `acc5-${Date.now()}@example.com`, password: PASSWORD, role: "admin" });
    const actor = actorFrom(admin);
    const account = await seedAccount({ openingBalancePaise: 10_000_00, currentBalancePaise: 10_000_00 });

    await expect(
      updateAccount(
        { accountId: account._id.toString(), version: account.version, openingBalancePaise: 20_000_00 },
        actor
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("a stale version raises CONFLICT instead of silently overwriting", async () => {
    const owner = await seedUser({ name: "Owner6", email: `acc6-${Date.now()}@example.com`, password: PASSWORD, role: "owner" });
    const actor = actorFrom(owner);
    const account = await seedAccount({ openingBalancePaise: 0, currentBalancePaise: 0 });

    await expect(
      updateAccount({ accountId: account._id.toString(), version: account.version + 1, name: "Renamed" }, actor)
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("accounts.service — archiveAccount (Section 14 edge case 18)", () => {
  afterEach(async () => {
    await clearAllCollections();
  });

  it("archives cleanly at a zero balance", async () => {
    const admin = await seedUser({ name: "Admin2", email: `acc7-${Date.now()}@example.com`, password: PASSWORD, role: "admin" });
    const actor = actorFrom(admin);
    const account = await seedAccount({ openingBalancePaise: 0, currentBalancePaise: 0 });

    const archived = await archiveAccount(account._id.toString(), actor);
    expect(archived.status).toBe("archived");
    expect(archived.isDefault).toBe(false);
  });

  it("blocks archiving with a nonzero balance and reports the exact shortfall", async () => {
    const admin = await seedUser({ name: "Admin3", email: `acc8-${Date.now()}@example.com`, password: PASSWORD, role: "admin" });
    const actor = actorFrom(admin);
    const account = await seedAccount({ openingBalancePaise: 5_000_00, currentBalancePaise: 5_000_00 });

    await expect(archiveAccount(account._id.toString(), actor)).rejects.toMatchObject({
      code: "NONZERO_BALANCE",
      data: { balancePaise: 5_000_00 },
    });

    const refreshed = await AccountModel.findById(account._id).lean();
    expect(refreshed?.status).toBe("active");
  });
});

describe("accounts.service — setDefaultAccount", () => {
  afterEach(async () => {
    await clearAllCollections();
  });

  it("switches the default atomically and is a no-op if already default", async () => {
    const admin = await seedUser({ name: "Admin4", email: `acc9-${Date.now()}@example.com`, password: PASSWORD, role: "admin" });
    const actor = actorFrom(admin);
    const a = await seedAccount({ name: `A-${randomUUID()}` });
    const b = await seedAccount({ name: `B-${randomUUID()}` });
    await AccountModel.findByIdAndUpdate(a._id, { $set: { isDefault: true } });

    const updatedB = await setDefaultAccount(b._id.toString(), actor);
    expect(updatedB.isDefault).toBe(true);

    const refreshedA = await AccountModel.findById(a._id).lean();
    expect(refreshedA?.isDefault).toBe(false);

    const noop = await setDefaultAccount(b._id.toString(), actor);
    expect(noop.isDefault).toBe(true);
  });
});
