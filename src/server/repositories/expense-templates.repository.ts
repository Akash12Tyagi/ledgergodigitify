import type { ClientSession } from "mongoose";
import { Types } from "mongoose";

import { db } from "@/database/connection";
import { ExpenseTemplateModel } from "@/database/models/expense-template.model";
import { assertCreated } from "@/server/repositories/assert-created";
import type { ExpenseCategory, ExpenseTemplateStatus } from "@/constants/domain";

export type InsertExpenseTemplateInput = {
  _id?: Types.ObjectId;
  amountPaise: number;
  reason: string;
  paidToEntity: string;
  category: ExpenseCategory;
  accountId: string;
  startDate: Date;
  billingDay: number;
  generateFrom: Date;
  note?: string | null;
  createdBy: string;
};

export async function insertExpenseTemplate(
  input: InsertExpenseTemplateInput,
  session?: ClientSession
) {
  await db();
  const [doc] = await ExpenseTemplateModel.create(
    [
      {
        ...(input._id ? { _id: input._id } : {}),
        amountPaise: input.amountPaise,
        reason: input.reason,
        paidToEntity: input.paidToEntity,
        category: input.category,
        accountId: new Types.ObjectId(input.accountId),
        startDate: input.startDate,
        billingDay: input.billingDay,
        generateFrom: input.generateFrom,
        note: input.note ?? null,
        createdBy: new Types.ObjectId(input.createdBy),
      },
    ],
    session ? { session } : undefined
  );
  return assertCreated(doc, "expense template");
}

export async function findExpenseTemplateById(id: string) {
  await db();
  if (!Types.ObjectId.isValid(id)) return null;
  return ExpenseTemplateModel.findById(id).lean();
}

/** The rollover scan (Section 6.3.4). Paused templates are excluded here
 * rather than skipped in the loop, so a paused template costs nothing. */
export async function findActiveExpenseTemplates() {
  await db();
  return ExpenseTemplateModel.find({ status: "active" }).lean();
}

/** Same optimistic lock as updateClientOptimistic: a null result means the
 * template is gone OR the caller's `version` is stale, and both surface as
 * one CONFLICT rather than costing a second read to tell apart. */
export async function updateExpenseTemplateOptimistic(
  id: string,
  version: number,
  fields: Record<string, unknown>
) {
  await db();
  return ExpenseTemplateModel.findOneAndUpdate(
    { _id: new Types.ObjectId(id), version },
    { $set: fields, $inc: { version: 1 } },
    { returnDocument: "after" }
  ).lean();
}

export async function setExpenseTemplateStatus(
  id: string,
  status: ExpenseTemplateStatus,
  extra: { pausedAt?: Date | null; pausedReason?: string | null; generateFrom?: Date } = {}
) {
  await db();
  return ExpenseTemplateModel.findByIdAndUpdate(
    id,
    { $set: { status, ...extra } },
    { returnDocument: "after" }
  ).lean();
}

export type ExpenseTemplateListFilter = {
  status?: ExpenseTemplateStatus | "all";
  category?: ExpenseCategory | "all";
  accountId?: string;
  page?: number;
  pageSize?: number;
};

export async function findExpenseTemplatesPaginated(filter: ExpenseTemplateListFilter) {
  await db();
  const page = filter.page ?? 1;
  const pageSize = filter.pageSize ?? 20;
  const match: Record<string, unknown> = {};
  if (!filter.status || filter.status === "all") {
    // no status filter — show active and paused together
  } else {
    match.status = filter.status;
  }
  if (filter.category && filter.category !== "all") match.category = filter.category;
  if (filter.accountId && Types.ObjectId.isValid(filter.accountId)) {
    match.accountId = new Types.ObjectId(filter.accountId);
  }

  const [rows, total] = await Promise.all([
    ExpenseTemplateModel.find(match)
      .sort({ status: 1, createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean(),
    ExpenseTemplateModel.countDocuments(match),
  ]);

  return { rows, total, page, pageSize };
}
