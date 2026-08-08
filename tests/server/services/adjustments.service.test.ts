import { afterEach, describe, expect, it } from "vitest";

import { adjustAccount } from "@/server/services/adjustments.service";
import { getMonthOverview } from "@/server/services/financial-engine";
import { AccountModel } from "@/database/models/account.model";
import { AuditLogModel } from "@/database/models/audit-log.model";
import { TransactionModel } from "@/database/models/transaction.model";
import { seedAccount } from "../../helpers/seed-financial";
import { seedUser, clearAllCollections } from "../../helpers/seed-user";
import { toMonthKey } from "@/lib/dates";
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

async function ownerActor(label: string) {
  const owner = await seedUser({
    name: "Owner",
    email: `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
    password: PASSWORD,
    role: "owner",
  });
  return actorFrom(owner);
}

describe("adjustments.service — adjustAccount", () => {
  afterEach(async () => {
    await clearAllCollections();
  });

  it("records an IN adjustment as a real transaction and moves the balance", async () => {
    const actor = await ownerActor("adj1");
    const account = await seedAccount({ openingBalancePaise: 5_000_00, currentBalancePaise: 5_000_00 });

    const result = await adjustAccount(
      {
        accountId: account._id.toString(),
        direction: "IN",
        amountPaise: 2_000_00,
        reason: "Cash recount — found extra",
        occurredAt: new Date(),
        idempotencyKey: `adj-${Date.now()}`,
      },
      actor
    );

    expect(result.accountNewBalance).toBe(7_000_00);

    const stored = await AccountModel.findById(account._id).lean();
    expect(stored?.currentBalancePaise).toBe(7_000_00);
    // The opening balance is untouched — history is not restated.
    expect(stored?.openingBalancePaise).toBe(5_000_00);

    const tx = await TransactionModel.findOne({ type: "ADJUSTMENT" }).lean();
    expect(tx?.direction).toBe("IN");
    expect(tx?.amountPaise).toBe(2_000_00);
    expect(tx?.note).toBe("Cash recount — found extra");

    const audit = await AuditLogModel.findOne({ action: "ACCOUNT_ADJUSTED" }).lean();
    expect(audit?.summary).toContain("Cash recount");
  });

  it("records an OUT adjustment and may take the balance negative", async () => {
    // Unlike an expense, a correction must be able to express reality — if
    // the account really is short, refusing to record it would force the
    // books to stay knowingly wrong.
    const actor = await ownerActor("adj2");
    const account = await seedAccount({ openingBalancePaise: 1_000_00, currentBalancePaise: 1_000_00 });

    const result = await adjustAccount(
      {
        accountId: account._id.toString(),
        direction: "OUT",
        amountPaise: 1_500_00,
        reason: "Bank charges never recorded",
        occurredAt: new Date(),
        idempotencyKey: `adj-${Date.now()}`,
      },
      actor
    );

    expect(result.accountNewBalance).toBe(-500_00);
  });

  it("keeps the month overview balanced — closing still equals opening + net", async () => {
    // An adjustment moves an account balance, so if it were left out of
    // netCashFlow the equation would fail and the reconciliation banner
    // would blank the entire month's figures.
    //
    // Doubles as the regression for a notification-dedupe hang: both
    // adjustments below leave the account under the low-balance threshold
    // and so share one LOWBAL dedupeKey. createNotificationIfNotExists used
    // to insert-and-catch E11000, which aborts the surrounding transaction
    // and made withTransaction retry the callback forever. If that returns,
    // this test hangs instead of failing.
    const actor = await ownerActor("adj3");
    const account = await seedAccount({ openingBalancePaise: 0, currentBalancePaise: 0 });

    await adjustAccount(
      {
        accountId: account._id.toString(),
        direction: "IN",
        amountPaise: 3_000_00,
        reason: "Opening balance was understated",
        occurredAt: new Date(),
        idempotencyKey: `adj-in-${Date.now()}`,
      },
      actor
    );
    await adjustAccount(
      {
        accountId: account._id.toString(),
        direction: "OUT",
        amountPaise: 1_000_00,
        reason: "Duplicate entry removed",
        occurredAt: new Date(),
        idempotencyKey: `adj-out-${Date.now()}`,
      },
      actor
    );

    const overview = await getMonthOverview(toMonthKey(new Date()));

    expect(overview.reconciliationError).toBeUndefined();
    expect(overview.adjustmentsNetPaise).toBe(2_000_00);
    expect(overview.netCashFlowPaise).toBe(2_000_00);
    expect(overview.closingPositionPaise).toBe(
      overview.openingPositionPaise + overview.netCashFlowPaise
    );
  });

  it("replays rather than double-applying when the same request is retried", async () => {
    const actor = await ownerActor("adj4");
    const account = await seedAccount({ openingBalancePaise: 0, currentBalancePaise: 0 });
    const idempotencyKey = `adj-retry-${Date.now()}`;

    const input = {
      accountId: account._id.toString(),
      direction: "IN" as const,
      amountPaise: 1_000_00,
      reason: "Double-click safety check",
      occurredAt: new Date(),
      idempotencyKey,
    };

    await adjustAccount(input, actor);
    await expect(adjustAccount(input, actor)).rejects.toMatchObject({
      code: "IDEMPOTENT_REPLAY",
    });

    const stored = await AccountModel.findById(account._id).lean();
    expect(stored?.currentBalancePaise).toBe(1_000_00);
    expect(await TransactionModel.countDocuments({ type: "ADJUSTMENT" })).toBe(1);
  });

  it("refuses to adjust an account locked for reconciliation", async () => {
    const actor = await ownerActor("adj5");
    const account = await seedAccount({ reconcileLock: true });

    await expect(
      adjustAccount(
        {
          accountId: account._id.toString(),
          direction: "IN",
          amountPaise: 100_00,
          reason: "Should not be allowed",
          occurredAt: new Date(),
          idempotencyKey: `adj-${Date.now()}`,
        },
        actor
      )
    ).rejects.toThrow(/locked/i);
  });
});
