import type { ClientSession } from "mongoose";

import {
  countUnreadNotifications,
  createNotificationIfNotExists,
  findNotificationByDedupeKey,
  findNotificationsPaginated,
  markAllNotificationsRead,
  markNotificationRead,
  markUnreadNotificationsReadByEntity,
  type InsertNotificationInput,
  type NotificationListFilter,
} from "@/server/repositories/notifications.repository";
import { findBillingsByStatus } from "@/server/repositories/monthly-billings.repository";
import { findClientsByIds } from "@/server/repositories/clients.repository";
import { getSettingsOrDefaults } from "@/server/repositories/settings.repository";
import { deriveBillingStatus, getMonthOverview } from "@/server/services/financial-engine";
import { formatMonthLabel, nowIST, shiftMonthKey, toMonthKey, todayIST } from "@/lib/dates";
import { formatINR } from "@/lib/money";
import type { NotificationEntityKind, NotificationType } from "@/constants/domain";
import type { UserRole } from "@/constants/roles";
import type { NotificationRow } from "@/types/notification";

export type { NotificationListFilter, NotificationRow };

/**
 * Minimal notification-creation capability, needed starting M3 because
 * Section 6.1/6.2 fire PAYMENT_RECEIVED/DUE_OVERDUE notifications inside
 * their own DB transactions. M6 adds the cron-driven jobs below plus the
 * read-side functions the /notifications page and topbar bell need.
 */
export async function notify(input: InsertNotificationInput, session?: ClientSession) {
  return createNotificationIfNotExists(input, session);
}

export async function markEntityNotificationsRead(
  entityKind: NotificationEntityKind,
  entityId: string,
  type: NotificationType,
  session?: ClientSession
) {
  await markUnreadNotificationsReadByEntity(entityKind, entityId, type, session);
}

/** Section 5.9 — "owner"-audience notifications are invisible to everyone
 * else, not just visually hidden; every read function below takes the
 * viewer's role and scopes the query accordingly. */
function visibleToOwnerOnly(role: UserRole): boolean {
  return role === "owner";
}

export async function listNotifications(role: UserRole, filter: Omit<NotificationListFilter, "visibleToOwnerOnly">) {
  const { rows, total, page, pageSize } = await findNotificationsPaginated({
    ...filter,
    visibleToOwnerOnly: visibleToOwnerOnly(role),
  });
  return {
    rows: rows.map((n) => ({
      id: n._id.toString(),
      type: n.type,
      severity: n.severity,
      title: n.title,
      body: n.body,
      href: n.href,
      isRead: n.isRead,
      createdAt: n.createdAt.toISOString(),
    })),
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

export async function getUnreadCount(role: UserRole): Promise<number> {
  return countUnreadNotifications(visibleToOwnerOnly(role));
}

/** Section 1.3 — the topbar bell's poll payload. The bell is a direct link
 * to /notifications (not a preview dropdown), so this only needs the
 * unread count — no separate "recent" list to fetch. */
export async function getBellFeed(role: UserRole): Promise<{ unreadCount: number }> {
  return { unreadCount: await getUnreadCount(role) };
}

export async function markRead(id: string) {
  await markNotificationRead(id);
}

export async function markAllRead(role: UserRole) {
  await markAllNotificationsRead(visibleToOwnerOnly(role));
}

// ─────────────────────────────────────────────────────────────────────────
// Section 6.8B — daily due-reminder scan. Each billing gets AT MOST one
// DUE_UPCOMING and one DUE_OVERDUE notification ever (dedupeKey keyed on
// the billing id alone, no date component), matching PAYMENT_RECEIVED's
// "fire once per real-world event" pattern rather than re-alerting daily.
// ─────────────────────────────────────────────────────────────────────────

export type DueReminderResult = { upcomingCreated: number; overdueCreated: number };

export async function runDueReminders(): Promise<DueReminderResult> {
  const settings = await getSettingsOrDefaults();
  const billings = await findBillingsByStatus(["PENDING", "PARTIALLY_PAID"]);
  if (billings.length === 0) return { upcomingCreated: 0, overdueCreated: 0 };

  const clientIds = [...new Set(billings.map((b) => b.clientId.toString()))];
  const clients = await findClientsByIds(clientIds);
  const clientById = new Map(clients.map((c) => [c._id.toString(), c]));

  const todayMs = new Date(`${todayIST()}T00:00:00.000Z`).getTime();
  let upcomingCreated = 0;
  let overdueCreated = 0;

  for (const billing of billings) {
    const { remainingPaise } = deriveBillingStatus(billing);
    if (remainingPaise <= 0) continue;

    const client = clientById.get(billing.clientId.toString());
    // Archived/paused clients still show up in Dues, but don't get
    // reminder spam for a bill nobody is actively expected to chase.
    if (!client || client.status !== "active") continue;

    const diffDays = Math.round((billing.dueDate.getTime() - todayMs) / (24 * 60 * 60 * 1000));

    if (diffDays < 0) {
      const created = await notify({
        type: "DUE_OVERDUE",
        severity: "warning",
        title: "Payment overdue",
        body: `${client.name}'s ${billing.monthKey} billing (${formatINR(remainingPaise)}) is overdue.`,
        entityRef: { kind: "client", id: client._id.toString() },
        href: `/clients/${client._id.toString()}?tab=dues`,
        audience: "all",
        dedupeKey: `OVERDUE:${billing._id.toString()}`,
      });
      if (created) overdueCreated += 1;
    } else if (diffDays <= settings.dueSoonDays) {
      const created = await notify({
        type: "DUE_UPCOMING",
        severity: "info",
        title: "Payment due soon",
        body: `${client.name}'s ${billing.monthKey} billing (${formatINR(remainingPaise)}) is due ${
          diffDays === 0 ? "today" : `in ${diffDays} day${diffDays === 1 ? "" : "s"}`
        }.`,
        entityRef: { kind: "client", id: client._id.toString() },
        href: `/clients/${client._id.toString()}?tab=current`,
        audience: "all",
        dedupeKey: `UPCOMING:${billing._id.toString()}`,
      });
      if (created) upcomingCreated += 1;
    }
  }

  return { upcomingCreated, overdueCreated };
}

// ─────────────────────────────────────────────────────────────────────────
// Section 6.8C — month summary. Fires once per completed month (dedupeKey
// keyed on the PREVIOUS monthKey), safe to run daily since it's a no-op
// after the first successful post-month-end run.
// ─────────────────────────────────────────────────────────────────────────

export async function runMonthSummary(): Promise<{ created: boolean }> {
  const previousMonthKey = shiftMonthKey(toMonthKey(nowIST()), -1);
  const dedupeKey = `MONTH_SUMMARY:${previousMonthKey}`;

  const existing = await findNotificationByDedupeKey(dedupeKey);
  if (existing) return { created: false };

  const overview = await getMonthOverview(previousMonthKey);
  // A reconciliation error means the figures can't be trusted yet — skip
  // for now; the cron retries daily and will succeed once resolved.
  if (overview.reconciliationError) return { created: false };

  const result = await notify({
    type: "MONTH_SUMMARY",
    severity: "info",
    title: `${formatMonthLabel(previousMonthKey)} summary`,
    body: `Collected ${formatINR(overview.collectedPaise)}, expenses ${formatINR(overview.expensesPaise)}, net ${formatINR(overview.netCashFlowPaise)}.`,
    entityRef: { kind: "system", id: null },
    href: "/ledger/overview",
    audience: "owner",
    dedupeKey,
  });

  return { created: result !== null };
}
