import type { ClientSession } from "mongoose";
import { Types } from "mongoose";

import { db } from "@/database/connection";
import { BorrowingModel } from "@/database/models/borrowing.model";
import { BorrowRepaymentModel } from "@/database/models/borrow-repayment.model";
import { assertCreated } from "@/server/repositories/assert-created";
import type { BorrowingStatus, PaymentMethod } from "@/constants/domain";
import type { StampedAttachmentMeta } from "@/types/attachment";

export type InsertBorrowingInput = {
  _id: Types.ObjectId;
  borrowerName: string;
  borrowerPhone?: string | null;
  principalPaise: number;
  lentAt: Date;
  accountId: string;
  reason?: string | null;
  note?: string | null;
  expectedBackBy?: Date | null;
  attachments?: StampedAttachmentMeta[];
  transactionId: Types.ObjectId;
  idempotencyKey: string;
  createdBy: string;
};

export async function insertBorrowing(input: InsertBorrowingInput, session: ClientSession) {
  await db();
  const [doc] = await BorrowingModel.create(
    [
      {
        _id: input._id,
        borrowerName: input.borrowerName,
        borrowerPhone: input.borrowerPhone ?? null,
        principalPaise: input.principalPaise,
        repaidPaise: 0,
        lentAt: input.lentAt,
        accountId: new Types.ObjectId(input.accountId),
        reason: input.reason ?? null,
        note: input.note ?? null,
        expectedBackBy: input.expectedBackBy ?? null,
        attachments: input.attachments ?? [],
        transactionId: input.transactionId,
        idempotencyKey: input.idempotencyKey,
        createdBy: new Types.ObjectId(input.createdBy),
      },
    ],
    { session }
  );
  return assertCreated(doc, "borrowing");
}

export async function findBorrowingById(id: string) {
  await db();
  if (!Types.ObjectId.isValid(id)) return null;
  return BorrowingModel.findById(id).lean();
}

export async function findBorrowingByIdempotencyKey(idempotencyKey: string) {
  await db();
  return BorrowingModel.findOne({ idempotencyKey }).lean();
}

/**
 * Applies a repayment to the parent.
 *
 * The guard is in the FILTER, not a prior read: `repaidPaise` must still be
 * what the caller saw, and the result must not exceed the principal. Two
 * concurrent repayments therefore cannot both land — the second matches
 * nothing and returns null — so a loan can never be recorded as more than
 * fully repaid.
 */
export async function applyRepaymentToBorrowing(
  id: string,
  expectedRepaidPaise: number,
  amountPaise: number,
  nextStatus: BorrowingStatus,
  session: ClientSession
) {
  await db();
  return BorrowingModel.findOneAndUpdate(
    { _id: new Types.ObjectId(id), status: "open", repaidPaise: expectedRepaidPaise },
    { $inc: { repaidPaise: amountPaise, version: 1 }, $set: { status: nextStatus } },
    { returnDocument: "after", session }
  ).lean();
}

export async function markBorrowingWrittenOff(
  id: string,
  writtenOffBy: string,
  reason: string
) {
  await db();
  return BorrowingModel.findOneAndUpdate(
    { _id: new Types.ObjectId(id), status: "open" },
    {
      $set: {
        status: "written_off",
        writtenOffAt: new Date(),
        writtenOffBy: new Types.ObjectId(writtenOffBy),
        writtenOffReason: reason,
      },
      $inc: { version: 1 },
    },
    { returnDocument: "after" }
  ).lean();
}

export type BorrowingListFilter = {
  status?: BorrowingStatus | "all";
  accountId?: string;
  search?: string;
  page?: number;
  pageSize?: number;
};

export async function findBorrowingsPaginated(filter: BorrowingListFilter) {
  await db();
  const page = filter.page ?? 1;
  const pageSize = filter.pageSize ?? 20;
  const match: Record<string, unknown> = {};
  if (filter.status && filter.status !== "all") match.status = filter.status;
  if (filter.accountId && Types.ObjectId.isValid(filter.accountId)) {
    match.accountId = new Types.ObjectId(filter.accountId);
  }
  if (filter.search?.trim()) {
    // Escaped, not passed through: a stray "(" in a name would otherwise
    // throw an invalid-regex error out of the database driver.
    match.borrowerName = { $regex: escapeRegex(filter.search.trim()), $options: "i" };
  }

  const [rows, total] = await Promise.all([
    BorrowingModel.find(match)
      .sort({ status: 1, lentAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean(),
    BorrowingModel.countDocuments(match),
  ]);

  return { rows, total, page, pageSize };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Total still owed to the business across every open borrowing. Written-off
 * rows are excluded — that is the entire point of writing one off. */
export async function sumOutstandingBorrowings(): Promise<number> {
  await db();
  const rows = await BorrowingModel.aggregate<{ _id: null; total: number }>([
    { $match: { status: "open" } },
    { $group: { _id: null, total: { $sum: { $subtract: ["$principalPaise", "$repaidPaise"] } } } },
  ]);
  return rows[0]?.total ?? 0;
}

export type InsertRepaymentInput = {
  _id: Types.ObjectId;
  borrowingId: string;
  amountPaise: number;
  receivedAt: Date;
  accountId: string;
  method?: PaymentMethod;
  note?: string | null;
  transactionId: Types.ObjectId;
  idempotencyKey: string;
  createdBy: string;
};

export async function insertRepayment(input: InsertRepaymentInput, session: ClientSession) {
  await db();
  const [doc] = await BorrowRepaymentModel.create(
    [
      {
        _id: input._id,
        borrowingId: new Types.ObjectId(input.borrowingId),
        amountPaise: input.amountPaise,
        receivedAt: input.receivedAt,
        accountId: new Types.ObjectId(input.accountId),
        method: input.method ?? "cash",
        note: input.note ?? null,
        transactionId: input.transactionId,
        idempotencyKey: input.idempotencyKey,
        createdBy: new Types.ObjectId(input.createdBy),
      },
    ],
    { session }
  );
  return assertCreated(doc, "borrow repayment");
}

export async function findRepaymentByIdempotencyKey(idempotencyKey: string) {
  await db();
  return BorrowRepaymentModel.findOne({ idempotencyKey }).lean();
}

export async function findRepaymentsForBorrowing(borrowingId: string) {
  await db();
  if (!Types.ObjectId.isValid(borrowingId)) return [];
  return BorrowRepaymentModel.find({ borrowingId: new Types.ObjectId(borrowingId) })
    .sort({ receivedAt: -1 })
    .lean();
}

/** Batched, for the list view's per-row repayment counts (Section 9 — no N+1). */
export async function countRepaymentsByBorrowing(
  borrowingIds: string[]
): Promise<Map<string, number>> {
  await db();
  const ids = borrowingIds.filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id));
  if (ids.length === 0) return new Map();

  const rows = await BorrowRepaymentModel.aggregate<{ _id: Types.ObjectId; count: number }>([
    { $match: { borrowingId: { $in: ids }, status: "active" } },
    { $group: { _id: "$borrowingId", count: { $sum: 1 } } },
  ]);

  const result = new Map<string, number>();
  for (const row of rows) result.set(row._id.toString(), row.count);
  return result;
}
