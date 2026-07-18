import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import { createExpense, reverseExpense } from "@/server/services/expenses.service";
import { AccountModel } from "@/database/models/account.model";
import { ExpenseModel } from "@/database/models/expense.model";
import { NotificationModel } from "@/database/models/notification.model";
import { AuditLogModel } from "@/database/models/audit-log.model";
import { LARGE_EXPENSE_ALERT_PAISE_DEFAULT, LOW_BALANCE_DEFAULT_PAISE_DEFAULT } from "@/constants/finance";
import { seedAccount } from "../../helpers/seed-financial";
import { seedUser, clearAllCollections } from "../../helpers/seed-user";
import type { AuthedUser } from "@/server/auth/guards";

const PASSWORD = "Correct-Horse-Battery-Staple-9";

function actorFrom(user: { _id: unknown; name: string; email: string; role: string }): AuthedUser {
  return { id: String(user._id), name: user.name, email: user.email, role: user.role as AuthedUser["role"] };
}

describe("expenses.service — createExpense (Section 6.3)", () => {
  afterEach(async () => {
    await clearAllCollections();
  });

  it("decrements the account balance and records the expense + ledger entry", async () => {
    const staff = await seedUser({ name: "Staff", email: `exp1-${Date.now()}@example.com`, password: PASSWORD, role: "staff" });
    const actor = actorFrom(staff);
    const account = await seedAccount({ openingBalancePaise: 50_000_00, currentBalancePaise: 50_000_00 });

    const result = await createExpense(
      {
        amountPaise: 5_000_00,
        reason: "Office rent",
        paidToEntity: "Landlord",
        category: "rent",
        accountId: account._id.toString(),
        spentAt: new Date("2026-07-05T00:00:00.000Z"),
        idempotencyKey: randomUUID(),
      },
      actor
    );

    expect(result.accountNewBalance).toBe(45_000_00);
    const updatedAccount = await AccountModel.findById(account._id).lean();
    expect(updatedAccount?.currentBalancePaise).toBe(45_000_00);

    const audit = await AuditLogModel.findOne({ action: "EXPENSE_CREATED" }).lean();
    expect(audit).not.toBeNull();
  });

  it("blocks a non-owner from pushing the account negative (INSUFFICIENT_BALANCE)", async () => {
    const staff = await seedUser({ name: "Staff2", email: `exp2-${Date.now()}@example.com`, password: PASSWORD, role: "staff" });
    const actor = actorFrom(staff);
    const account = await seedAccount({ openingBalancePaise: 1_000_00, currentBalancePaise: 1_000_00 });

    await expect(
      createExpense(
        {
          amountPaise: 5_000_00,
          reason: "Big purchase",
          paidToEntity: "Vendor",
          category: "vendor",
          accountId: account._id.toString(),
          spentAt: new Date("2026-07-05T00:00:00.000Z"),
          idempotencyKey: randomUUID(),
        },
        actor
      )
    ).rejects.toMatchObject({
      code: "INSUFFICIENT_BALANCE",
      data: { balancePaise: 1_000_00, shortfallPaise: 4_000_00 },
    });

    const unchangedAccount = await AccountModel.findById(account._id).lean();
    expect(unchangedAccount?.currentBalancePaise).toBe(1_000_00);
  });

  it("an owner can override the insufficient-balance block, and the override is flagged + audited", async () => {
    const owner = await seedUser({ name: "Owner", email: `exp3-${Date.now()}@example.com`, password: PASSWORD, role: "owner" });
    const actor = actorFrom(owner);
    const account = await seedAccount({ openingBalancePaise: 1_000_00, currentBalancePaise: 1_000_00 });

    const result = await createExpense(
      {
        amountPaise: 5_000_00,
        reason: "Emergency purchase",
        paidToEntity: "Vendor",
        category: "vendor",
        accountId: account._id.toString(),
        spentAt: new Date("2026-07-05T00:00:00.000Z"),
        overrideNegativeBalance: true,
        idempotencyKey: randomUUID(),
      },
      actor
    );

    expect(result.accountNewBalance).toBe(-4_000_00);

    const expenseDoc = await ExpenseModel.findById(result.expense._id).lean();
    expect(expenseDoc?.overrideNegativeBalance).toBe(true);

    const audit = await AuditLogModel.findOne({ action: "EXPENSE_CREATED" }).lean();
    expect(audit?.summary).toContain("override");
  });

  it("a non-owner's overrideNegativeBalance flag is silently ignored, not honored", async () => {
    const staff = await seedUser({ name: "Staff3", email: `exp4-${Date.now()}@example.com`, password: PASSWORD, role: "staff" });
    const actor = actorFrom(staff);
    const account = await seedAccount({ openingBalancePaise: 1_000_00, currentBalancePaise: 1_000_00 });

    await expect(
      createExpense(
        {
          amountPaise: 5_000_00,
          reason: "Attempted override",
          paidToEntity: "Vendor",
          category: "vendor",
          accountId: account._id.toString(),
          spentAt: new Date("2026-07-05T00:00:00.000Z"),
          overrideNegativeBalance: true,
          idempotencyKey: randomUUID(),
        },
        actor
      )
    ).rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE" });
  });

  it("fires a LARGE_EXPENSE notification at/above the threshold", async () => {
    const staff = await seedUser({ name: "Staff4", email: `exp5-${Date.now()}@example.com`, password: PASSWORD, role: "staff" });
    const actor = actorFrom(staff);
    const account = await seedAccount({
      openingBalancePaise: LARGE_EXPENSE_ALERT_PAISE_DEFAULT * 2,
      currentBalancePaise: LARGE_EXPENSE_ALERT_PAISE_DEFAULT * 2,
    });

    const result = await createExpense(
      {
        amountPaise: LARGE_EXPENSE_ALERT_PAISE_DEFAULT,
        reason: "Large payout",
        paidToEntity: "Vendor",
        category: "vendor",
        accountId: account._id.toString(),
        spentAt: new Date("2026-07-05T00:00:00.000Z"),
        idempotencyKey: randomUUID(),
      },
      actor
    );

    const notification = await NotificationModel.findOne({
      type: "LARGE_EXPENSE",
      dedupeKey: `EXP:${result.expense._id.toString()}`,
    }).lean();
    expect(notification).not.toBeNull();
  });

  it("fires a LOW_BALANCE notification when the resulting balance drops below threshold", async () => {
    const staff = await seedUser({ name: "Staff5", email: `exp6-${Date.now()}@example.com`, password: PASSWORD, role: "staff" });
    const actor = actorFrom(staff);
    const opening = LOW_BALANCE_DEFAULT_PAISE_DEFAULT + 100_00;
    const account = await seedAccount({ openingBalancePaise: opening, currentBalancePaise: opening });

    await createExpense(
      {
        amountPaise: 200_00, // leaves balance below LOW_BALANCE_DEFAULT_PAISE_DEFAULT
        reason: "Small purchase",
        paidToEntity: "Vendor",
        category: "misc",
        accountId: account._id.toString(),
        spentAt: new Date("2026-07-05T00:00:00.000Z"),
        idempotencyKey: randomUUID(),
      },
      actor
    );

    const notification = await NotificationModel.findOne({ type: "LOW_BALANCE" }).lean();
    expect(notification).not.toBeNull();
  });

  it("a double-submit with the same idempotencyKey replays instead of double-applying", async () => {
    const staff = await seedUser({ name: "Staff6", email: `exp7-${Date.now()}@example.com`, password: PASSWORD, role: "staff" });
    const actor = actorFrom(staff);
    const account = await seedAccount({ openingBalancePaise: 10_000_00, currentBalancePaise: 10_000_00 });
    const idempotencyKey = randomUUID();

    const input = {
      amountPaise: 1_000_00,
      reason: "Repeat test",
      paidToEntity: "Vendor",
      category: "misc" as const,
      accountId: account._id.toString(),
      spentAt: new Date("2026-07-05T00:00:00.000Z"),
      idempotencyKey,
    };

    await createExpense(input, actor);
    await expect(createExpense(input, actor)).rejects.toMatchObject({ code: "IDEMPOTENT_REPLAY" });

    const updatedAccount = await AccountModel.findById(account._id).lean();
    expect(updatedAccount?.currentBalancePaise).toBe(9_000_00); // applied once
  });
});

describe("expenses.service — reverseExpense", () => {
  afterEach(async () => {
    await clearAllCollections();
  });

  it("restores the account balance and marks the expense reversed", async () => {
    const owner = await seedUser({ name: "Owner2", email: `exp8-${Date.now()}@example.com`, password: PASSWORD, role: "owner" });
    const actor = actorFrom(owner);
    const account = await seedAccount({ openingBalancePaise: 10_000_00, currentBalancePaise: 10_000_00 });

    const created = await createExpense(
      {
        amountPaise: 3_000_00,
        reason: "To be reversed",
        paidToEntity: "Vendor",
        category: "misc",
        accountId: account._id.toString(),
        spentAt: new Date("2026-07-05T00:00:00.000Z"),
        idempotencyKey: randomUUID(),
      },
      actor
    );

    const reversed = await reverseExpense(
      { expenseId: created.expense._id.toString(), reason: "Wrong vendor", idempotencyKey: randomUUID() },
      actor
    );

    expect(reversed.accountNewBalance).toBe(10_000_00);
    const updatedExpense = await ExpenseModel.findById(created.expense._id).lean();
    expect(updatedExpense?.status).toBe("reversed");
    expect(updatedExpense?.reversedReason).toBe("Wrong vendor");
  });

  it("reversing an already-reversed expense is a CONFLICT", async () => {
    const owner = await seedUser({ name: "Owner3", email: `exp9-${Date.now()}@example.com`, password: PASSWORD, role: "owner" });
    const actor = actorFrom(owner);
    const account = await seedAccount({ openingBalancePaise: 10_000_00, currentBalancePaise: 10_000_00 });

    const created = await createExpense(
      {
        amountPaise: 1_000_00,
        reason: "Double reverse test",
        paidToEntity: "Vendor",
        category: "misc",
        accountId: account._id.toString(),
        spentAt: new Date("2026-07-05T00:00:00.000Z"),
        idempotencyKey: randomUUID(),
      },
      actor
    );

    await reverseExpense(
      { expenseId: created.expense._id.toString(), reason: "First reversal", idempotencyKey: randomUUID() },
      actor
    );

    await expect(
      reverseExpense(
        { expenseId: created.expense._id.toString(), reason: "Second attempt", idempotencyKey: randomUUID() },
        actor
      )
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
