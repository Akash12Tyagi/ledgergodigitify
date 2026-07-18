import type { ClientEngagementType } from "@/constants/domain";

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
  thisMonthStatus: string;
  thisMonthPaidPaise: number;
  thisMonthBilledPaise: number;
  remainingDuePaise: number;
  nextDueDate: string;
  daysOverdue: number;
  lastPaymentAt: string | null;
  lastPaymentPaise: number | null;
};
