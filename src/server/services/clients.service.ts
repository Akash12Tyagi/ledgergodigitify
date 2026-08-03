import { AppError } from "@/lib/errors";
import { withDbTransaction } from "@/lib/db-transaction";
import { dayOfMonthIST, toMonthKey } from "@/lib/dates";
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
import {
  findBillingByClientAndMonth,
  findBillingsByClient,
  insertBilling,
} from "@/server/repositories/monthly-billings.repository";
import { findPaymentsByBilling, findPaymentsByClient } from "@/server/repositories/payments.repository";
import {
  getClientHistory,
  getClientLifetimePaid,
  getClientMonthStatus,
  getClientTotalDue,
} from "@/server/services/financial-engine";
import type { AuthedUser } from "@/server/auth/guards";
import type { ClientInput, UpdateClientInput } from "@/schemas/client.schema";
import type { ClientListRow } from "@/types/client";

// Section 6.6 — createClient. The duplicate-name check (step 1) is
// deliberately NOT performed here — it's a separate, non-blocking,
// pre-submit UI warning (checkClientName below), not a create-time
// validation. Client + first MonthlyBilling insert atomically (Law 4).
export async function createClient(input: ClientInput, actor: AuthedUser) {
  return withDbTransaction(async (session) => {
    const billingDay =
      input.engagementType === "retainer"
        ? (input.billingDay ?? dayOfMonthIST(input.nextDueDate))
        : null;

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

    const billing = await insertBilling(
      {
        clientId: client._id.toString(),
        monthKey: toMonthKey(input.nextDueDate),
        billedPaise: input.amountPaise,
        dueDate: input.nextDueDate,
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
  monthKey: string,
  page: number,
  pageSize: number
): Promise<ClientListRow[]> {
  const clients = await findClientsFiltered(filter, page, pageSize);

  const rows = await Promise.all(
    clients.map(async (client) => {
      const clientId = client._id.toString();
      const [monthStatus, totalDue, payments] = await Promise.all([
        getClientMonthStatus(clientId, monthKey),
        getClientTotalDue(clientId),
        findPaymentsByClient(clientId),
      ]);
      const lastPayment = payments.find((p) => p.status === "active") ?? null;

      return {
        id: clientId,
        name: client.name,
        company: client.company ?? null,
        service: client.service,
        engagementType: client.engagementType,
        amountPaise: client.amountPaise,
        status: client.status,
        thisMonthStatus: monthStatus.status,
        thisMonthPaidPaise: monthStatus.paidPaise,
        thisMonthBilledPaise: monthStatus.billedPaise + monthStatus.carriedInPaise,
        remainingDuePaise: totalDue,
        nextDueDate: client.nextDueDate.toISOString(),
        daysOverdue: monthStatus.daysOverdue,
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
export async function getClientDetail(clientId: string, monthKey: string) {
  const client = await findClientById(clientId);
  if (!client) return null;

  const [monthStatus, totalDue, lifetimePaid, history] = await Promise.all([
    getClientMonthStatus(clientId, monthKey),
    getClientTotalDue(clientId),
    getClientLifetimePaid(clientId),
    getClientHistory(clientId),
  ]);

  const currentBilling = await findBillingByClientAndMonth(clientId, monthKey);
  const trail = currentBilling
    ? await findPaymentsByBilling(currentBilling._id.toString())
    : [];

  return { client, monthStatus, totalDue, lifetimePaid, history, currentBilling, trail };
}

/** Section 7.4 "history" tab — one collapsible card per past month, each
 * with its own inner payment table. */
export async function getClientHistoryWithTrails(clientId: string) {
  const [history, billings] = await Promise.all([
    getClientHistory(clientId),
    findBillingsByClient(clientId),
  ]);
  const billingByMonth = new Map(billings.map((b) => [b.monthKey, b]));

  return Promise.all(
    history.map(async (monthStatus) => {
      const billing = billingByMonth.get(monthStatus.monthKey);
      const trail = billing ? await findPaymentsByBilling(billing._id.toString()) : [];
      return { monthStatus, trail };
    })
  );
}
