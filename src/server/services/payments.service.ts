import { Types } from "mongoose";

import { AppError } from "@/lib/errors";
import { withDbTransaction } from "@/lib/db-transaction";
import { runWithIdempotency, isDuplicateKeyError } from "@/lib/idempotency";
import { isAfterTodayIST, nowIST } from "@/lib/dates";
import { findClientById } from "@/server/repositories/clients.repository";
import {
  findBillingById,
  incrementBillingPaid,
  setBillingStatus,
} from "@/server/repositories/monthly-billings.repository";
import { findAccountById, incrementAccountBalance } from "@/server/repositories/accounts.repository";
import {
  findPaymentByIdempotencyKey,
  findPaymentByInvoiceNumber,
  findPaymentByReceiptNumber,
  findPaymentById,
  insertPayment,
  markPaymentReversed,
} from "@/server/repositories/payments.repository";
import { insertTransaction, markTransactionReversed } from "@/server/repositories/transactions.repository";
import { stampAttachments } from "@/lib/attachments";
import { logAudit } from "@/server/services/audit.service";
import { notify, markEntityNotificationsRead } from "@/server/services/notifications.service";
import { deriveBillingStatus } from "@/server/services/financial-engine";
import type { AuthedUser } from "@/server/auth/guards";
import type { RecordPaymentInput, ReversePaymentInput } from "@/schemas/payment.schema";

// Section 6.1 — recordPayment.
export async function recordPayment(input: RecordPaymentInput, actor: AuthedUser) {
  return runWithIdempotency({
    fetchExisting: async () => {
      const payment = await findPaymentByIdempotencyKey(input.idempotencyKey);
      if (!payment) return null;
      const billing = await findBillingById(payment.monthlyBillingId.toString());
      const account = await findAccountById(payment.accountId.toString());
      return {
        payment,
        newBillingStatus: billing ? deriveBillingStatus(billing).status : "PENDING",
        accountNewBalance: account?.currentBalancePaise ?? 0,
      };
    },
    run: () => recordPaymentTransaction(input, actor),
  });
}

/** Split out of recordPayment's `run` so the rare-race duplicate-key
 * fallback (invoiceNumber/receiptNumber submitted identically by two
 * concurrent requests, past the pre-check above) can wrap the whole
 * transaction in a single try/catch. */
async function recordPaymentTransaction(input: RecordPaymentInput, actor: AuthedUser) {
  try {
    return await withDbTransaction(async (session) => {
      // Step 1 — load & validate.
      const client = await findClientById(input.clientId);
      if (!client) throw new AppError("NOT_FOUND", "Client not found");
      if (client.status === "archived") {
        throw new AppError(
          "ARCHIVED_CLIENT",
          "This client is archived. Unarchive to record payments."
        );
      }

      const billing = await findBillingById(input.monthlyBillingId);
      if (!billing || billing.clientId.toString() !== input.clientId) {
        throw new AppError("NOT_FOUND", "Billing not found for this client");
      }

      const account = await findAccountById(input.accountId);
      if (!account || account.status !== "active") {
        throw new AppError("VALIDATION", "Selected account is not active");
      }
      if (account.reconcileLock) {
        throw new AppError(
          "LOCKED",
          "This account is locked pending reconciliation. Resolve it in Settings before recording payments."
        );
      }

      // Server-authoritative date check (Section 14 edge case 45) — never
      // trust a client clock, only IST-derived helpers.
      if (isAfterTodayIST(input.paidAt)) {
        throw new AppError("VALIDATION", "Payment date cannot be in the future.");
      }

      const wasOverdue =
        billing.dueDate.getTime() < nowIST().getTime() && deriveBillingStatus(billing).remainingPaise > 0;

      // Step 2 — invoice/receipt numbers are entered manually now (Task 2:
      // no more counter-based auto-generation, see counters.repository.ts's
      // removal). Both are already trimmed by recordPaymentSchema; this is
      // the common-case uniqueness check with a clear per-field error —
      // the unique index on each field (payment.model.ts) is the actual
      // guarantee, caught as a fallback around the transaction below in
      // case two identical numbers are submitted concurrently.
      //
      // A match sharing THIS request's idempotencyKey isn't a real
      // conflict — it's the earlier attempt of an idempotent retry (double-
      // click, network retry resubmitting the identical form). That case
      // must fall through to the insert below, whose own idempotencyKey
      // unique-index hit is what runWithIdempotency (lib/idempotency.ts)
      // catches to replay the original result — never a VALIDATION error.
      const invoiceNumber = input.invoiceNumber;
      const receiptNumber = input.receiptNumber;

      const [existingInvoice, existingReceipt] = await Promise.all([
        findPaymentByInvoiceNumber(invoiceNumber),
        findPaymentByReceiptNumber(receiptNumber),
      ]);
      if (existingInvoice && existingInvoice.idempotencyKey !== input.idempotencyKey) {
        throw new AppError("VALIDATION", "This invoice number is already in use.", {
          fields: { invoiceNumber: "Already in use" },
        });
      }
      if (existingReceipt && existingReceipt.idempotencyKey !== input.idempotencyKey) {
        throw new AppError("VALIDATION", "This receipt number is already in use.", {
          fields: { receiptNumber: "Already in use" },
        });
      }

      // Steps 3-4 — Payment and Transaction mutually reference each
      // other's id, so both ids are pre-generated.
      const paymentId = new Types.ObjectId();
      const transactionId = new Types.ObjectId();

      await insertTransaction(
        {
          _id: transactionId,
          type: "PAYMENT_IN",
          direction: "IN",
          amountPaise: input.amountPaise,
          accountId: input.accountId,
          occurredAt: input.paidAt,
          monthKey: billing.monthKey,
          clientId: input.clientId,
          paymentId: paymentId.toString(),
          invoiceNumber,
          receiptNumber,
          counterpartyLabel: client.name,
          idempotencyKey: input.idempotencyKey,
          createdBy: actor.id,
        },
        session
      );

      const payment = await insertPayment(
        {
          _id: paymentId,
          clientId: input.clientId,
          monthlyBillingId: input.monthlyBillingId,
          accountId: input.accountId,
          amountPaise: input.amountPaise,
          paidAt: input.paidAt,
          monthKey: billing.monthKey,
          method: input.method,
          invoiceNumber,
          receiptNumber,
          reference: input.reference ?? null,
          note: input.note ?? null,
          attachments: stampAttachments(input.attachments, actor.id),
          transactionId,
          idempotencyKey: input.idempotencyKey,
          createdBy: actor.id,
        },
        session
      );

      // Step 5 — account balance.
      const updatedAccount = await incrementAccountBalance(input.accountId, input.amountPaise, session);
      if (!updatedAccount) {
        throw new AppError("VALIDATION", "Selected account is not active");
      }

      // Step 6 — billing paidPaise + recomputed status, post-inc values.
      const updatedBilling = await incrementBillingPaid(input.monthlyBillingId, input.amountPaise, session);
      if (!updatedBilling) throw new AppError("NOT_FOUND", "Billing not found");
      const { status: newBillingStatus, remainingPaise } = deriveBillingStatus(updatedBilling);
      await setBillingStatus(input.monthlyBillingId, newBillingStatus, session);

      // Step 8 — PAYMENT_RECEIVED notification.
      await notify(
        {
          type: "PAYMENT_RECEIVED",
          severity: "info",
          title: "Payment received",
          body: `₹${(input.amountPaise / 100).toLocaleString("en-IN")} from ${client.name} into ${account.name} (${receiptNumber})`,
          entityRef: { kind: "payment", id: paymentId.toString() },
          href: `/clients/${input.clientId}?tab=current`,
          audience: "all",
          dedupeKey: `PAY:${paymentId.toString()}`,
        },
        session
      );

      // Step 9 — clear DUE_OVERDUE if this settled the billing.
      if (wasOverdue && remainingPaise === 0) {
        await markEntityNotificationsRead("client", input.clientId, "DUE_OVERDUE", session);
      }

      // Step 10 — audit.
      await logAudit(
        {
          actorUserId: actor.id,
          actorName: actor.name,
          action: "PAYMENT_RECORDED",
          entity: { kind: "payment", id: paymentId },
          before: { paidPaise: billing.paidPaise, status: billing.status },
          after: { paidPaise: updatedBilling.paidPaise, status: newBillingStatus },
          summary: `${actor.name} recorded ₹${(input.amountPaise / 100).toLocaleString("en-IN")} payment for ${client.name} (${receiptNumber}) into ${account.name}`,
        },
        session
      );

      return {
        payment: payment.toObject(),
        newBillingStatus,
        accountNewBalance: updatedAccount.currentBalancePaise,
      };
    });
  } catch (error) {
    // Rare-race fallback: two concurrent submits both passed the pre-check
    // above before either had inserted. The unique index (payment.model.ts)
    // is what actually prevents the duplicate; this just keeps the error
    // message clean instead of surfacing a raw Mongo E11000.
    if (isDuplicateKeyError(error, "invoiceNumber")) {
      throw new AppError("VALIDATION", "This invoice number is already in use.", {
        fields: { invoiceNumber: "Already in use" },
      });
    }
    if (isDuplicateKeyError(error, "receiptNumber")) {
      throw new AppError("VALIDATION", "This receipt number is already in use.", {
        fields: { receiptNumber: "Already in use" },
      });
    }
    throw error;
  }
}

// Section 6.2 — reversePayment. Role: admin+ (enforced by the action
// wrapper's requireUser call, not here).
export async function reversePayment(input: ReversePaymentInput, actor: AuthedUser) {
  return runWithIdempotency({
    fetchExisting: async () => {
      const payment = await findPaymentById(input.paymentId);
      if (!payment || payment.status !== "reversed") return null;
      const billing = await findBillingById(payment.monthlyBillingId.toString());
      const account = await findAccountById(payment.accountId.toString());
      return {
        payment,
        newBillingStatus: billing ? deriveBillingStatus(billing).status : "PENDING",
        accountNewBalance: account?.currentBalancePaise ?? 0,
      };
    },
    run: () =>
      withDbTransaction(async (session) => {
        const payment = await findPaymentById(input.paymentId);
        if (!payment) throw new AppError("NOT_FOUND", "Payment not found");
        if (payment.status !== "active") {
          throw new AppError("CONFLICT", "Already reversed. Record a fresh entry instead.");
        }

        const billing = await findBillingById(payment.monthlyBillingId.toString());
        if (!billing) throw new AppError("NOT_FOUND", "Billing not found");

        // Step 2 — REVERSAL transaction.
        const groupId = new Types.ObjectId();
        const reversalTx = await insertTransaction(
          {
            type: "REVERSAL",
            direction: "OUT",
            amountPaise: payment.amountPaise,
            accountId: payment.accountId.toString(),
            occurredAt: new Date(),
            monthKey: payment.monthKey,
            clientId: payment.clientId.toString(),
            paymentId: payment._id.toString(),
            reversesTransactionId: payment.transactionId.toString(),
            transactionGroupId: groupId,
            counterpartyLabel: null,
            idempotencyKey: input.idempotencyKey,
            createdBy: actor.id,
          },
          session
        );

        // Step 3 — mark original transaction + payment reversed.
        await markTransactionReversed(payment.transactionId.toString(), session);
        await markPaymentReversed(payment._id.toString(), actor.id, input.reason, session);

        // Step 4 — account balance MAY go negative; that's allowed.
        const updatedAccount = await incrementAccountBalance(
          payment.accountId.toString(),
          -payment.amountPaise,
          session
        );
        if (!updatedAccount) throw new AppError("VALIDATION", "Account is not active");

        // Step 5 — billing paidPaise decreases; status may drop.
        const updatedBilling = await incrementBillingPaid(
          payment.monthlyBillingId.toString(),
          -payment.amountPaise,
          session
        );
        if (!updatedBilling) throw new AppError("NOT_FOUND", "Billing not found");
        const { status: newBillingStatus, remainingPaise } = deriveBillingStatus(updatedBilling);
        await setBillingStatus(payment.monthlyBillingId.toString(), newBillingStatus, session);

        if (updatedBilling.dueDate.getTime() < nowIST().getTime() && remainingPaise > 0) {
          const client = await findClientById(payment.clientId.toString());
          await notify(
            {
              type: "DUE_OVERDUE",
              severity: "warning",
              title: "Payment reversed — client is overdue again",
              body: `${client?.name ?? "A client"}'s ${payment.monthKey} billing is overdue again after a reversal.`,
              entityRef: { kind: "client", id: payment.clientId.toString() },
              href: `/clients/${payment.clientId.toString()}?tab=dues`,
              audience: "all",
              dedupeKey: `OVERDUE:${payment.monthlyBillingId.toString()}:r${reversalTx._id.toString()}`,
            },
            session
          );
        }

        // Step 6 — audit.
        await logAudit(
          {
            actorUserId: actor.id,
            actorName: actor.name,
            action: "PAYMENT_REVERSED",
            entity: { kind: "payment", id: payment._id },
            before: { paidPaise: billing.paidPaise, status: billing.status },
            after: { paidPaise: updatedBilling.paidPaise, status: newBillingStatus },
            summary: `${actor.name} reversed ${payment.receiptNumber} (${input.reason})`,
          },
          session
        );

        return {
          payment: { ...payment, status: "reversed" as const, reversedReason: input.reason },
          newBillingStatus,
          accountNewBalance: updatedAccount.currentBalancePaise,
        };
      }),
  });
}
