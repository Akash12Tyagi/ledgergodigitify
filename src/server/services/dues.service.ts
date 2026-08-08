import { AppError } from "@/lib/errors";
import { withDbTransaction } from "@/lib/db-transaction";
import { isDuplicateKeyError } from "@/lib/idempotency";
import { formatINR } from "@/lib/money";
import { formatPeriodLabel, reportingMonthKey } from "@/lib/billing-period";
import { findClientById } from "@/server/repositories/clients.repository";
import {
  deleteBilling,
  findBillingById,
  insertBilling,
  updateBillingOptimistic,
} from "@/server/repositories/monthly-billings.repository";
import { findPaymentsByBilling } from "@/server/repositories/payments.repository";
import { logAudit } from "@/server/services/audit.service";
import type { AuthedUser } from "@/server/auth/guards";
import type { CreateDueInput, DeleteDueInput, UpdateDueInput } from "@/schemas/due.schema";

// Manual dues. The rollover raises a retainer's recurring periods on its
// own; this is the hand-operated path for everything else — a one-off
// charge, an extra project fee alongside a retainer, backfilling a period
// that predates the system, or correcting a due entered wrong.

/**
 * A due can only be edited or removed while NO payment has ever been
 * recorded against it — not even a reversed one.
 *
 * Checking `paidPaise === 0` alone is not enough: reversing a payment
 * returns paidPaise to zero while the Payment document still points at this
 * billing. Deleting under that condition would orphan a real receipt, and
 * re-dating the period would silently change what an already-issued invoice
 * was for. Both are unacceptable in a ledger whose audit trail is meant to
 * be trustworthy, so the payment rows themselves are the gate.
 */
async function assertDueUntouched(billingId: string, verb: string) {
  const payments = await findPaymentsByBilling(billingId);
  if (payments.length > 0) {
    throw new AppError(
      "CONFLICT",
      `This due already has ${payments.length} payment${payments.length === 1 ? "" : "s"} recorded against it and can no longer be ${verb}. Reverse the payment first, then record a corrected entry.`
    );
  }
}

export async function createDue(input: CreateDueInput, actor: AuthedUser) {
  const client = await findClientById(input.clientId);
  if (!client) throw new AppError("NOT_FOUND", "Client not found");
  if (client.status === "archived") {
    throw new AppError("ARCHIVED_CLIENT", "This client is archived. Unarchive to add a due.");
  }

  try {
    return await withDbTransaction(async (session) => {
      const billing = await insertBilling(
        {
          clientId: input.clientId,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          monthKey: reportingMonthKey(input.dueDate),
          billedPaise: input.amountPaise,
          dueDate: input.dueDate,
          note: input.note ?? null,
          generatedBy: "manual",
        },
        session
      );

      const label = formatPeriodLabel(input.periodStart, input.periodEnd);
      await logAudit(
        {
          actorUserId: actor.id,
          actorName: actor.name,
          action: "DUE_CREATED",
          entity: { kind: "billing", id: billing._id },
          after: {
            clientId: input.clientId,
            period: label,
            billedPaise: input.amountPaise,
            dueDate: input.dueDate,
          },
          summary: `${actor.name} added a ${formatINR(input.amountPaise)} due for "${client.name}" (${label})`,
        },
        session
      );

      return billing;
    });
  } catch (error) {
    // The {clientId, periodStart} unique index is what actually guarantees a
    // period is never billed twice; this turns its raw E11000 into something
    // the form can show.
    if (isDuplicateKeyError(error, "periodStart")) {
      throw new AppError(
        "CONFLICT",
        "This client already has a due starting on that date. Edit that due instead of adding a second one.",
        { fields: { periodStart: "A due already starts on this date" } }
      );
    }
    throw error;
  }
}

export async function updateDue(input: UpdateDueInput, actor: AuthedUser) {
  const before = await findBillingById(input.dueId);
  if (!before) throw new AppError("NOT_FOUND", "Due not found");
  await assertDueUntouched(input.dueId, "edited");

  const client = await findClientById(before.clientId.toString());

  try {
    return await withDbTransaction(async (session) => {
      const updated = await updateBillingOptimistic(
        input.dueId,
        input.version,
        {
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          monthKey: reportingMonthKey(input.dueDate),
          billedPaise: input.amountPaise,
          dueDate: input.dueDate,
          note: input.note ?? null,
        },
        session
      );
      if (!updated) {
        throw new AppError(
          "CONFLICT",
          "This due was updated by someone else. Refresh to see the latest."
        );
      }

      const label = formatPeriodLabel(input.periodStart, input.periodEnd);
      await logAudit(
        {
          actorUserId: actor.id,
          actorName: actor.name,
          action: "DUE_UPDATED",
          entity: { kind: "billing", id: updated._id },
          before: {
            period: formatPeriodLabel(before.periodStart, before.periodEnd),
            billedPaise: before.billedPaise,
            dueDate: before.dueDate,
          },
          after: { period: label, billedPaise: input.amountPaise, dueDate: input.dueDate },
          summary: `${actor.name} updated a due for "${client?.name ?? "a client"}" (${label})`,
        },
        session
      );

      return updated;
    });
  } catch (error) {
    if (isDuplicateKeyError(error, "periodStart")) {
      throw new AppError(
        "CONFLICT",
        "This client already has a due starting on that date.",
        { fields: { periodStart: "A due already starts on this date" } }
      );
    }
    throw error;
  }
}

/**
 * Removes a due raised in error. The row goes, but the audit entry recording
 * what it was — client, period, amount, and the reason given — stays forever
 * (Law 3: the trail is append-only and outlives the row it describes).
 */
export async function deleteDue(input: DeleteDueInput, actor: AuthedUser) {
  const billing = await findBillingById(input.dueId);
  if (!billing) throw new AppError("NOT_FOUND", "Due not found");
  await assertDueUntouched(input.dueId, "deleted");

  const client = await findClientById(billing.clientId.toString());
  const label = formatPeriodLabel(billing.periodStart, billing.periodEnd);

  return withDbTransaction(async (session) => {
    await deleteBilling(input.dueId, session);

    await logAudit(
      {
        actorUserId: actor.id,
        actorName: actor.name,
        action: "DUE_DELETED",
        entity: { kind: "client", id: billing.clientId },
        before: {
          period: label,
          billedPaise: billing.billedPaise,
          dueDate: billing.dueDate,
          generatedBy: billing.generatedBy,
        },
        after: { reason: input.reason },
        summary: `${actor.name} deleted a ${formatINR(billing.billedPaise)} due for "${client?.name ?? "a client"}" (${label}) — ${input.reason}`,
      },
      session
    );

    return { clientId: billing.clientId.toString() };
  });
}
