import type { ExpenseStatus, ExpenseTemplateStatus } from "@/constants/domain";

// Section 7.6 — the /ledger/expenses table row shape. Lives here (not in
// server/services/expenses.service.ts) so client components can import
// the type without importing the service module itself (Section 3
// layering — components never import server/services).
export type ExpenseRow = {
  id: string;
  amountPaise: number;
  reason: string;
  paidToEntity: string;
  category: string;
  accountId: string;
  accountName: string;
  spentAt: string;
  note: string | null;
  status: ExpenseStatus;
  reversedReason: string | null;
  overrideNegativeBalance: boolean;
  /** Non-null only on rows raised by a recurring template — the UI uses it
   * to show the period a pending row covers and to link back. */
  templateId: string | null;
  periodLabel: string | null;
  /** Required by the edit form's optimistic lock; meaningless once posted. */
  version: number;
};

// Section 7.6b — the /ledger/recurring table row shape.
export type ExpenseTemplateRow = {
  id: string;
  amountPaise: number;
  reason: string;
  paidToEntity: string;
  category: string;
  accountId: string;
  accountName: string;
  startDate: string;
  billingDay: number;
  status: ExpenseTemplateStatus;
  pausedReason: string | null;
  note: string | null;
  version: number;
};
