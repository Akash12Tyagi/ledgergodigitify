import type { PayStatus, TransactionType } from "@/constants/domain";

// Section 4.1 — Financial Engine types. Every number in the app is
// produced by financial-engine.ts using these shapes (Law 1).
export type MonthKey = `${number}-${string}`; // "2026-07"
export type { PayStatus };

export interface Money {
  paise: number;
}

export interface ClientMonthStatus {
  clientId: string;
  monthKey: MonthKey;
  billedPaise: number;
  carriedInPaise: number;
  paidPaise: number;
  remainingPaise: number;
  status: PayStatus;
  dueDate: string; // ISO date
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
  monthKey?: string;
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
  monthsOwed: MonthKey[];
  remainingPaise: number;
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
