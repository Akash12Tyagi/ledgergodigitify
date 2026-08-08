import { AppError } from "@/lib/errors";
import { withDbTransaction } from "@/lib/db-transaction";
import { anchorDayFrom, periodEndFor, reportingMonthKey } from "@/lib/billing-period";
import { logAudit } from "@/server/services/audit.service";
import {
  findClientByNameCaseInsensitive,
  findClientById,
  findClientsFiltered,
  insertClient,
  setClientStatus,
  updateClientOptimistic,
  type ClientListFilter,
} from "@/server/repositories/clients.repository";
import { insertBilling } from "@/server/repositories/monthly-billings.repository";
import { findPaymentsByClient } from "@/server/repositories/payments.repository";
import { getClientDuesSummary } from "@/server/services/financial-engine";
import type { AuthedUser } from "@/server/auth/guards";
import type { ClientInput, UpdateClientInput } from "@/schemas/client.schema";
import type { ClientListRow } from "@/types/client";

// Section 6.6 — createClient. The duplicate-name check (step 1) is
// deliberately NOT performed here — it's a separate, non-blocking,
// pre-submit UI warning (checkClientName below), not a create-time
// validation. Client + first MonthlyBilling insert atomically (Law 4).
export async function createClient(input: ClientInput, actor: AuthedUser) {
  return withDbTransaction(async (session) => {
    // The cycle anchor: the day-of-month every future period starts on. A
    // client whose first due date is the 20th runs 20th-to-20th from then on,
    // which is what makes non-calendar cycles work at all.
    const anchorDay = input.billingDay ?? anchorDayFrom(input.nextDueDate);
    const billingDay = input.engagementType === "retainer" ? anchorDay : null;

    const client = await insertClient(
      {
        name: input.name,
        service: input.service,
        engagementType: input.engagementType,
        amountPaise: input.amountPaise,
        nextDueDate: input.nextDueDate,
        billingDay,
        email: input.email ?? null,
        phone: input.phone ?? null,
        company: input.company ?? null,
        address: input.address ?? null,
        gstin: input.gstin ?? null,
        notes: input.notes ?? null,
        createdBy: actor.id,
      },
      session
    );

    // The first due covers the period STARTING on the client's first due
    // date. Retainers are collected up front, so dueDate === periodStart:
    // the money for 20 Aug – 19 Sep is owed on 20 Aug, not at the end.
    const periodStart = input.nextDueDate;
    const periodEnd = periodEndFor(periodStart, anchorDay);

    const billing = await insertBilling(
      {
        clientId: client._id.toString(),
        periodStart,
        periodEnd,
        monthKey: reportingMonthKey(periodStart),
        billedPaise: input.amountPaise,
        dueDate: periodStart,
        generatedBy: "client_create",
      },
      session
    );

    await logAudit(
      {
        actorUserId: actor.id,
        actorName: actor.name,
        action: "CLIENT_CREATED",
        entity: { kind: "client", id: client._id },
        after: { name: client.name, engagementType: client.engagementType, amountPaise: client.amountPaise },
        summary: `${actor.name} created client "${client.name}" (${client.engagementType})`,
      },
      session
    );

    return { client, billing };
  });
}

/** Read-only — returns a warning flag, never blocks (Section 6.6 step 1 /
 * Section 14 edge case 25). */
export async function checkClientName(name: string) {
  const existing = await findClientByNameCaseInsensitive(name);
  return { duplicate: Boolean(existing), existingClientId: existing ? existing._id.toString() : null };
}

// Section 6.7 — optimistic-lock update. Changing amountPaise/nextDueDate/
// billingDay affects ONLY future billings/rollovers — existing
// MonthlyBilling rows are never touched here.
export async function updateClient(clientId: string, input: UpdateClientInput, actor: AuthedUser) {
  const before = await findClientById(clientId);
  if (!before) throw new AppError("NOT_FOUND", "Client not found");

  const { version, ...fields } = input;

  return withDbTransaction(async (session) => {
    const updated = await updateClientOptimistic(clientId, version, fields);
    if (!updated) {
      throw new AppError(
        "CONFLICT",
        "This client was updated by someone else. Refresh to see the latest."
      );
    }

    await logAudit(
      {
        actorUserId: actor.id,
        actorName: actor.name,
        action: "CLIENT_UPDATED",
        entity: { kind: "client", id: updated._id },
        before,
        after: updated,
        summary: `${actor.name} updated client "${updated.name}"`,
      },
      session
    );

    return updated;
  });
}

async function transitionClientStatus(
  clientId: string,
  actor: AuthedUser,
  action: "CLIENT_PAUSED" | "CLIENT_RESUMED" | "CLIENT_ARCHIVED" | "CLIENT_UNARCHIVED",
  status: "active" | "paused" | "archived",
  extra: { archivedAt?: Date | null; archiveReason?: string | null } = {}
) {
  const before = await findClientById(clientId);
  if (!before) throw new AppError("NOT_FOUND", "Client not found");

  return withDbTransaction(async (session) => {
    const updated = await setClientStatus(clientId, status, extra);
    if (!updated) throw new AppError("NOT_FOUND", "Client not found");

    await logAudit(
      {
        actorUserId: actor.id,
        actorName: actor.name,
        action,
        entity: { kind: "client", id: updated._id },
        before,
        after: updated,
        summary: `${actor.name} set client "${updated.name}" to ${status}`,
      },
      session
    );

    return updated;
  });
}

export async function pauseClient(clientId: string, actor: AuthedUser) {
  return transitionClientStatus(clientId, actor, "CLIENT_PAUSED", "paused");
}

// Section 14 edge case 16 — resume picks up rollover from the current
// cron run; months skipped while paused are NOT back-billed.
export async function resumeClient(clientId: string, actor: AuthedUser) {
  return transitionClientStatus(clientId, actor, "CLIENT_RESUMED", "active");
}

// Section 7.4 — if total due > 0, the UI shows a warning dialog before
// calling this; dues stay visible under "Archived clients with dues"
// (Section 14 edge case 26) since archiving never touches MonthlyBilling.
export async function archiveClient(clientId: string, reason: string | null, actor: AuthedUser) {
  return transitionClientStatus(clientId, actor, "CLIENT_ARCHIVED", "archived", {
    archivedAt: new Date(),
    archiveReason: reason,
  });
}

// Section 14 edge case 28 — returns to active; retainer rollover resumes
// from the current month, no back-billing of archived months.
export async function unarchiveClient(clientId: string, actor: AuthedUser) {
  return transitionClientStatus(clientId, actor, "CLIENT_UNARCHIVED", "active", {
    archivedAt: null,
    archiveReason: null,
  });
}

/**
 * Section 7.2 — the /clients table row shape. Composes per-client engine
 * calls in parallel (Section 9). `page`/`pageSize` push pagination down to
 * `findClientsFiltered` (Mongo skip/limit) so the per-client enrichment
 * fan-out only runs for the rows actually shown, not the whole filtered
 * roster (Section 15/M8 hardening pass).
 */
export async function getClientsListView(
  filter: ClientListFilter,
  page: number,
  pageSize: number
): Promise<ClientListRow[]> {
  const clients = await findClientsFiltered(filter, page, pageSize);

  const rows = await Promise.all(
    clients.map(async (client) => {
      const clientId = client._id.toString();
      const [summary, payments] = await Promise.all([
        getClientDuesSummary(clientId),
        findPaymentsByClient(clientId),
      ]);
      const lastPayment = payments.find((p) => p.status === "active") ?? null;
      const current = summary.currentDue;

      return {
        id: clientId,
        name: client.name,
        company: client.company ?? null,
        service: client.service,
        engagementType: client.engagementType,
        amountPaise: client.amountPaise,
        status: client.status,
        currentPeriodLabel: current ? current.periodLabel : null,
        currentStatus: current ? current.status : null,
        currentPaidPaise: current ? current.paidPaise : 0,
        currentBilledPaise: current ? current.billedPaise + current.carriedInPaise : 0,
        openDuesCount: summary.openDues.length,
        remainingDuePaise: summary.totalDuePaise,
        // Derived from the open dues, never from the stored Client.nextDueDate —
        // that field only moves on a manual edit and would otherwise keep
        // reporting a client as overdue long after they had paid in full.
        nextDueDate: summary.nextDueDate,
        daysOverdue: summary.daysOverdue,
        lastPaymentAt: lastPayment ? lastPayment.paidAt.toISOString() : null,
        lastPaymentPaise: lastPayment ? lastPayment.amountPaise : null,
      };
    })
  );

  return rows;
}

/**
 * Section 7.4 — one composed call for the client detail page (Section 9:
 * ONE call per page, internals parallelized). Returns null if the client
 * doesn't exist so the page can 404 instead of throwing.
 */
export async function getClientDetail(clientId: string) {
  const client = await findClientById(clientId);
  if (!client) return null;

  // ONE composed call for the whole page (Section 9), and one payments query
  // for every period rather than one per period — the Dues tab, the History
  // tab and the header all read from this same result, so they cannot
  // disagree with each other.
  const [summary, payments] = await Promise.all([
    getClientDuesSummary(clientId),
    findPaymentsByClient(clientId),
  ]);

  const trailByBillingId = new Map<string, typeof payments>();
  for (const payment of payments) {
    const key = payment.monthlyBillingId.toString();
    const existing = trailByBillingId.get(key);
    if (existing) existing.push(payment);
    else trailByBillingId.set(key, [payment]);
  }

  const duesWithTrails = summary.dues.map((due) => ({
    due,
    trail: trailByBillingId.get(due.id) ?? [],
  }));

  return { client, summary, duesWithTrails };
}
