import { Types } from "mongoose";

import { db } from "@/database/connection";
import { monthKeyToRange } from "@/lib/dates";
import { AccountModel } from "@/database/models/account.model";
import { ClientModel } from "@/database/models/client.model";
import { MonthlyBillingModel } from "@/database/models/monthly-billing.model";
import { TransactionModel } from "@/database/models/transaction.model";
import { ExpenseModel } from "@/database/models/expense.model";
import type {
  AccountType,
  BillingGeneratedBy,
  ClientEngagementType,
  ExpenseCategory,
  PayStatus,
  TransactionDirection,
  TransactionType,
} from "@/constants/domain";

let counter = 0;
function uniqueKey(label: string) {
  counter += 1;
  return `${label}-${Date.now()}-${counter}-${Math.random().toString(36).slice(2)}`;
}

export async function seedAccount(overrides: {
  name?: string;
  type?: AccountType;
  openingBalancePaise?: number;
  currentBalancePaise?: number;
  lowBalanceThresholdPaise?: number | null;
  status?: "active" | "archived";
  reconcileLock?: boolean;
  /**
   * When the account was opened. The overview reads this to decide whether
   * an account's seed opening balance belongs to the period's OPENING (the
   * account already existed) or to its INFLOWS (it was opened during the
   * period) — so any test about opening positions has to be able to set it.
   * Defaults to now, matching a freshly created account.
   */
  createdAt?: Date;
} = {}) {
  await db();
  const account = await AccountModel.create({
    name: overrides.name ?? `Account ${uniqueKey("acct")}`,
    type: overrides.type ?? "bank",
    openingBalancePaise: overrides.openingBalancePaise ?? 0,
    currentBalancePaise: overrides.currentBalancePaise ?? overrides.openingBalancePaise ?? 0,
    lowBalanceThresholdPaise: overrides.lowBalanceThresholdPaise ?? null,
    status: overrides.status ?? "active",
    reconcileLock: overrides.reconcileLock ?? false,
  });

  if (overrides.createdAt) {
    // Straight through the driver: Mongoose's own update path re-stamps
    // `createdAt` from the timestamps plugin, so a model-level $set here is
    // silently undone.
    await AccountModel.collection.updateOne(
      { _id: account._id },
      { $set: { createdAt: overrides.createdAt } }
    );
    account.set("createdAt", overrides.createdAt);
  }

  return account;
}

export async function seedClient(
  createdBy: Types.ObjectId,
  overrides: {
    name?: string;
    engagementType?: ClientEngagementType;
    amountPaise?: number;
    nextDueDate?: Date;
    status?: "active" | "paused" | "archived";
  } = {}
) {
  await db();
  return ClientModel.create({
    name: overrides.name ?? `Client ${uniqueKey("client")}`,
    service: "Bookkeeping",
    engagementType: overrides.engagementType ?? "retainer",
    amountPaise: overrides.amountPaise ?? 20_000_00,
    nextDueDate: overrides.nextDueDate ?? new Date(),
    status: overrides.status ?? "active",
    createdBy,
  });
}

/** Seeds one billing period. `periodStart`/`periodEnd` default to the
 * calendar month named by `monthKey`, which keeps every month-shaped test
 * reading naturally while still exercising the period-based code paths. */
export async function seedBilling(
  clientId: Types.ObjectId,
  overrides: {
    monthKey?: string;
    periodStart?: Date;
    periodEnd?: Date;
    billedPaise?: number;
    carriedInPaise?: number;
    carriedOutPaise?: number;
    paidPaise?: number;
    status?: PayStatus;
    dueDate?: Date;
    generatedBy?: BillingGeneratedBy;
  } = {}
) {
  await db();
  const monthKey = overrides.monthKey ?? "2026-07";
  const { startUTC, endUTC } = monthKeyToRange(monthKey);

  return MonthlyBillingModel.create({
    clientId,
    monthKey,
    periodStart: overrides.periodStart ?? startUTC,
    periodEnd: overrides.periodEnd ?? endUTC,
    billedPaise: overrides.billedPaise ?? 20_000_00,
    carriedInPaise: overrides.carriedInPaise ?? 0,
    carriedOutPaise: overrides.carriedOutPaise ?? 0,
    paidPaise: overrides.paidPaise ?? 0,
    status: overrides.status ?? "PENDING",
    dueDate: overrides.dueDate ?? new Date("2026-07-14T18:30:00.000Z"), // Jul 15 IST midnight
    generatedBy: overrides.generatedBy ?? "manual",
  });
}

export async function seedTransaction(
  createdBy: Types.ObjectId,
  overrides: {
    type?: TransactionType;
    direction?: TransactionDirection;
    amountPaise?: number;
    accountId: Types.ObjectId;
    occurredAt?: Date;
    monthKey?: string;
    clientId?: Types.ObjectId | null;
    status?: "active" | "reversed";
    transactionGroupId?: Types.ObjectId | null;
    counterpartyLabel?: string | null;
  }
) {
  await db();
  return TransactionModel.create({
    type: overrides.type ?? "PAYMENT_IN",
    direction: overrides.direction ?? "IN",
    amountPaise: overrides.amountPaise ?? 1000_00,
    accountId: overrides.accountId,
    occurredAt: overrides.occurredAt ?? new Date(),
    monthKey: overrides.monthKey ?? "2026-07",
    clientId: overrides.clientId ?? null,
    status: overrides.status ?? "active",
    transactionGroupId: overrides.transactionGroupId ?? null,
    counterpartyLabel: overrides.counterpartyLabel ?? null,
    idempotencyKey: uniqueKey("tx"),
    createdBy,
  });
}

export async function seedExpense(
  createdBy: Types.ObjectId,
  accountId: Types.ObjectId,
  overrides: {
    amountPaise?: number;
    category?: ExpenseCategory;
    spentAt?: Date;
    status?: "active" | "reversed";
  } = {}
) {
  await db();
  return ExpenseModel.create({
    amountPaise: overrides.amountPaise ?? 500_00,
    reason: "Test expense",
    paidToEntity: "Test Vendor",
    category: overrides.category ?? "misc",
    accountId,
    spentAt: overrides.spentAt ?? new Date(),
    status: overrides.status ?? "active",
    transactionId: new Types.ObjectId(),
    idempotencyKey: uniqueKey("exp"),
    createdBy,
  });
}
