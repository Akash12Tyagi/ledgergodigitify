import type { BillingGeneratedBy, PayStatus, TransactionType } from "@/constants/domain";

// Section 4.1 — Financial Engine types. Every number in the app is
// produced by financial-engine.ts using these shapes (Law 1).
export type MonthKey = `${number}-${string}`; // "2026-07"
export type { PayStatus };

export interface Money {
  paise: number;
}

/**
 * One billing period's worth of money owed by a client — a "due".
 *
 * Keyed on the PERIOD (periodStart/periodEnd), not on a calendar month, so
 * 20th-to-20th and 7th-to-7th cycles are first-class rather than forced into
 * a "YYYY-MM" bucket. `monthKey` remains only as the reporting bucket the
 * month-scoped Ledger views total this due into.
 *
 * `id` is the MonthlyBilling id — carried on the row so the UI can record a
 * payment against THIS specific due, which is what makes clearing an older
 * period possible at all.
 */
export interface ClientDue {
  id: string;
  clientId: string;
  periodStart: string; // ISO date
  periodEnd: string; // ISO date, exclusive
  periodLabel: string; // "20 Aug – 19 Sep 2026"
  monthKey: MonthKey;
  billedPaise: number;
  /** Legacy carry-forward from rows written before dues stopped carrying;
   * always 0 on anything created since. Kept so historical rows still
   * total correctly. */
  carriedInPaise: number;
  paidPaise: number;
  remainingPaise: number;
  status: PayStatus;
  dueDate: string; // ISO date
  daysOverdue: number;
  generatedBy: BillingGeneratedBy;
  note: string | null;
  version: number;
}

/** Everything the client screens need about what a client owes, computed
 * once instead of re-derived per widget. */
export interface ClientDuesSummary {
  dues: ClientDue[];
  openDues: ClientDue[];
  /** The due to act on by default: the period containing today if there is
   * one, else the oldest still-open due, else the newest due. Null only when
   * the client has no dues at all. */
  currentDue: ClientDue | null;
  totalDuePaise: number;
  lifetimePaidPaise: number;
  /** Earliest unpaid due date across open dues — the client's real "next
   * due", derived rather than stored, so it can never go stale. */
  nextDueDate: string | null;
  daysOverdue: number;
}

export interface PerAccountRow {
  accountId: string;
  name: string;
  openingPaise: number;
  inPaise: number;
  outPaise: number;
  closingPaise: number;
}

export interface ExpenseByCategoryRow {
  category: string;
  totalPaise: number;
  count: number;
}

export interface MonthOverview {
  monthKey: MonthKey;
  openingPositionPaise: number;
  billedPaise: number;
  collectedPaise: number;
  creditsPaise: number;
  expensesPaise: number;
  /** Net of manual account adjustments (IN minus OUT). Adjustments move a
   * real account balance, so they MUST appear in the ledger equation —
   * otherwise closing !== opening + net and the whole month would blank out
   * behind the reconciliation banner. */
  adjustmentsNetPaise: number;
  netCashFlowPaise: number;
  closingPositionPaise: number;
  outstandingDuesPaise: number;
  overduePaise: number;
  perAccount: PerAccountRow[];
  expenseByCategory: ExpenseByCategoryRow[];
  /** Section 4.3 — set when closing !== opening + net; the UI must show the
   * red reconciliation banner and hide the figures rather than display a
   * number that might be wrong. */
  reconciliationError?: boolean;
}

export interface Paginated<T> {
  rows: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export type TxStatusFilter = "active" | "reversed" | "all";

export interface TxFilter {
  accountId?: string;
  clientId?: string;
  type?: TransactionType[];
  /** Exactly one reporting month. */
  monthKey?: string;
  /**
   * An inclusive span of reporting months ("2026-06" … "2026-08"), for the
   * app-wide From–To period picker. Takes precedence over `monthKey`.
   * "YYYY-MM" compares correctly as a plain string, so this needs no date
   * parsing and uses the same stored field the single-month path does —
   * which is what keeps a range total equal to the sum of its months.
   */
  monthKeyFrom?: string;
  monthKeyTo?: string;
  from?: Date;
  to?: Date;
  status?: TxStatusFilter;
  page?: number;
  pageSize?: number;
}

export interface TxRow {
  id: string;
  type: TransactionType;
  direction: "IN" | "OUT";
  amountPaise: number;
  occurredAt: string;
  monthKey: string;
  accountId: string;
  accountName: string;
  clientId: string | null;
  counterpartyLabel: string | null;
  note: string | null;
  invoiceNumber: string | null;
  receiptNumber: string | null;
  status: "active" | "reversed";
  /** Set only on TRANSFER/REVERSAL rows — the id reverseTransferAction
   * needs, since a transfer has no standalone document of its own. */
  transactionGroupId: string | null;
}

export interface ActivityRow extends TxRow {
  runningBalancePaise: number;
}

export interface DueRow {
  clientId: string;
  clientName: string;
  /** Human labels of every open period this client owes for, oldest first —
   * e.g. ["20 Jul – 19 Aug 2026", "20 Aug – 19 Sep 2026"]. Each period stays
   * its own line item; unpaid remainders are never merged into the next
   * period, so this list is the literal answer to "which periods are open". */
  periodsOwed: string[];
  remainingPaise: number;
  /** Earliest open due date across `periodsOwed` — what the row is bucketed
   * and sorted by. */
  dueDate: string;
  daysOverdue: number;
  clientStatus: "active" | "paused" | "archived";
}

export interface DuesList {
  overdue: DueRow[];
  dueSoon: DueRow[];
  upcoming: DueRow[];
  archivedWithDues: DueRow[];
  overdueTotalPaise: number;
  dueSoonTotalPaise: number;
  upcomingTotalPaise: number;
}

export interface AccountStripItem {
  accountId: string;
  name: string;
  balancePaise: number;
  lowBalanceThresholdPaise: number;
  isLowBalance: boolean;
}

export interface SparklinePoint {
  monthKey: MonthKey;
  collectedPaise: number;
  expensesPaise: number;
}

export interface DashboardData {
  monthKey: MonthKey;
  overview: MonthOverview;
  dues: DuesList;
  accounts: AccountStripItem[];
  duesThisWeek: DueRow[];
  recentActivity: TxRow[];
  sparkline: SparklinePoint[];
}

export interface AccountReconcileResult {
  accountId: string;
  name: string;
  derivedPaise: number;
  materializedPaise: number;
  driftPaise: number;
}

export interface ReconcileReport {
  ranAt: string;
  accounts: AccountReconcileResult[];
  hasDrift: boolean;
}
