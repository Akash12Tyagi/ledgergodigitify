import type { BorrowingStatus, PaymentMethod } from "@/constants/domain";

// Section 7.10 — the /ledger/borrowers table row shape. Lives here (not in
// the service) so client components can import the type without pulling a
// server module into the bundle (Section 3 layering).
export type BorrowingRow = {
  id: string;
  borrowerName: string;
  borrowerPhone: string | null;
  principalPaise: number;
  repaidPaise: number;
  /** principal − repaid. Precomputed so the table never does money maths. */
  outstandingPaise: number;
  lentAt: string;
  expectedBackBy: string | null;
  accountId: string;
  accountName: string;
  reason: string | null;
  note: string | null;
  status: BorrowingStatus;
  writtenOffReason: string | null;
  repaymentCount: number;
};

export type RepaymentRow = {
  id: string;
  amountPaise: number;
  receivedAt: string;
  accountId: string;
  accountName: string;
  method: PaymentMethod;
  note: string | null;
  status: "active" | "reversed";
};
