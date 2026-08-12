import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import {
  createExpenseTemplate,
  pauseExpenseTemplate,
  resumeExpenseTemplate,
  runExpenseRollover,
} from "@/server/services/expense-templates.service";
import {
  approveExpense,
  cancelPendingExpense,
  createExpense,
  updatePendingExpense,
} from "@/server/services/expenses.service";
import { AccountModel } from "@/database/models/account.model";
import { ExpenseModel } from "@/database/models/expense.model";
import { ExpenseTemplateModel } from "@/database/models/expense-template.model";
import { TransactionModel } from "@/database/models/transaction.model";
import { AuditLogModel } from "@/database/models/audit-log.model";
import { seedAccount } from "../../helpers/seed-financial";
import { seedUser, clearAllCollections } from "../../helpers/seed-user";
import type { AuthedUser } from "@/server/auth/guards";

const PASSWORD = "Correct-Horse-Battery-Staple-9";
const SYSTEM_ID = "000000000000000000000000";

function actorFrom(user: { _id: unknown; name: string; email: string; role: string }): AuthedUser {
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role as AuthedUser["role"],
  };
}

async function seedActor(role: AuthedUser["role"], label: string) {
  const user = await seedUser({
    name: label,
    email: `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
    password: PASSWORD,
    role,
  });
  return actorFrom(user);
}

/** IST midnight for a plain calendar date, matching lib/dates.ts's convention. */
function istDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000+05:30`);
}

async function makeTemplate(
  actor: AuthedUser,
  accountId: string,
  overrides: { startDate?: Date; amountPaise?: number } = {}
) {
  const result = await createExpenseTemplate(
    {
      amountPaise: overrides.amountPaise ?? 50_000_00,
      reason: "Monthly salary",
      paidToEntity: "Ramesh Kumar",
      category: "salary",
      accountId,
      startDate: overrides.startDate ?? istDate("2026-01-10"),
      idempotencyKey: randomUUID(),
    },
    actor
  );
  return result.template;
}

describe("expense-templates — runExpenseRollover (Section 6.3.4)", () => {
  afterEach(async () => {
    await clearAllCollections();
  });

  it("raises a PENDING expense and moves no money at all", async () => {
    const admin = await seedActor("admin", "admin-raise");
    const account = await seedAccount({
      openingBalancePaise: 100_000_00,
      currentBalancePaise: 100_000_00,
    });
    await makeTemplate(admin, account._id.toString());

    const result = await runExpenseRollover(SYSTEM_ID, "System");

    expect(result.created).toBeGreaterThan(0);
    const raised = await ExpenseModel.find({ status: "pending" }).lean();
    expect(raised.length).toBeGreaterThan(0);
    expect(raised[0]?.transactionId).toBeNull();
    expect(raised[0]?.generatedBy).toBe("rollover");

    // The whole point: a scheduled expense must not drain an account on its
    // own, so neither the balance nor the ledger may have moved.
    const unchanged = await AccountModel.findById(account._id).lean();
    expect(unchanged?.currentBalancePaise).toBe(100_000_00);
    expect(await TransactionModel.countDocuments({})).toBe(0);
  });

  it("is idempotent — running five times raises each period exactly once", async () => {
    const admin = await seedActor("admin", "admin-idem");
    const account = await seedAccount({ currentBalancePaise: 100_000_00 });
    await makeTemplate(admin, account._id.toString(), { startDate: istDate("2026-03-10") });

    await runExpenseRollover(SYSTEM_ID, "System");
    const afterFirst = await ExpenseModel.countDocuments({});

    for (let i = 0; i < 4; i++) await runExpenseRollover(SYSTEM_ID, "System");

    expect(await ExpenseModel.countDocuments({})).toBe(afterFirst);
  });

  it("backfills every missed period when the template started long ago", async () => {
    const admin = await seedActor("admin", "admin-catchup");
    const account = await seedAccount({ currentBalancePaise: 100_000_00 });
    // Six months back, so catch-up has several periods to raise.
    const start = new Date();
    start.setMonth(start.getMonth() - 6);
    await makeTemplate(admin, account._id.toString(), { startDate: start });

    await runExpenseRollover(SYSTEM_ID, "System");

    const raised = await ExpenseModel.countDocuments({ status: "pending" });
    expect(raised).toBeGreaterThanOrEqual(6);

    // Each period is distinct — no duplicated periodStart.
    const rows = await ExpenseModel.find({}).lean();
    const starts = rows.map((r) => r.periodStart?.toISOString());
    expect(new Set(starts).size).toBe(starts.length);
  });

  it("raises nothing for a template whose start date is still in the future", async () => {
    const admin = await seedActor("admin", "admin-future");
    const account = await seedAccount({ currentBalancePaise: 100_000_00 });
    const future = new Date();
    future.setMonth(future.getMonth() + 2);
    await makeTemplate(admin, account._id.toString(), { startDate: future });

    const result = await runExpenseRollover(SYSTEM_ID, "System");

    expect(result.created).toBe(0);
    expect(await ExpenseModel.countDocuments({})).toBe(0);
  });

  it("raises nothing while paused", async () => {
    const admin = await seedActor("admin", "admin-paused");
    const account = await seedAccount({ currentBalancePaise: 100_000_00 });
    const template = await makeTemplate(admin, account._id.toString());

    await pauseExpenseTemplate(
      { templateId: template._id.toString(), reason: "Office closed" },
      admin
    );
    const result = await runExpenseRollover(SYSTEM_ID, "System");

    expect(result.scanned).toBe(0);
    expect(result.created).toBe(0);
  });

  it("does NOT backfill the paused stretch after resuming", async () => {
    const admin = await seedActor("admin", "admin-resume");
    const account = await seedAccount({ currentBalancePaise: 100_000_00 });
    const start = new Date();
    start.setMonth(start.getMonth() - 6);
    const template = await makeTemplate(admin, account._id.toString(), { startDate: start });

    // Raise the backlog, then pause and clear everything raised so far.
    await runExpenseRollover(SYSTEM_ID, "System");
    await pauseExpenseTemplate(
      { templateId: template._id.toString(), reason: "Paused for a while" },
      admin
    );

    // Rewind history: pretend the last raised period was 5 months ago, which
    // is what a long pause looks like to the rollover.
    const rows = await ExpenseModel.find({}).sort({ periodStart: -1 }).lean();
    const keep = rows[rows.length - 1];
    await ExpenseModel.deleteMany({ _id: { $ne: keep?._id } });

    await resumeExpenseTemplate({ templateId: template._id.toString() }, admin);
    const before = await ExpenseModel.countDocuments({});
    await runExpenseRollover(SYSTEM_ID, "System");

    // Resuming re-anchors generateFrom to now, so the months skipped during
    // the pause must NOT reappear as catch-up.
    const after = await ExpenseModel.countDocuments({});
    expect(after).toBe(before);
  });
});

describe("expenses.service — approveExpense (Section 6.3.3)", () => {
  afterEach(async () => {
    await clearAllCollections();
  });

  async function raiseOnePending(amountPaise = 50_000_00) {
    const admin = await seedActor("admin", "admin-approve");
    const account = await seedAccount({
      openingBalancePaise: 100_000_00,
      currentBalancePaise: 100_000_00,
    });
    await makeTemplate(admin, account._id.toString(), { amountPaise });
    await runExpenseRollover(SYSTEM_ID, "System");
    const pending = await ExpenseModel.findOne({ status: "pending" }).sort({ periodStart: 1 }).lean();
    return { admin, account, pending: pending! };
  }

  it("posts the money: balance drops, transaction appears, status becomes active", async () => {
    const { admin, account, pending } = await raiseOnePending();

    const result = await approveExpense(
      {
        expenseId: pending._id.toString(),
        spentAt: new Date(),
        idempotencyKey: randomUUID(),
      },
      admin
    );

    expect(result.accountNewBalance).toBe(50_000_00);
    const updatedAccount = await AccountModel.findById(account._id).lean();
    expect(updatedAccount?.currentBalancePaise).toBe(50_000_00);

    const posted = await ExpenseModel.findById(pending._id).lean();
    expect(posted?.status).toBe("active");
    expect(posted?.transactionId).not.toBeNull();
    expect(posted?.approvedBy).not.toBeNull();

    const tx = await TransactionModel.findOne({ type: "EXPENSE_OUT" }).lean();
    expect(tx?.direction).toBe("OUT");
    expect(tx?.amountPaise).toBe(50_000_00);

    expect(await AuditLogModel.countDocuments({ action: "EXPENSE_APPROVED" })).toBe(1);
  });

  it("records the ledger month from the approval date, not the period", async () => {
    const { admin, pending } = await raiseOnePending();
    // The period sits in the past; the money actually leaves today.
    const paidOn = new Date();

    await approveExpense(
      { expenseId: pending._id.toString(), spentAt: paidOn, idempotencyKey: randomUUID() },
      admin
    );

    const tx = await TransactionModel.findOne({ type: "EXPENSE_OUT" }).lean();
    const expectedMonthKey = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
    })
      .format(paidOn)
      .slice(0, 7);
    expect(tx?.monthKey).toBe(expectedMonthKey);
  });

  it("refuses to approve twice", async () => {
    const { admin, pending } = await raiseOnePending();
    await approveExpense(
      { expenseId: pending._id.toString(), spentAt: new Date(), idempotencyKey: randomUUID() },
      admin
    );

    await expect(
      approveExpense(
        { expenseId: pending._id.toString(), spentAt: new Date(), idempotencyKey: randomUUID() },
        admin
      )
    ).rejects.toMatchObject({ code: "CONFLICT" });

    // And critically, the balance moved only once.
    const tx = await TransactionModel.countDocuments({ type: "EXPENSE_OUT" });
    expect(tx).toBe(1);
  });

  it("blocks a non-owner from approving into a negative balance", async () => {
    const staff = await seedActor("admin", "admin-poor");
    const account = await seedAccount({ currentBalancePaise: 1_000_00 });
    await makeTemplate(staff, account._id.toString(), { amountPaise: 50_000_00 });
    await runExpenseRollover(SYSTEM_ID, "System");
    const pending = await ExpenseModel.findOne({ status: "pending" }).lean();

    await expect(
      approveExpense(
        {
          expenseId: pending!._id.toString(),
          spentAt: new Date(),
          overrideNegativeBalance: true, // ignored — actor is not owner
          idempotencyKey: randomUUID(),
        },
        staff
      )
    ).rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE" });
  });
});

describe("expenses.service — editing is pending-only (Section 6.3.3)", () => {
  afterEach(async () => {
    await clearAllCollections();
  });

  it("edits a pending expense and bumps its version", async () => {
    const admin = await seedActor("admin", "admin-edit");
    const account = await seedAccount({ currentBalancePaise: 100_000_00 });
    await makeTemplate(admin, account._id.toString());
    await runExpenseRollover(SYSTEM_ID, "System");
    const pending = await ExpenseModel.findOne({ status: "pending" }).lean();

    await updatePendingExpense(
      {
        expenseId: pending!._id.toString(),
        amountPaise: 55_000_00,
        reason: "Monthly salary + bonus",
        paidToEntity: "Ramesh Kumar",
        category: "salary",
        accountId: account._id.toString(),
        spentAt: new Date(),
        note: null,
        version: pending!.version,
      },
      admin
    );

    const updated = await ExpenseModel.findById(pending!._id).lean();
    expect(updated?.amountPaise).toBe(55_000_00);
    expect(updated?.version).toBe(pending!.version + 1);
    expect(await AuditLogModel.countDocuments({ action: "EXPENSE_UPDATED" })).toBe(1);
  });

  it("refuses to edit an expense that has already posted", async () => {
    const admin = await seedActor("admin", "admin-noedit");
    const account = await seedAccount({ currentBalancePaise: 100_000_00 });

    // A plain one-off expense is posted the moment it is created.
    const created = await createExpense(
      {
        amountPaise: 5_000_00,
        reason: "Office rent",
        paidToEntity: "Landlord",
        category: "rent",
        accountId: account._id.toString(),
        spentAt: new Date(),
        idempotencyKey: randomUUID(),
      },
      admin
    );

    await expect(
      updatePendingExpense(
        {
          expenseId: created.expense._id.toString(),
          amountPaise: 1_00,
          reason: "Sneaky rewrite",
          paidToEntity: "Landlord",
          category: "rent",
          accountId: account._id.toString(),
          spentAt: new Date(),
          note: null,
          version: 0,
        },
        admin
      )
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("cancels a pending expense without touching any balance", async () => {
    const admin = await seedActor("admin", "admin-cancel");
    const account = await seedAccount({ currentBalancePaise: 100_000_00 });
    await makeTemplate(admin, account._id.toString());
    await runExpenseRollover(SYSTEM_ID, "System");
    const pending = await ExpenseModel.findOne({ status: "pending" }).lean();

    await cancelPendingExpense(
      { expenseId: pending!._id.toString(), reason: "Employee left" },
      admin
    );

    const cancelled = await ExpenseModel.findById(pending!._id).lean();
    expect(cancelled?.status).toBe("cancelled");
    // Kept, not deleted — the gap has to stay explainable.
    expect(cancelled).not.toBeNull();

    const account2 = await AccountModel.findById(account._id).lean();
    expect(account2?.currentBalancePaise).toBe(100_000_00);
    expect(await TransactionModel.countDocuments({})).toBe(0);
  });

  it("will not re-raise a period whose expense was cancelled", async () => {
    const admin = await seedActor("admin", "admin-nore");
    const account = await seedAccount({ currentBalancePaise: 100_000_00 });
    await makeTemplate(admin, account._id.toString());
    await runExpenseRollover(SYSTEM_ID, "System");
    const pending = await ExpenseModel.findOne({ status: "pending" }).lean();
    await cancelPendingExpense({ expenseId: pending!._id.toString(), reason: "Not owed" }, admin);

    const before = await ExpenseModel.countDocuments({});
    await runExpenseRollover(SYSTEM_ID, "System");

    expect(await ExpenseModel.countDocuments({})).toBe(before);
  });
});

describe("expense-templates — pause/resume bookkeeping", () => {
  afterEach(async () => {
    await clearAllCollections();
  });

  it("pausing leaves already-raised pending expenses alone", async () => {
    const admin = await seedActor("admin", "admin-keep");
    const account = await seedAccount({ currentBalancePaise: 100_000_00 });
    const template = await makeTemplate(admin, account._id.toString());
    await runExpenseRollover(SYSTEM_ID, "System");
    const raisedBefore = await ExpenseModel.countDocuments({ status: "pending" });

    await pauseExpenseTemplate(
      { templateId: template._id.toString(), reason: "Seasonal" },
      admin
    );

    expect(await ExpenseModel.countDocuments({ status: "pending" })).toBe(raisedBefore);
    const paused = await ExpenseTemplateModel.findById(template._id).lean();
    expect(paused?.status).toBe("paused");
    expect(paused?.pausedReason).toBe("Seasonal");
  });

  it("rejects pausing something already paused", async () => {
    const admin = await seedActor("admin", "admin-dbl");
    const account = await seedAccount({ currentBalancePaise: 100_000_00 });
    const template = await makeTemplate(admin, account._id.toString());
    await pauseExpenseTemplate({ templateId: template._id.toString(), reason: "First" }, admin);

    await expect(
      pauseExpenseTemplate({ templateId: template._id.toString(), reason: "Second" }, admin)
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
