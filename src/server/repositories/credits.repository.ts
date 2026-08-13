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

/** Shared by the list query and the outside-the-window summary, so the two
 * can never drift into disagreeing about which rows the non-date filters
 * select. */
function buildCreditMatch(
  filter: CreditListFilter,
  options: { withDateWindow: boolean }
): Record<string, unknown> {
  const match: Record<string, unknown> = {};
  if (filter.category && filter.category !== "all") match.category = filter.category;
  if (filter.accountId) match.accountId = new Types.ObjectId(filter.accountId);
  if (!filter.status || filter.status === "active") match.status = "active";
  else if (filter.status === "reversed") match.status = "reversed";
  if (options.withDateWindow && (filter.receivedFrom || filter.receivedTo)) {
    const window: Record<string, Date> = {};
    if (filter.receivedFrom) window.$gte = filter.receivedFrom;
    if (filter.receivedTo) window.$lt = filter.receivedTo;
    match.receivedAt = window;
  }
  return match;
}

/**
 * Count and date-bounds of the credits the same filters would select with
 * the date window lifted. One aggregation, run only when the windowed query
 * found nothing — see types/list.ts#OutsideWindowSummary for why an empty
 * table needs to know this.
 */
export async function summariseCreditsOutsideWindow(filter: CreditListFilter) {
  await db();
  const [summary] = await CreditModel.aggregate<{ total: number; earliest: Date; latest: Date }>([
    { $match: buildCreditMatch(filter, { withDateWindow: false }) },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        earliest: { $min: "$receivedAt" },
        latest: { $max: "$receivedAt" },
      },
    },
  ]);
  if (!summary || summary.total === 0) return null;
  return summary;
}

/** Section 7.9 — /ledger/credits table, server-paginated. */
export async function findCreditsPaginated(filter: CreditListFilter) {
  await db();
  const page = filter.page ?? 1;
  const pageSize = filter.pageSize ?? 20;
  const match = buildCreditMatch(filter, { withDateWindow: true });

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
