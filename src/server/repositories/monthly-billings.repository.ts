import type { ClientSession } from "mongoose";
import { Types } from "mongoose";

import { db } from "@/database/connection";
import {
  MonthlyBillingModel,
  type MonthlyBillingDoc,
} from "@/database/models/monthly-billing.model";
import { assertCreated } from "@/server/repositories/assert-created";
import type { BillingGeneratedBy, PayStatus } from "@/constants/domain";

/** Statuses a due can hold while money is still owed on it. Kept here so the
 * dues scan, the reminder cron and the "can this client be billed again"
 * checks can never drift apart. */
export const OPEN_BILLING_STATUSES: PayStatus[] = ["PENDING", "PARTIALLY_PAID"];

export async function findBillingById(id: string) {
  await db();
  if (!Types.ObjectId.isValid(id)) return null;
  return MonthlyBillingModel.findById(id).lean();
}

export async function findBillingByClientAndMonth(clientId: string, monthKey: string) {
  await db();
  return MonthlyBillingModel.findOne({ clientId, monthKey }).lean();
}

/** Exact-period lookup — the idempotency check the rollover relies on
 * (mirrors the {clientId, periodStart} unique index). */
export async function findBillingByClientAndPeriodStart(clientId: string, periodStart: Date) {
  await db();
  if (!Types.ObjectId.isValid(clientId)) return null;
  return MonthlyBillingModel.findOne({
    clientId: new Types.ObjectId(clientId),
    periodStart,
  }).lean();
}

/** The client's most recent period — the cursor the rollover advances from,
 * so periods are always generated forward from real history rather than
 * from today's calendar month (which would back-bill a brand-new client). */
export async function findLatestBillingForClient(clientId: string) {
  await db();
  if (!Types.ObjectId.isValid(clientId)) return null;
  return MonthlyBillingModel.findOne({ clientId: new Types.ObjectId(clientId) })
    .sort({ periodStart: -1 })
    .lean();
}

export type InsertBillingInput = {
  clientId: string;
  periodStart: Date;
  periodEnd: Date;
  monthKey: string;
  billedPaise: number;
  dueDate: Date;
  generatedBy: BillingGeneratedBy;
  note?: string | null;
};

export async function insertBilling(input: InsertBillingInput, session?: ClientSession) {
  await db();
  const [doc] = await MonthlyBillingModel.create(
    [
      {
        clientId: new Types.ObjectId(input.clientId),
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        monthKey: input.monthKey,
        billedPaise: input.billedPaise,
        carriedInPaise: 0,
        carriedOutPaise: 0,
        dueDate: input.dueDate,
        note: input.note ?? null,
        generatedBy: input.generatedBy,
      },
    ],
    session ? { session } : undefined
  );
  return assertCreated(doc, "monthly billing");
}

/** $inc paidPaise, returning the post-inc document so the service can
 * recompute status from it via financial-engine's deriveBillingStatus
 * (repositories stay pure data access; the formula lives in the engine). */
export async function incrementBillingPaid(
  billingId: string,
  deltaPaise: number,
  session: ClientSession
): Promise<(MonthlyBillingDoc & { _id: Types.ObjectId }) | null> {
  await db();
  return MonthlyBillingModel.findOneAndUpdate(
    { _id: new Types.ObjectId(billingId) },
    { $inc: { paidPaise: deltaPaise } },
    { session, returnDocument: "after" }
  ).lean();
}

export async function setBillingStatus(billingId: string, status: PayStatus, session: ClientSession) {
  await db();
  await MonthlyBillingModel.updateOne(
    { _id: new Types.ObjectId(billingId) },
    { $set: { status } },
    { session }
  );
}

export type UpdateBillingFields = {
  periodStart?: Date;
  periodEnd?: Date;
  monthKey?: string;
  billedPaise?: number;
  dueDate?: Date;
  note?: string | null;
};

/** Optimistic-locked edit of an unpaid due. Returns null when the version is
 * stale (someone else edited it first) or the row is gone. */
export async function updateBillingOptimistic(
  billingId: string,
  version: number,
  fields: UpdateBillingFields,
  session?: ClientSession
) {
  await db();
  if (!Types.ObjectId.isValid(billingId)) return null;
  return MonthlyBillingModel.findOneAndUpdate(
    { _id: new Types.ObjectId(billingId), version },
    { $set: fields, $inc: { version: 1 } },
    { returnDocument: "after", ...(session ? { session } : {}) }
  ).lean();
}

/** Hard-deletes a due. Only ever called for a due with zero payments against
 * it — the service enforces that, so no payment can be orphaned. The audit
 * log keeps the record of what was removed (Law 3: the trail is append-only
 * and outlives the row). */
export async function deleteBilling(billingId: string, session: ClientSession) {
  await db();
  await MonthlyBillingModel.deleteOne({ _id: new Types.ObjectId(billingId) }, { session });
}

/** All periods for a client, newest period first. */
export async function findBillingsByClient(clientId: string) {
  await db();
  return MonthlyBillingModel.find({ clientId }).sort({ periodStart: -1 }).lean();
}

/** Every billing with the given status(es) — the indexed path for "billings
 * with remaining > 0" (the {status:1,dueDate:1} index), since `remaining`
 * isn't itself a stored field. */
export async function findBillingsByStatus(statuses: PayStatus[]) {
  await db();
  return MonthlyBillingModel.find({ status: { $in: statuses } }).lean();
}

/** Every MonthlyBilling row reported in one month, across every client;
 * backs the Ledger Overview's "Billed" drill-down (/ledger/billed), whose
 * rows must sum to the exact same total as sumBilledForMonth. */
export async function findBillingsByMonth(monthKey: string) {
  await db();
  return MonthlyBillingModel.find({ monthKey }).lean();
}

/** Every billing reported across an inclusive span of months — the range
 * sibling of findBillingsByMonth, backing the Billed drill-down under the
 * From–To picker. */
export async function findBillingsInMonthRange(fromMonthKey: string, toMonthKey: string) {
  await db();
  return MonthlyBillingModel.find({
    monthKey: { $gte: fromMonthKey, $lte: toMonthKey },
  }).lean();
}

export async function sumBilledForMonth(monthKey: string): Promise<number> {
  await db();
  const [result] = await MonthlyBillingModel.aggregate<{ total: number }>([
    { $match: { monthKey } },
    { $group: { _id: null, total: { $sum: "$billedPaise" } } },
  ]);
  return result?.total ?? 0;
}
