import type { ClientSession } from "mongoose";
import { Types } from "mongoose";

import { db } from "@/database/connection";
import { PaymentModel } from "@/database/models/payment.model";
import { assertCreated } from "@/server/repositories/assert-created";
import type { StampedAttachmentMeta } from "@/types/attachment";
import type { PaymentMethod } from "@/constants/domain";

export type InsertPaymentInput = {
  /** Pre-generated so the mutually-referencing Payment<->Transaction pair
   * (each requires the other's id) can be inserted without a circular
   * dependency — see payments.service.ts#recordPayment. */
  _id: Types.ObjectId;
  clientId: string;
  monthlyBillingId: string;
  accountId: string;
  amountPaise: number;
  paidAt: Date;
  monthKey: string;
  method: PaymentMethod;
  invoiceNumber: string;
  receiptNumber: string;
  reference?: string | null;
  note?: string | null;
  attachments?: StampedAttachmentMeta[];
  transactionId: Types.ObjectId;
  idempotencyKey: string;
  createdBy: string;
};

export async function insertPayment(input: InsertPaymentInput, session: ClientSession) {
  await db();
  const [doc] = await PaymentModel.create(
    [
      {
        _id: input._id,
        clientId: new Types.ObjectId(input.clientId),
        monthlyBillingId: new Types.ObjectId(input.monthlyBillingId),
        accountId: new Types.ObjectId(input.accountId),
        amountPaise: input.amountPaise,
        paidAt: input.paidAt,
        monthKey: input.monthKey,
        method: input.method,
        invoiceNumber: input.invoiceNumber,
        receiptNumber: input.receiptNumber,
        reference: input.reference ?? null,
        note: input.note ?? null,
        attachments: input.attachments ?? [],
        transactionId: input.transactionId,
        idempotencyKey: input.idempotencyKey,
        createdBy: new Types.ObjectId(input.createdBy),
      },
    ],
    { session }
  );
  return assertCreated(doc, "payment");
}

export async function findPaymentById(id: string) {
  await db();
  if (!Types.ObjectId.isValid(id)) return null;
  return PaymentModel.findById(id).lean();
}

export async function findPaymentByIdempotencyKey(idempotencyKey: string) {
  await db();
  return PaymentModel.findOne({ idempotencyKey }).lean();
}

/** Section 6.1 — manual invoiceNumber/receiptNumber entry (Task 2):
 * pre-insert uniqueness checks, mirroring the unique index each field
 * already carries (paymentSchema). */
export async function findPaymentByInvoiceNumber(invoiceNumber: string) {
  await db();
  return PaymentModel.findOne({ invoiceNumber }).lean();
}

export async function findPaymentByReceiptNumber(receiptNumber: string) {
  await db();
  return PaymentModel.findOne({ receiptNumber }).lean();
}

export async function findPaymentsByClient(clientId: string) {
  await db();
  return PaymentModel.find({ clientId }).sort({ paidAt: -1 }).lean();
}

/** Section 7.4 "current" tab — the payment trail for one month's billing,
 * oldest first (matches the "+₹8,000 ... +₹5,000 ... = total" equation
 * layout). Includes reversed payments (Section 6.2: "stays visible in
 * trails with a struck-through style"). */
export async function findPaymentsByBilling(monthlyBillingId: string) {
  await db();
  return PaymentModel.find({ monthlyBillingId }).sort({ paidAt: 1 }).lean();
}

export async function markPaymentReversed(
  id: string,
  reversedBy: string,
  reversedReason: string,
  session: ClientSession
) {
  await db();
  await PaymentModel.updateOne(
    { _id: new Types.ObjectId(id) },
    {
      $set: {
        status: "reversed",
        reversedBy: new Types.ObjectId(reversedBy),
        reversedReason,
      },
    },
    { session }
  );
}
