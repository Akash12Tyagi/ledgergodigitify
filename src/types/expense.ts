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
  status: "active" | "reversed";
  reversedReason: string | null;
  overrideNegativeBalance: boolean;
};
