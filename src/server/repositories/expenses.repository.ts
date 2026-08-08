import type { ClientSession } from "mongoose";
import { Types } from "mongoose";

import { db } from "@/database/connection";
import { ExpenseModel } from "@/database/models/expense.model";
import { assertCreated } from "@/server/repositories/assert-created";
import type { StampedAttachmentMeta } from "@/types/attachment";
import type { ExpenseCategory } from "@/constants/domain";

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
  transactionId: Types.ObjectId;
  overrideNegativeBalance: boolean;
  idempotencyKey: string;
  createdBy: string;
};

export async function insertExpense(input: InsertExpenseInput, session: ClientSession) {
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
        transactionId: input.transactionId,
        overrideNegativeBalance: input.overrideNegativeBalance,
        idempotencyKey: input.idempotencyKey,
        createdBy: new Types.ObjectId(input.createdBy),
      },
    ],
    { session }
  );
  return assertCreated(doc, "expense");
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
  status?: "active" | "reversed" | "all";
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
  if (!filter.status || filter.status === "active") match.status = "active";
  else if (filter.status === "reversed") match.status = "reversed";
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
