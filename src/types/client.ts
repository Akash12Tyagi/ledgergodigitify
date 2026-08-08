import type { ClientEngagementType, PayStatus } from "@/constants/domain";

// Section 7.2 — the /clients table row shape. Lives here (not in
// server/services/clients.service.ts) so client components can import the
// type without importing the service module itself (Section 3 layering —
// components never import server/services).
export type ClientListRow = {
  id: string;
  name: string;
  company: string | null;
  service: string;
  engagementType: ClientEngagementType;
  amountPaise: number;
  status: "active" | "paused" | "archived";
  /**
   * The client's current billing period — the one containing today, else
   * their oldest still-open due. NULL means the client genuinely has no dues
   * raised yet, which the table must show differently from "has a due, unpaid":
   * the old shape collapsed both into a PENDING badge reading ₹0/₹0, so a
   * client whose first due sat in a future month looked identical to one who
   * owed nothing.
   */
  currentPeriodLabel: string | null;
  currentStatus: PayStatus | null;
  currentPaidPaise: number;
  currentBilledPaise: number;
  /** How many periods are still open — 2+ means the client has fallen behind
   * by more than one cycle, since remainders never merge forward. */
  openDuesCount: number;
  remainingDuePaise: number;
  /**
   * Earliest open due date, DERIVED from the dues themselves rather than read
   * from the stored `Client.nextDueDate` (which only ever changes on a manual
   * edit and so drifts permanently out of step with the ledger). Null when
   * nothing is outstanding.
   */
  nextDueDate: string | null;
  daysOverdue: number;
  lastPaymentAt: string | null;
  lastPaymentPaise: number | null;
};
