import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import { createCredit, listCredits, reverseCredit } from "@/server/services/credits.service";
import { AccountModel } from "@/database/models/account.model";
import { CreditModel } from "@/database/models/credit.model";
import { AuditLogModel } from "@/database/models/audit-log.model";
import { seedAccount } from "../../helpers/seed-financial";
import { seedUser, clearAllCollections } from "../../helpers/seed-user";
import type { AuthedUser } from "@/server/auth/guards";

const PASSWORD = "Correct-Horse-Battery-Staple-9";

function actorFrom(user: { _id: unknown; name: string; email: string; role: string }): AuthedUser {
  return { id: String(user._id), name: user.name, email: user.email, role: user.role as AuthedUser["role"] };
}

describe("credits.service — createCredit (Section 6.4)", () => {
  afterEach(async () => {
    await clearAllCollections();
  });

  it("increments the account balance and records the credit + ledger entry", async () => {
    const staff = await seedUser({ name: "Staff", email: `cred1-${Date.now()}@example.com`, password: PASSWORD, role: "staff" });
    const actor = actorFrom(staff);
    const account = await seedAccount({ openingBalancePaise: 0, currentBalancePaise: 0 });

    const result = await createCredit(
      {
        amountPaise: 10_000_00,
        source: "Owner",
        reason: "Capital injection",
        category: "owner_capital",
        accountId: account._id.toString(),
        receivedAt: new Date("2026-07-05T00:00:00.000Z"),
        idempotencyKey: randomUUID(),
      },
      actor
    );

    expect(result.accountNewBalance).toBe(10_000_00);
    const updatedAccount = await AccountModel.findById(account._id).lean();
    expect(updatedAccount?.currentBalancePaise).toBe(10_000_00);

    const audit = await AuditLogModel.findOne({ action: "CREDIT_CREATED" }).lean();
    expect(audit).not.toBeNull();
  });

  it("a double-submit with the same idempotencyKey replays instead of double-applying", async () => {
    const staff = await seedUser({ name: "Staff2", email: `cred2-${Date.now()}@example.com`, password: PASSWORD, role: "staff" });
    const actor = actorFrom(staff);
    const account = await seedAccount({ openingBalancePaise: 0, currentBalancePaise: 0 });
    const idempotencyKey = randomUUID();

    const input = {
      amountPaise: 2_000_00,
      source: "Bank",
      reason: "Interest",
      category: "interest" as const,
      accountId: account._id.toString(),
      receivedAt: new Date("2026-07-05T00:00:00.000Z"),
      idempotencyKey,
    };

    await createCredit(input, actor);
    await expect(createCredit(input, actor)).rejects.toMatchObject({ code: "IDEMPOTENT_REPLAY" });

    const updatedAccount = await AccountModel.findById(account._id).lean();
    expect(updatedAccount?.currentBalancePaise).toBe(2_000_00);
  });
});

describe("credits.service — listCredits date window", () => {
  afterEach(async () => {
    await clearAllCollections();
  });

  async function seedCreditOn(receivedAt: Date) {
    const staff = await seedUser({
      name: "Staff",
      email: `credlist-${randomUUID()}@example.com`,
      password: PASSWORD,
      role: "staff",
    });
    const account = await seedAccount({ openingBalancePaise: 0, currentBalancePaise: 0 });
    await createCredit(
      {
        amountPaise: 19_000_00,
        source: "Previous payment",
        reason: "Backdated settlement",
        category: "other",
        accountId: account._id.toString(),
        receivedAt,
        idempotencyKey: randomUUID(),
      },
      actorFrom(staff)
    );
  }

  // The reported bug: a credit recorded today but DATED outside the viewed
  // period disappeared behind "No credits yet", which is what a failed save
  // looks like too. The list now hands the empty state enough to say where
  // the row actually went.
  it("reports what the window hid when the window matches nothing", async () => {
    await seedCreditOn(new Date("2026-04-22T18:30:00.000Z")); // 23 Apr 2026 IST

    const result = await listCredits({
      status: "active",
      receivedFrom: new Date("2026-07-31T18:30:00.000Z"), // August 2026 IST
      receivedTo: new Date("2026-08-31T18:30:00.000Z"),
    });

    expect(result.total).toBe(0);
    expect(result.outsideWindow).toEqual({ total: 1, earliest: "2026-04-23", latest: "2026-04-23" });
  });

  it("leaves it null when the window has rows, and when there are none at all", async () => {
    const emptyDb = await listCredits({
      status: "active",
      receivedFrom: new Date("2026-07-31T18:30:00.000Z"),
      receivedTo: new Date("2026-08-31T18:30:00.000Z"),
    });
    expect(emptyDb.outsideWindow).toBeNull();

    await seedCreditOn(new Date("2026-08-09T18:30:00.000Z")); // 10 Aug 2026 IST
    const inWindow = await listCredits({
      status: "active",
      receivedFrom: new Date("2026-07-31T18:30:00.000Z"),
      receivedTo: new Date("2026-08-31T18:30:00.000Z"),
    });
    expect(inWindow.total).toBe(1);
    expect(inWindow.outsideWindow).toBeNull();
  });

  it("respects the non-date filters — a reversed credit is not what an active list is missing", async () => {
    await seedCreditOn(new Date("2026-04-22T18:30:00.000Z"));
    const credit = await CreditModel.findOne({}).lean();
    await CreditModel.updateOne({ _id: credit!._id }, { $set: { status: "reversed" } });

    const result = await listCredits({
      status: "active",
      receivedFrom: new Date("2026-07-31T18:30:00.000Z"),
      receivedTo: new Date("2026-08-31T18:30:00.000Z"),
    });

    expect(result.outsideWindow).toBeNull();
  });
});

describe("credits.service — reverseCredit", () => {
  afterEach(async () => {
    await clearAllCollections();
  });

  it("restores the account balance (subtracts) and marks the credit reversed", async () => {
    const owner = await seedUser({ name: "Owner", email: `cred3-${Date.now()}@example.com`, password: PASSWORD, role: "owner" });
    const actor = actorFrom(owner);
    const account = await seedAccount({ openingBalancePaise: 0, currentBalancePaise: 0 });

    const created = await createCredit(
      {
        amountPaise: 5_000_00,
        source: "Loan",
        reason: "Short-term loan",
        category: "loan",
        accountId: account._id.toString(),
        receivedAt: new Date("2026-07-05T00:00:00.000Z"),
        idempotencyKey: randomUUID(),
      },
      actor
    );

    const reversed = await reverseCredit(
      { creditId: created.credit._id.toString(), reason: "Loan cancelled", idempotencyKey: randomUUID() },
      actor
    );

    expect(reversed.accountNewBalance).toBe(0);
    const updatedCredit = await CreditModel.findById(created.credit._id).lean();
    expect(updatedCredit?.status).toBe("reversed");
  });

  it("reversing an already-reversed credit is a CONFLICT", async () => {
    const owner = await seedUser({ name: "Owner2", email: `cred4-${Date.now()}@example.com`, password: PASSWORD, role: "owner" });
    const actor = actorFrom(owner);
    const account = await seedAccount({ openingBalancePaise: 0, currentBalancePaise: 0 });

    const created = await createCredit(
      {
        amountPaise: 1_000_00,
        source: "Refund",
        reason: "Vendor refund",
        category: "refund",
        accountId: account._id.toString(),
        receivedAt: new Date("2026-07-05T00:00:00.000Z"),
        idempotencyKey: randomUUID(),
      },
      actor
    );

    await reverseCredit(
      { creditId: created.credit._id.toString(), reason: "First reversal", idempotencyKey: randomUUID() },
      actor
    );

    await expect(
      reverseCredit(
        { creditId: created.credit._id.toString(), reason: "Second attempt", idempotencyKey: randomUUID() },
        actor
      )
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
