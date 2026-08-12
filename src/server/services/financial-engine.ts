import { AppError } from "@/lib/errors";
import {
  daysOverdue as computeDaysOverdue,
  monthKeyToRange,
  nowIST,
  shiftMonthKey,
  todayIST,
} from "@/lib/dates";
import {
  findAccountById,
  findAccountsByIds,
  findAllAccounts,
  findAllActiveAccounts,
} from "@/server/repositories/accounts.repository";
import { findClientById, findClientsByIds } from "@/server/repositories/clients.repository";
import {
  findBillingsByClient,
  findBillingsByMonth,
  findBillingsInMonthRange,
  findBillingsByStatus,
  sumBilledForMonth,
  OPEN_BILLING_STATUSES,
} from "@/server/repositories/monthly-billings.repository";
import { formatPeriodLabel } from "@/lib/billing-period";
import { sumExpensesByCategoryInRange } from "@/server/repositories/expenses.repository";
import { getSettingsOrDefaults } from "@/server/repositories/settings.repository";
import {
  findAccountActivityPage,
  findRecentTransactions,
  findRecentTransactionsInRange,
  findTransactionsPaginated,
  sumAdjustmentsNetForMonth,
  sumByTypeAndMonth,
  sumByTypeGroupedByMonth,
  sumInOutByAccountBeforeMonth,
  sumInOutByAccountForMonth,
  sumInOutForAccountAsOf,
  sumTransactionsMatchingFilter,
} from "@/server/repositories/transactions.repository";
import type { PayStatus } from "@/constants/domain";
import type {
  AccountReconcileResult,
  AccountStripItem,
  ActivityRow,
  ClientDue,
  ClientDuesSummary,
  DashboardData,
  DueRow,
  DuesList,
  ExpenseByCategoryRow,
  MonthKey,
  MonthOverview,
  Paginated,
  PerAccountRow,
  ReconcileReport,
  SparklinePoint,
  TxFilter,
  TxRow,
} from "@/types/engine";

// Section 4 — THE FINANCIAL ENGINE. Every number in the app is computed by
// exactly one of these functions (Law 1). Pure functions over
// repositories; nothing here imports React/next/navigation (enforced by
// eslint.config.mjs).

// ─────────────────────────────────────────────────────────────────────────
// 4.3 — Formulas. deriveBillingStatus is the truth table (4.4) as code;
// exported directly so it can be unit-tested against every row without
// needing a database.
// ─────────────────────────────────────────────────────────────────────────

export function deriveBillingStatus(input: {
  billedPaise: number;
  carriedInPaise: number;
  carriedOutPaise: number;
  paidPaise: number;
}): { status: PayStatus; remainingPaise: number } {
  const target = input.billedPaise + input.carriedInPaise - input.carriedOutPaise;
  const remainingPaise = Math.max(0, target - input.paidPaise);

  let status: PayStatus;
  if (input.paidPaise === 0) status = "PENDING";
  else if (input.paidPaise < target) status = "PARTIALLY_PAID";
  else if (input.paidPaise === target) status = "FULLY_PAID";
  else status = "OVERPAID";

  return { status, remainingPaise };
}

/** Section 14 edge case 2 — surplus available to apply as a rollover
 * discount when a billing is OVERPAID. 0 for every other status. */
export function computeOverpaymentSurplus(input: {
  billedPaise: number;
  carriedInPaise: number;
  carriedOutPaise: number;
  paidPaise: number;
}): number {
  const target = input.billedPaise + input.carriedInPaise - input.carriedOutPaise;
  return Math.max(0, input.paidPaise - target);
}

/** Shape of a lean MonthlyBilling row, loose enough to accept both current
 * documents and rows written before periods existed. */
type BillingLike = {
  _id: unknown;
  clientId: unknown;
  periodStart?: Date | null;
  periodEnd?: Date | null;
  monthKey: string;
  billedPaise: number;
  carriedInPaise: number;
  carriedOutPaise: number;
  paidPaise: number;
  status: PayStatus;
  dueDate: Date;
  generatedBy: string;
  note?: string | null;
  version?: number;
};

/**
 * Period bounds for a row, falling back to the calendar month for any row
 * written before periods existed (scripts/migrate-billing-periods.ts
 * backfills these properly; this keeps an un-migrated database readable
 * instead of crashing the client screens).
 */
function periodBoundsOf(billing: BillingLike): { periodStart: Date; periodEnd: Date } {
  if (billing.periodStart && billing.periodEnd) {
    return { periodStart: billing.periodStart, periodEnd: billing.periodEnd };
  }
  const { startUTC, endUTC } = monthKeyToRange(billing.monthKey);
  return { periodStart: billing.periodStart ?? startUTC, periodEnd: billing.periodEnd ?? endUTC };
}

function billingToClientDue(billing: BillingLike): ClientDue {
  const { status, remainingPaise } = deriveBillingStatus(billing);
  const { periodStart, periodEnd } = periodBoundsOf(billing);

  return {
    id: String(billing._id),
    clientId: String(billing.clientId),
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    periodLabel: formatPeriodLabel(periodStart, periodEnd),
    monthKey: billing.monthKey as MonthKey,
    billedPaise: billing.billedPaise,
    carriedInPaise: billing.carriedInPaise,
    paidPaise: billing.paidPaise,
    remainingPaise,
    status,
    dueDate: billing.dueDate.toISOString(),
    daysOverdue: remainingPaise > 0 ? computeDaysOverdue(billing.dueDate) : 0,
    generatedBy: billing.generatedBy as ClientDue["generatedBy"],
    note: billing.note ?? null,
    version: billing.version ?? 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Accounts
// ─────────────────────────────────────────────────────────────────────────

/** Section 4.3 — accountBalance(asOf) = opening + ΣIN(active,≤asOf) −
 * ΣOUT(active,≤asOf). `asOf` omitted means "as of now" (all transactions). */
export async function getAccountBalance(accountId: string, asOf?: Date): Promise<number> {
  const account = await findAccountById(accountId);
  if (!account) throw new AppError("NOT_FOUND", "Account not found");
  const { inPaise, outPaise } = await sumInOutForAccountAsOf(accountId, asOf);
  return account.openingBalancePaise + inPaise - outPaise;
}

function activityDocToRow(
  doc: Record<string, unknown>,
  accountNameById: Map<string, string>
): ActivityRow {
  const accountId = String(doc.accountId);
  return {
    id: String(doc._id),
    type: doc.type as TxRow["type"],
    direction: doc.direction as TxRow["direction"],
    amountPaise: doc.amountPaise as number,
    occurredAt: (doc.occurredAt as Date).toISOString(),
    monthKey: doc.monthKey as string,
    accountId,
    accountName: accountNameById.get(accountId) ?? "",
    clientId: doc.clientId ? String(doc.clientId) : null,
    counterpartyLabel: (doc.counterpartyLabel as string | null) ?? null,
    note: (doc.note as string | null) ?? null,
    invoiceNumber: (doc.invoiceNumber as string | null) ?? null,
    receiptNumber: (doc.receiptNumber as string | null) ?? null,
    status: doc.status as "active" | "reversed",
    transactionGroupId: doc.transactionGroupId ? String(doc.transactionGroupId) : null,
    runningBalancePaise: 0, // filled in by caller
  };
}

/** Section 7.8 — activity table with a server-computed running balance
 * (Section 14 edge case 33: never a full-collection fetch). */
export async function getAccountActivity(
  accountId: string,
  filter: TxFilter
): Promise<Paginated<ActivityRow>> {
  const account = await findAccountById(accountId);
  if (!account) throw new AppError("NOT_FOUND", "Account not found");

  const page = filter.page ?? 1;
  const pageSize = filter.pageSize ?? 20;
  const startUTC = filter.from;
  const endUTC = filter.to;

  const openingPaise = startUTC
    ? await getAccountBalance(accountId, new Date(startUTC.getTime() - 1))
    : account.openingBalancePaise;

  const { rows, total } = await findAccountActivityPage(accountId, {
    ...(startUTC ? { startUTC } : {}),
    ...(endUTC ? { endUTC } : {}),
    page,
    pageSize,
  });

  const activityRows = rows.map((doc) => {
    const row = activityDocToRow(doc, new Map([[accountId, account.name]]));
    row.runningBalancePaise = openingPaise + (doc.cumulativeDelta as number);
    return row;
  });

  return { rows: activityRows, page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
}

// ─────────────────────────────────────────────────────────────────────────
// Clients / billing
// ─────────────────────────────────────────────────────────────────────────

/**
 * Everything the client screens need about what one client owes — read once
 * from a single `findBillingsByClient` scan instead of four separate passes
 * that could disagree with each other.
 *
 * `currentDue` is the due the UI should act on by default: the period
 * containing today if one exists, otherwise the OLDEST still-open due (chase
 * the oldest debt first), otherwise the newest due so a fully-settled client
 * still shows something. It is deliberately not "this calendar month's due" —
 * on a 20th-to-20th cycle there frequently isn't one, and the old
 * month-keyed lookup returning null is exactly what used to hide the Record
 * Payment button entirely.
 */
export async function getClientDuesSummary(clientId: string): Promise<ClientDuesSummary> {
  const client = await findClientById(clientId);
  if (!client) throw new AppError("NOT_FOUND", "Client not found");

  const billings = await findBillingsByClient(clientId); // newest period first
  const dues = billings.map(billingToClientDue);
  const openDues = dues.filter((d) => d.remainingPaise > 0);

  const nowMs = nowIST().getTime();
  const containingToday = dues.find(
    (d) => new Date(d.periodStart).getTime() <= nowMs && nowMs < new Date(d.periodEnd).getTime()
  );
  // openDues inherits the newest-first order, so the last entry is the oldest.
  const oldestOpen = openDues.length > 0 ? openDues[openDues.length - 1] : undefined;
  const currentDue = containingToday ?? oldestOpen ?? dues[0] ?? null;

  const earliestOpen = oldestOpen
    ? openDues.reduce((earliest, d) =>
        new Date(d.dueDate).getTime() < new Date(earliest.dueDate).getTime() ? d : earliest
      )
    : null;

  return {
    dues,
    openDues,
    currentDue,
    totalDuePaise: openDues.reduce((sum, d) => sum + d.remainingPaise, 0),
    lifetimePaidPaise: dues.reduce((sum, d) => sum + d.paidPaise, 0),
    nextDueDate: earliestOpen ? earliestOpen.dueDate : null,
    daysOverdue: earliestOpen ? earliestOpen.daysOverdue : 0,
  };
}

/** Σ over every open due of max(0, billed+carriedIn−carriedOut−paid). */
export async function getClientTotalDue(clientId: string): Promise<number> {
  const billings = await findBillingsByClient(clientId);
  return billings.reduce((sum, b) => sum + deriveBillingStatus(b).remainingPaise, 0);
}

export async function getClientLifetimePaid(clientId: string): Promise<number> {
  const billings = await findBillingsByClient(clientId);
  return billings.reduce((sum, b) => sum + b.paidPaise, 0);
}

/** Every period, most recent first (the client "history" tab). */
export async function getClientDues(clientId: string): Promise<ClientDue[]> {
  const billings = await findBillingsByClient(clientId); // already sorted desc
  return billings.map(billingToClientDue);
}

// ─────────────────────────────────────────────────────────────────────────
// Dues / overdue (Section 4.3's overdue(asOf) is always relative to
// todayIST — never to a browsed/historical month).
// ─────────────────────────────────────────────────────────────────────────

async function scanOutstandingBillings() {
  return findBillingsByStatus(OPEN_BILLING_STATUSES);
}

/** Shared by getMonthOverview and getDuesList so both read the exact same
 * underlying scan (Law 1 — one source of truth for "what's owed"). */
async function computeOutstandingAndOverdue(): Promise<{
  outstandingPaise: number;
  overduePaise: number;
}> {
  const billings = await scanOutstandingBillings();
  const today = todayIST();
  const todayMs = new Date(`${today}T00:00:00.000Z`).getTime();

  let outstandingPaise = 0;
  let overduePaise = 0;
  for (const billing of billings) {
    const { remainingPaise } = deriveBillingStatus(billing);
    outstandingPaise += remainingPaise;
    if (billing.dueDate.getTime() < todayMs) overduePaise += remainingPaise;
  }
  return { outstandingPaise, overduePaise };
}

export async function getDuesList(asOfISTDate: string): Promise<DuesList> {
  const settings = await getSettingsOrDefaults();
  const billings = await scanOutstandingBillings();

  const asOfMs = new Date(`${asOfISTDate}T00:00:00.000Z`).getTime();

  // Group by client: one row per client, every open PERIOD listed separately.
  // Unpaid remainders are never merged into a later period, so a client owing
  // three cycles genuinely contributes three entries here — that list is the
  // answer to "which periods are open", and its sum is the client's total.
  const byClient = new Map<
    string,
    { periods: Array<{ label: string; startMs: number }>; remainingPaise: number; earliestDueDate: Date }
  >();
  for (const billing of billings) {
    const { remainingPaise } = deriveBillingStatus(billing);
    if (remainingPaise <= 0) continue;

    const { periodStart, periodEnd } = periodBoundsOf(billing);
    const entry = { label: formatPeriodLabel(periodStart, periodEnd), startMs: periodStart.getTime() };

    const clientId = billing.clientId.toString();
    const existing = byClient.get(clientId);
    if (!existing) {
      byClient.set(clientId, {
        periods: [entry],
        remainingPaise,
        earliestDueDate: billing.dueDate,
      });
    } else {
      existing.periods.push(entry);
      existing.remainingPaise += remainingPaise;
      if (billing.dueDate.getTime() < existing.earliestDueDate.getTime()) {
        existing.earliestDueDate = billing.dueDate;
      }
    }
  }

  const clients = await findClientsByIds([...byClient.keys()]);
  const clientById = new Map(clients.map((c) => [c._id.toString(), c]));

  const overdue: DueRow[] = [];
  const dueSoon: DueRow[] = [];
  const upcoming: DueRow[] = [];
  const archivedWithDues: DueRow[] = [];

  for (const [clientId, agg] of byClient) {
    const client = clientById.get(clientId);
    if (!client) continue;

    const dueMs = agg.earliestDueDate.getTime();
    const diffDays = Math.round((dueMs - asOfMs) / (24 * 60 * 60 * 1000));

    const row: DueRow = {
      clientId,
      clientName: client.name,
      periodsOwed: agg.periods.sort((a, b) => a.startMs - b.startMs).map((p) => p.label),
      remainingPaise: agg.remainingPaise,
      dueDate: agg.earliestDueDate.toISOString(),
      daysOverdue: Math.max(0, -diffDays),
      clientStatus: client.status as DueRow["clientStatus"],
    };

    if (client.status === "archived") {
      archivedWithDues.push(row);
    } else if (diffDays < 0) {
      overdue.push(row);
    } else if (diffDays <= settings.dueSoonDays) {
      dueSoon.push(row);
    } else {
      upcoming.push(row);
    }
  }

  const sumRows = (rows: DueRow[]) => rows.reduce((sum, r) => sum + r.remainingPaise, 0);

  return {
    overdue,
    dueSoon,
    upcoming,
    archivedWithDues,
    overdueTotalPaise: sumRows(overdue),
    dueSoonTotalPaise: sumRows(dueSoon),
    upcomingTotalPaise: sumRows(upcoming),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Month overview (Section 7.5's "money mathematics" ledger equation)
// ─────────────────────────────────────────────────────────────────────────

export async function getMonthOverview(monthKey: string): Promise<MonthOverview> {
  const { startUTC, endUTC } = monthKeyToRange(monthKey);
  const accounts = await findAllAccounts();
  const accountIds = accounts.map((a) => a._id.toString());

  const [
    inOutThisMonth,
    inOutBeforeMonth,
    billedPaise,
    collectedPaise,
    creditsPaise,
    expensesPaise,
    lentPaise,
    loanRepaidPaise,
    adjustmentsNetPaise,
    categoryRows,
    outstanding,
  ] = await Promise.all([
    // Section 14 edge case 3 — perAccount in/out MUST use the same
    // monthKey dimension as collected/credits/expenses below, not an
    // occurredAt date range. A payment settling last month's billing has
    // monthKey = that billing's month even when recorded later; filtering
    // positions by date range while filtering flows by monthKey would
    // make the closing==opening+net assert fail on entirely correct data.
    sumInOutByAccountForMonth(accountIds, monthKey),
    sumInOutByAccountBeforeMonth(accountIds, monthKey),
    sumBilledForMonth(monthKey),
    sumByTypeAndMonth(monthKey, ["PAYMENT_IN"]),
    sumByTypeAndMonth(monthKey, ["CREDIT_IN"]),
    sumByTypeAndMonth(monthKey, ["EXPENSE_OUT"]),
    sumByTypeAndMonth(monthKey, ["LOAN_OUT"]),
    sumByTypeAndMonth(monthKey, ["LOAN_REPAY_IN"]),
    sumAdjustmentsNetForMonth(monthKey),
    sumExpensesByCategoryInRange(startUTC, endUTC),
    computeOutstandingAndOverdue(),
  ]);

  const perAccount: PerAccountRow[] = [];
  let openingPositionPaise = 0;
  let closingPositionPaise = 0;

  for (const account of accounts) {
    const id = account._id.toString();
    const before = inOutBeforeMonth.get(id) ?? { inPaise: 0, outPaise: 0 };
    const openingPaise = account.openingBalancePaise + before.inPaise - before.outPaise;
    const { inPaise, outPaise } = inOutThisMonth.get(id) ?? { inPaise: 0, outPaise: 0 };
    const closingPaise = openingPaise + inPaise - outPaise;

    perAccount.push({ accountId: id, name: account.name, openingPaise, inPaise, outPaise, closingPaise });
    openingPositionPaise += openingPaise;
    closingPositionPaise += closingPaise;
  }

  // Every balance-affecting type that does NOT net to zero across accounts
  // has to appear here, or closing !== opening + net and the whole period
  // blanks out behind the reconciliation banner. Transfers and reversals are
  // absent because they self-cancel; loans are present because they don't.
  const netCashFlowPaise =
    collectedPaise +
    creditsPaise +
    loanRepaidPaise -
    expensesPaise -
    lentPaise +
    adjustmentsNetPaise;
  const expectedClosing = openingPositionPaise + netCashFlowPaise;
  const reconciliationError = closingPositionPaise !== expectedClosing;

  const expenseByCategory: ExpenseByCategoryRow[] = categoryRows.map((r) => ({
    category: r._id,
    totalPaise: r.totalPaise,
    count: r.count,
  }));

  if (reconciliationError) {
    return {
      monthKey: monthKey as MonthKey,
      openingPositionPaise: 0,
      billedPaise: 0,
      collectedPaise: 0,
      creditsPaise: 0,
      expensesPaise: 0,
      lentPaise: 0,
      loanRepaidPaise: 0,
      adjustmentsNetPaise: 0,
      netCashFlowPaise: 0,
      closingPositionPaise: 0,
      outstandingDuesPaise: 0,
      overduePaise: 0,
      perAccount: [],
      expenseByCategory: [],
      reconciliationError: true,
    };
  }

  return {
    monthKey: monthKey as MonthKey,
    openingPositionPaise,
    billedPaise,
    collectedPaise,
    creditsPaise,
    expensesPaise,
    lentPaise,
    loanRepaidPaise,
    adjustmentsNetPaise,
    netCashFlowPaise,
    closingPositionPaise,
    outstandingDuesPaise: outstanding.outstandingPaise,
    overduePaise: outstanding.overduePaise,
    perAccount,
    expenseByCategory,
  };
}

export type BilledClientRow = {
  clientId: string;
  clientName: string;
  billedPaise: number;
  carriedInPaise: number;
  status: PayStatus;
  dueDate: string;
};

/** Section 15/M8 — the Ledger Overview's "Billed" drill-down
 * (/ledger/billed). Every row's `billedPaise` sums to exactly
 * `getMonthOverview(monthKey).billedPaise` (both read the same
 * MonthlyBilling rows for the month) — carriedInPaise is shown for
 * context but deliberately excluded from that sum, matching
 * sumBilledForMonth's own field selection. */
export async function getBilledClientsForMonth(monthKey: string): Promise<BilledClientRow[]> {
  return billedRowsFrom(await findBillingsByMonth(monthKey));
}

/** Range sibling of getBilledClientsForMonth, for the From–To picker. Its
 * rows sum to exactly getRangeOverview(from, to).billedPaise, because both
 * read the same MonthlyBilling rows over the same month span. */
export async function getBilledClientsForRange(
  fromMonthKey: string,
  toMonthKey: string
): Promise<BilledClientRow[]> {
  return billedRowsFrom(await findBillingsInMonthRange(fromMonthKey, toMonthKey));
}

async function billedRowsFrom(
  billings: Awaited<ReturnType<typeof findBillingsByMonth>>
): Promise<BilledClientRow[]> {
  const clients = await findClientsByIds(billings.map((b) => b.clientId.toString()));
  const nameById = new Map(clients.map((c) => [c._id.toString(), c.name]));

  return billings
    .map((b) => ({
      clientId: b.clientId.toString(),
      clientName: nameById.get(b.clientId.toString()) ?? "Unknown client",
      billedPaise: b.billedPaise,
      carriedInPaise: b.carriedInPaise,
      status: b.status,
      dueDate: b.dueDate.toISOString(),
    }))
    .sort((a, b) => b.billedPaise - a.billedPaise);
}

/** "summed" per Section 4.2: flow figures (billed/collected/credits/
 * expenses/net) sum across the range; position figures (opening/closing)
 * use the range's first/last month; overdue/outstanding are today-relative
 * snapshots, identical regardless of range. */
export async function getRangeOverview(
  fromMonthKey: string,
  toMonthKey: string
): Promise<MonthOverview> {
  const monthKeys = enumerateMonthKeys(fromMonthKey, toMonthKey);
  const overviews = await Promise.all(monthKeys.map((mk) => getMonthOverview(mk)));

  if (overviews.some((o) => o.reconciliationError)) {
    return {
      monthKey: toMonthKey as MonthKey,
      openingPositionPaise: 0,
      billedPaise: 0,
      collectedPaise: 0,
      creditsPaise: 0,
      expensesPaise: 0,
      lentPaise: 0,
      loanRepaidPaise: 0,
      adjustmentsNetPaise: 0,
      netCashFlowPaise: 0,
      closingPositionPaise: 0,
      outstandingDuesPaise: 0,
      overduePaise: 0,
      perAccount: [],
      expenseByCategory: [],
      reconciliationError: true,
    };
  }

  const first = overviews[0];
  const last = overviews[overviews.length - 1];
  if (!first || !last) throw new AppError("VALIDATION", "Invalid month range");

  const categoryTotals = new Map<string, { totalPaise: number; count: number }>();
  for (const overview of overviews) {
    for (const row of overview.expenseByCategory) {
      const existing = categoryTotals.get(row.category) ?? { totalPaise: 0, count: 0 };
      existing.totalPaise += row.totalPaise;
      existing.count += row.count;
      categoryTotals.set(row.category, existing);
    }
  }

  const perAccountTotals = new Map<string, PerAccountRow>();
  for (const row of first.perAccount) {
    perAccountTotals.set(row.accountId, { ...row, inPaise: 0, outPaise: 0 });
  }
  for (const overview of overviews) {
    for (const row of overview.perAccount) {
      const existing = perAccountTotals.get(row.accountId);
      if (existing) {
        existing.inPaise += row.inPaise;
        existing.outPaise += row.outPaise;
      }
    }
  }
  for (const row of last.perAccount) {
    const existing = perAccountTotals.get(row.accountId);
    if (existing) existing.closingPaise = row.closingPaise;
  }

  return {
    monthKey: toMonthKey as MonthKey,
    openingPositionPaise: first.openingPositionPaise,
    billedPaise: overviews.reduce((s, o) => s + o.billedPaise, 0),
    collectedPaise: overviews.reduce((s, o) => s + o.collectedPaise, 0),
    creditsPaise: overviews.reduce((s, o) => s + o.creditsPaise, 0),
    expensesPaise: overviews.reduce((s, o) => s + o.expensesPaise, 0),
    lentPaise: overviews.reduce((s, o) => s + o.lentPaise, 0),
    loanRepaidPaise: overviews.reduce((s, o) => s + o.loanRepaidPaise, 0),
    adjustmentsNetPaise: overviews.reduce((s, o) => s + o.adjustmentsNetPaise, 0),
    netCashFlowPaise: overviews.reduce((s, o) => s + o.netCashFlowPaise, 0),
    closingPositionPaise: last.closingPositionPaise,
    outstandingDuesPaise: last.outstandingDuesPaise,
    overduePaise: last.overduePaise,
    perAccount: [...perAccountTotals.values()],
    expenseByCategory: [...categoryTotals.entries()].map(([category, v]) => ({ category, ...v })),
  };
}

function enumerateMonthKeys(fromMonthKey: string, toMonthKey: string): string[] {
  const keys: string[] = [];
  let cursor = fromMonthKey;
  while (cursor <= toMonthKey) {
    keys.push(cursor);
    cursor = shiftMonthKey(cursor, 1);
  }
  return keys;
}

// ─────────────────────────────────────────────────────────────────────────
// Transactions (Section 4.6 sibling-list rule)
// ─────────────────────────────────────────────────────────────────────────

export async function listTransactions(filter: TxFilter): Promise<Paginated<TxRow>> {
  const { rows, total, page, pageSize } = await findTransactionsPaginated(filter);
  const accountIds = [...new Set(rows.map((r) => String(r.accountId)))];
  const accounts = await findAccountsByIds(accountIds);
  const nameById = new Map(accounts.map((a) => [a._id.toString(), a.name]));

  const txRows: TxRow[] = rows.map((doc) => {
    const row = activityDocToRow(doc, nameById);
    return row;
  });

  return { rows: txRows, page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
}

/** Section 4.6 — the TRUE sum across every row matching `filter`, not just
 * the current page. Used by the dev-mode sibling-list assertion
 * (components/shared/DevSumAssertion.tsx) so pagination can never hide a
 * card/list mismatch. */
export async function sumFilteredTransactions(filter: TxFilter): Promise<number> {
  return sumTransactionsMatchingFilter(filter);
}

// ─────────────────────────────────────────────────────────────────────────
// Reconciliation (Section 4.5 — pure derive-vs-materialized comparison;
// the side-effecting lock+notify version is reconciliation.service.ts, M6)
// ─────────────────────────────────────────────────────────────────────────

export async function reconcileAccount(accountId: string): Promise<AccountReconcileResult> {
  const account = await findAccountById(accountId);
  if (!account) throw new AppError("NOT_FOUND", "Account not found");

  const derivedPaise = await getAccountBalance(accountId);
  const materializedPaise = account.currentBalancePaise;

  return {
    accountId,
    name: account.name,
    derivedPaise,
    materializedPaise,
    driftPaise: derivedPaise - materializedPaise,
  };
}

export async function reconcileAll(): Promise<ReconcileReport> {
  const accounts = await findAllAccounts();
  const results = await Promise.all(accounts.map((a) => reconcileAccount(a._id.toString())));
  return {
    ranAt: new Date().toISOString(),
    accounts: results,
    hasDrift: results.some((r) => r.driftPaise !== 0),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Dashboard (Section 7.1 — ONE composed call per page, internals
// parallelized with Promise.all, Section 9)
// ─────────────────────────────────────────────────────────────────────────

function previousMonthKeys(monthKey: string, count: number): string[] {
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    keys.push(shiftMonthKey(monthKey, -i));
  }
  return keys;
}

export async function getDashboardData(monthKey: string): Promise<DashboardData> {
  const sparklineMonths = previousMonthKeys(monthKey, 6);

  const [overview, dues, accounts, recentTx, collectedSeries, expenseSeries] = await Promise.all([
    getMonthOverview(monthKey),
    getDuesList(todayIST()),
    findAllActiveAccounts(),
    findRecentTransactions(monthKey, 8),
    sumByTypeGroupedByMonth(sparklineMonths, ["PAYMENT_IN"]),
    sumByTypeGroupedByMonth(sparklineMonths, ["EXPENSE_OUT"]),
  ]);

  const settings = await getSettingsOrDefaults();

  const accountsWithNames = new Map(accounts.map((a) => [a._id.toString(), a.name]));
  const recentActivity: TxRow[] = recentTx.map((doc) =>
    activityDocToRow(doc as unknown as Record<string, unknown>, accountsWithNames)
  );

  const accountStrip: AccountStripItem[] = accounts.map((a) => {
    const threshold = a.lowBalanceThresholdPaise ?? settings.lowBalanceDefaultPaise;
    return {
      accountId: a._id.toString(),
      name: a.name,
      balancePaise: a.currentBalancePaise,
      lowBalanceThresholdPaise: threshold,
      isLowBalance: a.currentBalancePaise < threshold,
    };
  });

  const sparkline: SparklinePoint[] = sparklineMonths.map((mk) => ({
    monthKey: mk as MonthKey,
    collectedPaise: collectedSeries.get(mk) ?? 0,
    expensesPaise: expenseSeries.get(mk) ?? 0,
  }));

  // "Dues this week" (Section 7.1 row 3): the most urgent outstanding
  // rows — overdue first, then due-soon — capped at 6.
  const duesThisWeek = [...dues.overdue, ...dues.dueSoon]
    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())
    .slice(0, 6);

  return {
    monthKey: monthKey as MonthKey,
    overview,
    dues,
    accounts: accountStrip,
    duesThisWeek,
    recentActivity,
    sparkline,
  };
}

/** From–To range sibling of getDashboardData, for the Dashboard's range
 * picker. `overview` sums flows across the whole range (getRangeOverview);
 * dues/accounts stay today-relative snapshots exactly as in the
 * single-month case (Section 4.2 — overdue/outstanding/live balances are
 * never a function of the browsed period). The sparkline still trails 6
 * months back from `toMonthKey` regardless of `fromMonthKey`, matching the
 * single-month behavior of "last 6 months ending here". When from === to
 * this returns the exact same figures as getDashboardData(to). */
export async function getDashboardRangeData(fromMonthKey: string, toMonthKey: string): Promise<DashboardData> {
  const sparklineMonths = previousMonthKeys(toMonthKey, 6);

  const [overview, dues, accounts, recentTx, collectedSeries, expenseSeries] = await Promise.all([
    getRangeOverview(fromMonthKey, toMonthKey),
    getDuesList(todayIST()),
    findAllActiveAccounts(),
    findRecentTransactionsInRange(fromMonthKey, toMonthKey, 8),
    sumByTypeGroupedByMonth(sparklineMonths, ["PAYMENT_IN"]),
    sumByTypeGroupedByMonth(sparklineMonths, ["EXPENSE_OUT"]),
  ]);

  const settings = await getSettingsOrDefaults();

  const accountsWithNames = new Map(accounts.map((a) => [a._id.toString(), a.name]));
  const recentActivity: TxRow[] = recentTx.map((doc) =>
    activityDocToRow(doc as unknown as Record<string, unknown>, accountsWithNames)
  );

  const accountStrip: AccountStripItem[] = accounts.map((a) => {
    const threshold = a.lowBalanceThresholdPaise ?? settings.lowBalanceDefaultPaise;
    return {
      accountId: a._id.toString(),
      name: a.name,
      balancePaise: a.currentBalancePaise,
      lowBalanceThresholdPaise: threshold,
      isLowBalance: a.currentBalancePaise < threshold,
    };
  });

  const sparkline: SparklinePoint[] = sparklineMonths.map((mk) => ({
    monthKey: mk as MonthKey,
    collectedPaise: collectedSeries.get(mk) ?? 0,
    expensesPaise: expenseSeries.get(mk) ?? 0,
  }));

  const duesThisWeek = [...dues.overdue, ...dues.dueSoon]
    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())
    .slice(0, 6);

  return {
    monthKey: toMonthKey as MonthKey,
    overview,
    dues,
    accounts: accountStrip,
    duesThisWeek,
    recentActivity,
    sparkline,
  };
}
