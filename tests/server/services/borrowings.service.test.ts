import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import {
  createBorrowing,
  getOutstandingBorrowedTotal,
  recordRepayment,
  writeOffBorrowing,
} from "@/server/services/borrowings.service";
import { getMonthOverview } from "@/server/services/financial-engine";
import { AccountModel } from "@/database/models/account.model";
import { BorrowingModel } from "@/database/models/borrowing.model";
import { BorrowRepaymentModel } from "@/database/models/borrow-repayment.model";
import { TransactionModel } from "@/database/models/transaction.model";
import { AuditLogModel } from "@/database/models/audit-log.model";
import { toMonthKey } from "@/lib/dates";
import { seedAccount } from "../../helpers/seed-financial";
import { seedUser, clearAllCollections } from "../../helpers/seed-user";
import type { AuthedUser } from "@/server/auth/guards";

const PASSWORD = "Correct-Horse-Battery-Staple-9";

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

async function lend(actor: AuthedUser, accountId: string, principalPaise: number) {
  return createBorrowing(
    {
      borrowerName: "Ramesh Kumar",
      principalPaise,
      lentAt: new Date(),
      accountId,
      idempotencyKey: randomUUID(),
    },
    actor
  );
}

describe("borrowings.service — lending out (Section 6.9)", () => {
  afterEach(async () => {
    await clearAllCollections();
  });

  it("moves cash out and records what is owed back", async () => {
    const admin = await seedActor("admin", "admin-lend");
    const account = await seedAccount({
      openingBalancePaise: 100_000_00,
      currentBalancePaise: 100_000_00,
    });

    const result = await lend(admin, account._id.toString(), 10_000_00);

    expect(result.accountNewBalance).toBe(90_000_00);
    const updated = await AccountModel.findById(account._id).lean();
    expect(updated?.currentBalancePaise).toBe(90_000_00);

    const borrowing = await BorrowingModel.findOne({}).lean();
    expect(borrowing?.principalPaise).toBe(10_000_00);
    expect(borrowing?.repaidPaise).toBe(0);
    expect(borrowing?.status).toBe("open");

    const tx = await TransactionModel.findOne({ type: "LOAN_OUT" }).lean();
    expect(tx?.direction).toBe("OUT");
    expect(tx?.amountPaise).toBe(10_000_00);

    expect(await AuditLogModel.countDocuments({ action: "BORROWING_CREATED" })).toBe(1);
  });

  it("is NOT counted as an expense", async () => {
    const admin = await seedActor("admin", "admin-notexp");
    const account = await seedAccount({ currentBalancePaise: 100_000_00 });
    await lend(admin, account._id.toString(), 10_000_00);

    const overview = await getMonthOverview(toMonthKey(new Date()));
    // The single most important property of this whole module: lending is
    // not spending, so it must not inflate expenses or the category chart.
    expect(overview.expensesPaise).toBe(0);
    expect(overview.expenseByCategory).toHaveLength(0);
    expect(overview.lentPaise).toBe(10_000_00);
  });

  it("keeps the ledger identity closing == opening + net intact", async () => {
    const admin = await seedActor("admin", "admin-identity");
    const account = await seedAccount({
      openingBalancePaise: 100_000_00,
      currentBalancePaise: 100_000_00,
    });
    const lent = await lend(admin, account._id.toString(), 10_000_00);
    await recordRepayment(
      {
        borrowingId: lent.borrowing._id.toString(),
        amountPaise: 4_000_00,
        receivedAt: new Date(),
        accountId: account._id.toString(),
        idempotencyKey: randomUUID(),
      },
      admin
    );

    const overview = await getMonthOverview(toMonthKey(new Date()));

    // A new transaction type that is neither self-cancelling nor in the
    // netCashFlow formula silently blanks the whole Overview behind the
    // reconciliation banner. This is the guard against that regression.
    expect(overview.reconciliationError).toBeFalsy();
    expect(overview.closingPositionPaise).toBe(
      overview.openingPositionPaise + overview.netCashFlowPaise
    );
    expect(overview.lentPaise).toBe(10_000_00);
    expect(overview.loanRepaidPaise).toBe(4_000_00);
  });

  it("blocks a non-owner from lending more than the account holds", async () => {
    const admin = await seedActor("admin", "admin-broke");
    const account = await seedAccount({ currentBalancePaise: 1_000_00 });

    await expect(lend(admin, account._id.toString(), 50_000_00)).rejects.toMatchObject({
      code: "INSUFFICIENT_BALANCE",
    });
    // And nothing partial was written.
    expect(await BorrowingModel.countDocuments({})).toBe(0);
    expect(await TransactionModel.countDocuments({})).toBe(0);
  });
});

describe("borrowings.service — repayments", () => {
  afterEach(async () => {
    await clearAllCollections();
  });

  async function setup(principalPaise = 10_000_00) {
    const admin = await seedActor("admin", "admin-repay");
    const account = await seedAccount({
      openingBalancePaise: 100_000_00,
      currentBalancePaise: 100_000_00,
    });
    const lent = await lend(admin, account._id.toString(), principalPaise);
    return { admin, account, borrowingId: lent.borrowing._id.toString() };
  }

  it("credits the account and reduces what is owed", async () => {
    const { admin, account, borrowingId } = await setup();

    const result = await recordRepayment(
      {
        borrowingId,
        amountPaise: 4_000_00,
        receivedAt: new Date(),
        accountId: account._id.toString(),
        idempotencyKey: randomUUID(),
      },
      admin
    );

    expect(result.accountNewBalance).toBe(94_000_00);
    const borrowing = await BorrowingModel.findById(borrowingId).lean();
    expect(borrowing?.repaidPaise).toBe(4_000_00);
    expect(borrowing?.status).toBe("open");

    const tx = await TransactionModel.findOne({ type: "LOAN_REPAY_IN" }).lean();
    expect(tx?.direction).toBe("IN");
  });

  it("settles automatically once the last rupee is back", async () => {
    const { admin, account, borrowingId } = await setup();

    await recordRepayment(
      {
        borrowingId,
        amountPaise: 6_000_00,
        receivedAt: new Date(),
        accountId: account._id.toString(),
        idempotencyKey: randomUUID(),
      },
      admin
    );
    await recordRepayment(
      {
        borrowingId,
        amountPaise: 4_000_00,
        receivedAt: new Date(),
        accountId: account._id.toString(),
        idempotencyKey: randomUUID(),
      },
      admin
    );

    const borrowing = await BorrowingModel.findById(borrowingId).lean();
    expect(borrowing?.status).toBe("settled");
    expect(borrowing?.repaidPaise).toBe(10_000_00);
    expect(await BorrowRepaymentModel.countDocuments({})).toBe(2);
    // Net effect on the account: lent 10k, got 10k back.
    const account2 = await AccountModel.findById(account._id).lean();
    expect(account2?.currentBalancePaise).toBe(100_000_00);
  });

  it("refuses to accept more than is still owed", async () => {
    const { admin, account, borrowingId } = await setup();

    await expect(
      recordRepayment(
        {
          borrowingId,
          amountPaise: 15_000_00,
          receivedAt: new Date(),
          accountId: account._id.toString(),
          idempotencyKey: randomUUID(),
        },
        admin
      )
    ).rejects.toMatchObject({ code: "VALIDATION" });

    expect(await BorrowRepaymentModel.countDocuments({})).toBe(0);
  });

  it("refuses a repayment against an already-settled loan", async () => {
    const { admin, account, borrowingId } = await setup();
    await recordRepayment(
      {
        borrowingId,
        amountPaise: 10_000_00,
        receivedAt: new Date(),
        accountId: account._id.toString(),
        idempotencyKey: randomUUID(),
      },
      admin
    );

    await expect(
      recordRepayment(
        {
          borrowingId,
          amountPaise: 1_00,
          receivedAt: new Date(),
          accountId: account._id.toString(),
          idempotencyKey: randomUUID(),
        },
        admin
      )
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("can be repaid into a different account than it was lent from", async () => {
    const { admin, borrowingId } = await setup();
    const bank = await seedAccount({ currentBalancePaise: 0 });

    await recordRepayment(
      {
        borrowingId,
        amountPaise: 10_000_00,
        receivedAt: new Date(),
        accountId: bank._id.toString(),
        idempotencyKey: randomUUID(),
      },
      admin
    );

    const updatedBank = await AccountModel.findById(bank._id).lean();
    expect(updatedBank?.currentBalancePaise).toBe(10_000_00);
  });
});

describe("borrowings.service — write-off", () => {
  afterEach(async () => {
    await clearAllCollections();
  });

  it("stops the money counting as recoverable without moving any cash", async () => {
    const owner = await seedActor("owner", "owner-writeoff");
    const account = await seedAccount({ currentBalancePaise: 100_000_00 });
    const lent = await lend(owner, account._id.toString(), 10_000_00);
    const balanceAfterLending = lent.accountNewBalance;

    const result = await writeOffBorrowing(
      { borrowingId: lent.borrowing._id.toString(), reason: "Left the company, unreachable" },
      owner
    );

    expect(result.forgivenPaise).toBe(10_000_00);
    const borrowing = await BorrowingModel.findById(lent.borrowing._id).lean();
    expect(borrowing?.status).toBe("written_off");

    // The cash left when it was lent; writing off must not move it again.
    const account2 = await AccountModel.findById(account._id).lean();
    expect(account2?.currentBalancePaise).toBe(balanceAfterLending);
    expect(await TransactionModel.countDocuments({ type: "LOAN_OUT" })).toBe(1);
    expect(await TransactionModel.countDocuments({ type: "LOAN_REPAY_IN" })).toBe(0);

    expect(await AuditLogModel.countDocuments({ action: "BORROWING_WRITTEN_OFF" })).toBe(1);
  });

  it("drops the written-off amount out of the outstanding total", async () => {
    const owner = await seedActor("owner", "owner-outstanding");
    const account = await seedAccount({ currentBalancePaise: 100_000_00 });
    const keep = await lend(owner, account._id.toString(), 6_000_00);
    const drop = await lend(owner, account._id.toString(), 4_000_00);

    expect(await getOutstandingBorrowedTotal()).toBe(10_000_00);

    await writeOffBorrowing(
      { borrowingId: drop.borrowing._id.toString(), reason: "Not recoverable" },
      owner
    );

    expect(await getOutstandingBorrowedTotal()).toBe(6_000_00);
    // The kept one is untouched.
    const still = await BorrowingModel.findById(keep.borrowing._id).lean();
    expect(still?.status).toBe("open");
  });

  it("refuses to write off a settled loan", async () => {
    const owner = await seedActor("owner", "owner-settled");
    const account = await seedAccount({ currentBalancePaise: 100_000_00 });
    const lent = await lend(owner, account._id.toString(), 5_000_00);
    await recordRepayment(
      {
        borrowingId: lent.borrowing._id.toString(),
        amountPaise: 5_000_00,
        receivedAt: new Date(),
        accountId: account._id.toString(),
        idempotencyKey: randomUUID(),
      },
      owner
    );

    await expect(
      writeOffBorrowing(
        { borrowingId: lent.borrowing._id.toString(), reason: "Trying anyway" },
        owner
      )
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
