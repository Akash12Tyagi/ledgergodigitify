import { toCsv } from "@/lib/csv";
import { paiseToRupeesPlain } from "@/lib/money";
import { getClientsListView } from "@/server/services/clients.service";
import { listExpenses } from "@/server/services/expenses.service";
import { listCredits } from "@/server/services/credits.service";
import { listTransactions } from "@/server/services/financial-engine";
import type { ClientListFilter } from "@/server/repositories/clients.repository";
import type { ExpenseListFilter } from "@/server/repositories/expenses.repository";
import type { CreditListFilter } from "@/server/repositories/credits.repository";
import type { TxFilter } from "@/types/engine";

// Section 7.13 — every export function calls the EXACT SAME list function
// its corresponding screen uses, with an effectively-unbounded page size,
// so "export rows === screen rows for an identical filter" holds by
// construction (Section 15's WYSIWYG export test) rather than by two
// parallel implementations staying in sync by convention.
const EXPORT_ALL_PAGE_SIZE = 1_000_000;

export async function exportClientsCsv(filter: ClientListFilter): Promise<string> {
  const rows = await getClientsListView(filter, 1, EXPORT_ALL_PAGE_SIZE);
  return toCsv(rows, [
    { header: "Name", value: (r) => r.name },
    { header: "Company", value: (r) => r.company ?? "" },
    { header: "Service", value: (r) => r.service },
    { header: "Engagement Type", value: (r) => r.engagementType },
    { header: "Amount (INR)", value: (r) => paiseToRupeesPlain(r.amountPaise) },
    { header: "Status", value: (r) => r.status },
    { header: "Current Period", value: (r) => r.currentPeriodLabel ?? "" },
    { header: "Current Period Status", value: (r) => r.currentStatus ?? "NO_DUES" },
    { header: "Current Period Paid (INR)", value: (r) => paiseToRupeesPlain(r.currentPaidPaise) },
    { header: "Current Period Billed (INR)", value: (r) => paiseToRupeesPlain(r.currentBilledPaise) },
    { header: "Open Dues", value: (r) => r.openDuesCount },
    { header: "Remaining Due (INR)", value: (r) => paiseToRupeesPlain(r.remainingDuePaise) },
    { header: "Next Due Date", value: (r) => r.nextDueDate ?? "" },
    { header: "Days Overdue", value: (r) => r.daysOverdue },
    { header: "Last Payment At", value: (r) => r.lastPaymentAt ?? "" },
    {
      header: "Last Payment (INR)",
      value: (r) => (r.lastPaymentPaise !== null ? paiseToRupeesPlain(r.lastPaymentPaise) : ""),
    },
  ]);
}

export async function exportExpensesCsv(filter: Omit<ExpenseListFilter, "page" | "pageSize">): Promise<string> {
  const { rows } = await listExpenses({ ...filter, page: 1, pageSize: EXPORT_ALL_PAGE_SIZE });
  return toCsv(rows, [
    { header: "Date", value: (r) => r.spentAt },
    { header: "Paid To", value: (r) => r.paidToEntity },
    { header: "Reason", value: (r) => r.reason },
    { header: "Category", value: (r) => r.category },
    { header: "Account", value: (r) => r.accountName },
    { header: "Amount (INR)", value: (r) => paiseToRupeesPlain(r.amountPaise) },
    { header: "Status", value: (r) => r.status },
    { header: "Note", value: (r) => r.note ?? "" },
  ]);
}

export async function exportCreditsCsv(filter: Omit<CreditListFilter, "page" | "pageSize">): Promise<string> {
  const { rows } = await listCredits({ ...filter, page: 1, pageSize: EXPORT_ALL_PAGE_SIZE });
  return toCsv(rows, [
    { header: "Date", value: (r) => r.receivedAt },
    { header: "Source", value: (r) => r.source },
    { header: "Reason", value: (r) => r.reason },
    { header: "Category", value: (r) => r.category },
    { header: "Account", value: (r) => r.accountName },
    { header: "Amount (INR)", value: (r) => paiseToRupeesPlain(r.amountPaise) },
    { header: "Status", value: (r) => r.status },
    { header: "Note", value: (r) => r.note ?? "" },
  ]);
}

export async function exportTransactionsCsv(filter: Omit<TxFilter, "page" | "pageSize">): Promise<string> {
  const { rows } = await listTransactions({ ...filter, page: 1, pageSize: EXPORT_ALL_PAGE_SIZE });
  return toCsv(rows, [
    { header: "Date", value: (r) => r.occurredAt },
    { header: "Type", value: (r) => r.type },
    { header: "Direction", value: (r) => r.direction },
    { header: "Account", value: (r) => r.accountName },
    { header: "Counterparty", value: (r) => r.counterpartyLabel ?? "" },
    { header: "Amount (INR)", value: (r) => paiseToRupeesPlain(r.amountPaise) },
    { header: "Status", value: (r) => r.status },
    { header: "Invoice Number", value: (r) => r.invoiceNumber ?? "" },
    { header: "Receipt Number", value: (r) => r.receiptNumber ?? "" },
  ]);
}
