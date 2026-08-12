import type { ClientSession } from "mongoose";
import { Types } from "mongoose";

import { db } from "@/database/connection";
import { ExpenseModel } from "@/database/models/expense.model";
import { assertCreated } from "@/server/repositories/assert-created";
import type { StampedAttachmentMeta } from "@/types/attachment";
import type { ExpenseCategory, ExpenseGeneratedBy, ExpenseStatus } from "@/constants/domain";

/** Section 7.5 — expense-by-category donut. Category lives on the Expense
 * document, not the ledger transaction, so this aggregate reads from
 * `expenses` filtered by the IST month's UTC instant range. */
export async function sumExpensesByCategoryInRange(startUTC: Date, endUTC: Date) {
  await db();
  return ExpenseModel.aggregate<{ _id: string; totalPaise: number; count: number }>([
    { $match: { spentAt: { $gte: startUTC, $lt: endUTC }, status: "active" } },
    {
      $group: {
        _id: "$category",
        totalPaise: { $sum: "$amountPaise" },
        count: { $sum: 1 },
      },
    },
    { $sort: { totalPaise: -1 } },
  ]);
}

export type InsertExpenseInput = {
  _id: Types.ObjectId;
  amountPaise: number;
  reason: string;
  paidToEntity: string;
  category: ExpenseCategory;
  accountId: string;
  spentAt: Date;
  attachments?: StampedAttachmentMeta[];
  note?: string | null;
  /** Omitted for a pending expense — no money has moved, so no ledger
   * Transaction exists to point at yet. */
  transactionId?: Types.ObjectId | null;
  status?: ExpenseStatus;
  templateId?: Types.ObjectId | null;
  generatedBy?: ExpenseGeneratedBy;
  periodStart?: Date | null;
  periodEnd?: Date | null;
  overrideNegativeBalance: boolean;
  idempotencyKey: string;
  createdBy: string;
};

export async function insertExpense(input: InsertExpenseInput, session?: ClientSession) {
  await db();
  const [doc] = await ExpenseModel.create(
    [
      {
        _id: input._id,
        amountPaise: input.amountPaise,
        reason: input.reason,
        paidToEntity: input.paidToEntity,
        category: input.category,
        accountId: new Types.ObjectId(input.accountId),
        spentAt: input.spentAt,
        attachments: input.attachments ?? [],
        note: input.note ?? null,
        transactionId: input.transactionId ?? null,
        status: input.status ?? "active",
        templateId: input.templateId ?? null,
        generatedBy: input.generatedBy ?? "manual",
        periodStart: input.periodStart ?? null,
        periodEnd: input.periodEnd ?? null,
        overrideNegativeBalance: input.overrideNegativeBalance,
        idempotencyKey: input.idempotencyKey,
        createdBy: new Types.ObjectId(input.createdBy),
      },
    ],
    session ? { session } : undefined
  );
  return assertCreated(doc, "expense");
}

/** The rollover's "where did this template get to?" lookup — the expense-side
 * twin of findLatestBillingForClient. Cancelled rows still count: a period
 * that was raised and then dismissed has still been raised, and re-raising
 * it on the next cron run would resurrect exactly what the user dismissed. */
export async function findLatestExpenseForTemplate(templateId: string) {
  await db();
  if (!Types.ObjectId.isValid(templateId)) return null;
  return ExpenseModel.findOne({ templateId: new Types.ObjectId(templateId) })
    .sort({ periodStart: -1 })
    .lean();
}

/** Optimistic-locked edit, permitted only while pending — the status match
 * is part of the query, not a prior read, so an expense approved between
 * the form loading and submitting fails the update instead of silently
 * rewriting a posted row. */
export async function updatePendingExpenseOptimistic(
  id: string,
  version: number,
  fields: Record<string, unknown>
) {
  await db();
  return ExpenseModel.findOneAndUpdate(
    { _id: new Types.ObjectId(id), version, status: "pending" },
    { $set: fields, $inc: { version: 1 } },
    { returnDocument: "after" }
  ).lean();
}

/** Posts a pending expense. The `status: "pending"` guard in the filter is
 * what makes a double-approve impossible even under concurrent clicks: the
 * second update matches nothing and returns null. */
export async function markExpenseApproved(
  id: string,
  fields: { transactionId: Types.ObjectId; approvedBy: string; approvedAt: Date; spentAt: Date },
  session: ClientSession
) {
  await db();
  return ExpenseModel.findOneAndUpdate(
    { _id: new Types.ObjectId(id), status: "pending" },
    {
      $set: {
        status: "active",
        transactionId: fields.transactionId,
        approvedBy: new Types.ObjectId(fields.approvedBy),
        approvedAt: fields.approvedAt,
        spentAt: fields.spentAt,
      },
      $inc: { version: 1 },
    },
    { returnDocument: "after", session }
  ).lean();
}

export async function markPendingExpenseCancelled(
  id: string,
  cancelledBy: string,
  cancelledReason: string
) {
  await db();
  return ExpenseModel.findOneAndUpdate(
    { _id: new Types.ObjectId(id), status: "pending" },
    {
      $set: {
        status: "cancelled",
        cancelledBy: new Types.ObjectId(cancelledBy),
        cancelledAt: new Date(),
        cancelledReason,
      },
      $inc: { version: 1 },
    },
    { returnDocument: "after" }
  ).lean();
}

/** Drives the sidebar's "N waiting" badge. */
export async function countPendingExpenses() {
  await db();
  return ExpenseModel.countDocuments({ status: "pending" });
}

export async function findExpenseById(id: string) {
  await db();
  if (!Types.ObjectId.isValid(id)) return null;
  return ExpenseModel.findById(id).lean();
}

export async function findExpenseByIdempotencyKey(idempotencyKey: string) {
  await db();
  return ExpenseModel.findOne({ idempotencyKey }).lean();
}

export async function markExpenseReversed(
  id: string,
  reversedBy: string,
  reversedReason: string,
  session: ClientSession
) {
  await db();
  await ExpenseModel.updateOne(
    { _id: new Types.ObjectId(id) },
    { $set: { status: "reversed", reversedBy: new Types.ObjectId(reversedBy), reversedReason } },
    { session }
  );
}

export type ExpenseListFilter = {
  category?: ExpenseCategory | "all";
  accountId?: string;
  /** Defaults to "active" — the posted ledger. Pending rows are opt-in so
   * that money-shaped views never accidentally total expenses that have not
   * happened yet. */
  status?: ExpenseStatus | "all";
  templateId?: string;
  /** Half-open [spentFrom, spentTo) window, from the app-wide period
   * picker. Expenses have no stored monthKey, so the period is applied to
   * `spentAt` — the same field getMonthOverview's category breakdown uses,
   * so the two agree. */
  spentFrom?: Date;
  spentTo?: Date;
  page?: number;
  pageSize?: number;
};

/** Section 7.6 — /ledger/expenses table, server-paginated (Section 14
 * edge case 33: no full-collection fetch). */
export async function findExpensesPaginated(filter: ExpenseListFilter) {
  await db();
  const page = filter.page ?? 1;
  const pageSize = filter.pageSize ?? 20;
  const match: Record<string, unknown> = {};
  if (filter.category && filter.category !== "all") match.category = filter.category;
  if (filter.accountId) match.accountId = new Types.ObjectId(filter.accountId);
  if (!filter.status) match.status = "active";
  else if (filter.status !== "all") match.status = filter.status;
  if (filter.templateId && Types.ObjectId.isValid(filter.templateId)) {
    match.templateId = new Types.ObjectId(filter.templateId);
  }
  if (filter.spentFrom || filter.spentTo) {
    const window: Record<string, Date> = {};
    if (filter.spentFrom) window.$gte = filter.spentFrom;
    if (filter.spentTo) window.$lt = filter.spentTo;
    match.spentAt = window;
  }

  const [rows, total] = await Promise.all([
    ExpenseModel.find(match)
      .sort({ spentAt: -1, _id: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean(),
    ExpenseModel.countDocuments(match),
  ]);

  return { rows, total, page, pageSize };
}
