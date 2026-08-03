import type { ClientSession } from "mongoose";
import { Types } from "mongoose";

import { db } from "@/database/connection";
import {
  MonthlyBillingModel,
  type MonthlyBillingDoc,
} from "@/database/models/monthly-billing.model";
import { assertCreated } from "@/server/repositories/assert-created";
import type { BillingGeneratedBy, PayStatus } from "@/constants/domain";

export async function findBillingById(id: string) {
  await db();
  if (!Types.ObjectId.isValid(id)) return null;
  return MonthlyBillingModel.findById(id).lean();
}

export async function findBillingByClientAndMonth(clientId: string, monthKey: string) {
  await db();
  return MonthlyBillingModel.findOne({ clientId, monthKey }).lean();
}

export type InsertBillingInput = {
  clientId: string;
  monthKey: string;
  billedPaise: number;
  carriedInPaise?: number;
  dueDate: Date;
  generatedBy: BillingGeneratedBy;
};

export async function insertBilling(input: InsertBillingInput, session?: ClientSession) {
  await db();
  const [doc] = await MonthlyBillingModel.create(
    [
      {
        clientId: new Types.ObjectId(input.clientId),
        monthKey: input.monthKey,
        billedPaise: input.billedPaise,
        carriedInPaise: input.carriedInPaise ?? 0,
        dueDate: input.dueDate,
        generatedBy: input.generatedBy,
      },
    ],
    session ? { session } : undefined
  );
  return assertCreated(doc, "monthly billing");
}

/** Section 6.1 step 6 / 6.2 step 5 — $inc paidPaise, returning the
 * post-inc document so the service can recompute status from it via
 * financial-engine's deriveBillingStatus (repositories stay pure data
 * access; the formula lives in the service/engine layer). */
export async function incrementBillingPaid(
  billingId: string,
  deltaPaise: number,
  session: ClientSession
): Promise<MonthlyBillingDoc & { _id: Types.ObjectId } | null> {
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

/**
 * Section 6.8A — "carry-as-a-MOVE": the source month's unpaid remainder
 * (or overpaid surplus) is recorded as carriedOutPaise so it stops
 * counting against that month's own target, and — as the caller's own
 * $set already reflects — its status is recomputed from the new target in
 * the same write (never left stale at PARTIALLY_PAID after the money
 * that made it partial has been moved into next month's carriedInPaise).
 */
export async function setBillingCarriedOut(
  billingId: string,
  carriedOutPaise: number,
  status: PayStatus,
  session: ClientSession
) {
  await db();
  await MonthlyBillingModel.updateOne(
    { _id: new Types.ObjectId(billingId) },
    { $set: { carriedOutPaise, status } },
    { session }
  );
}

export async function findBillingsByClient(clientId: string) {
  await db();
  return MonthlyBillingModel.find({ clientId }).sort({ monthKey: -1 }).lean();
}

/** Every billing with the given status(es) — the indexed path for
 * "billings with remaining > 0" (Section 5.3's {dueDate:1,status:1} index),
 * since remaining isn't itself a stored field. */
export async function findBillingsByStatus(statuses: PayStatus[]) {
  await db();
  return MonthlyBillingModel.find({ status: { $in: statuses } }).lean();
}

/** Section 15/M8 — every MonthlyBilling row for one month, across every
 * client; backs the Ledger Overview's "Billed" drill-down (/ledger/billed),
 * whose rows must sum to the exact same total as sumBilledForMonth. */
export async function findBillingsByMonth(monthKey: string) {
  await db();
  return MonthlyBillingModel.find({ monthKey }).lean();
}

export async function sumBilledForMonth(monthKey: string): Promise<number> {
  await db();
  const [result] = await MonthlyBillingModel.aggregate<{ total: number }>([
    { $match: { monthKey } },
    { $group: { _id: null, total: { $sum: "$billedPaise" } } },
  ]);
  return result?.total ?? 0;
}
