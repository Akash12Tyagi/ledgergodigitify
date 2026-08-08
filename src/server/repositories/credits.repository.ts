import type { ClientSession } from "mongoose";
import { Types } from "mongoose";

import { db } from "@/database/connection";
import { CreditModel } from "@/database/models/credit.model";
import { assertCreated } from "@/server/repositories/assert-created";
import type { StampedAttachmentMeta } from "@/types/attachment";
import type { CreditCategory } from "@/constants/domain";

export type InsertCreditInput = {
  _id: Types.ObjectId;
  amountPaise: number;
  source: string;
  reason: string;
  category: CreditCategory;
  accountId: string;
  receivedAt: Date;
  attachments?: StampedAttachmentMeta[];
  note?: string | null;
  transactionId: Types.ObjectId;
  idempotencyKey: string;
  createdBy: string;
};

export async function insertCredit(input: InsertCreditInput, session: ClientSession) {
  await db();
  const [doc] = await CreditModel.create(
    [
      {
        _id: input._id,
        amountPaise: input.amountPaise,
        source: input.source,
        reason: input.reason,
        category: input.category,
        accountId: new Types.ObjectId(input.accountId),
        receivedAt: input.receivedAt,
        attachments: input.attachments ?? [],
        note: input.note ?? null,
        transactionId: input.transactionId,
        idempotencyKey: input.idempotencyKey,
        createdBy: new Types.ObjectId(input.createdBy),
      },
    ],
    { session }
  );
  return assertCreated(doc, "credit");
}

export async function findCreditById(id: string) {
  await db();
  if (!Types.ObjectId.isValid(id)) return null;
  return CreditModel.findById(id).lean();
}

export async function findCreditByIdempotencyKey(idempotencyKey: string) {
  await db();
  return CreditModel.findOne({ idempotencyKey }).lean();
}

export async function markCreditReversed(
  id: string,
  reversedBy: string,
  reversedReason: string,
  session: ClientSession
) {
  await db();
  await CreditModel.updateOne(
    { _id: new Types.ObjectId(id) },
    { $set: { status: "reversed", reversedBy: new Types.ObjectId(reversedBy), reversedReason } },
    { session }
  );
}

export type CreditListFilter = {
  category?: CreditCategory | "all";
  accountId?: string;
  status?: "active" | "reversed" | "all";
  /** Half-open [receivedFrom, receivedTo) window, from the app-wide period
   * picker. Credits have no stored monthKey, so the period is applied to
   * `receivedAt`. */
  receivedFrom?: Date;
  receivedTo?: Date;
  page?: number;
  pageSize?: number;
};

/** Section 7.9 — /ledger/credits table, server-paginated. */
export async function findCreditsPaginated(filter: CreditListFilter) {
  await db();
  const page = filter.page ?? 1;
  const pageSize = filter.pageSize ?? 20;
  const match: Record<string, unknown> = {};
  if (filter.category && filter.category !== "all") match.category = filter.category;
  if (filter.accountId) match.accountId = new Types.ObjectId(filter.accountId);
  if (!filter.status || filter.status === "active") match.status = "active";
  else if (filter.status === "reversed") match.status = "reversed";
  if (filter.receivedFrom || filter.receivedTo) {
    const window: Record<string, Date> = {};
    if (filter.receivedFrom) window.$gte = filter.receivedFrom;
    if (filter.receivedTo) window.$lt = filter.receivedTo;
    match.receivedAt = window;
  }

  const [rows, total] = await Promise.all([
    CreditModel.find(match)
      .sort({ receivedAt: -1, _id: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean(),
    CreditModel.countDocuments(match),
  ]);

  return { rows, total, page, pageSize };
}
