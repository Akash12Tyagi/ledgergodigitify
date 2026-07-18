// Section 7.9 — the /ledger/credits table row shape. Lives here for the
// same reason as types/expense.ts#ExpenseRow.
export type CreditRow = {
  id: string;
  amountPaise: number;
  source: string;
  reason: string;
  category: string;
  accountId: string;
  accountName: string;
  receivedAt: string;
  note: string | null;
  status: "active" | "reversed";
  reversedReason: string | null;
};
