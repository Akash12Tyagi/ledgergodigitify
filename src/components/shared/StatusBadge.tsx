import { cn } from "@/lib/utils";
import type { PayStatus } from "@/constants/domain";

// Section 12 — PENDING slate · PARTIALLY_PAID amber · FULLY_PAID green ·
// OVERPAID blue · OVERDUE red. Badge always contains TEXT + color (never
// color alone) for accessibility.
export type DisplayStatus =
  | PayStatus
  | "OVERDUE"
  | "ACTIVE"
  | "PAUSED"
  | "ARCHIVED"
  // Expense lifecycle (Section 6.3.3). REVERSED and CANCELLED are kept
  // distinct from ARCHIVED because they answer different questions: money
  // moved and was undone, versus money never moved at all.
  | "REVERSED"
  | "CANCELLED"
  // Borrowings. Deliberately NOT reusing PENDING: in this app that word
  // already means "waiting for someone to approve it", and a loan that is
  // simply not yet repaid is not waiting on anybody.
  | "OPEN";

const LABELS: Record<DisplayStatus, string> = {
  PENDING: "Pending",
  PARTIALLY_PAID: "Partially Paid",
  FULLY_PAID: "Fully Paid",
  OVERPAID: "Overpaid",
  OVERDUE: "Overdue",
  ACTIVE: "Active",
  PAUSED: "Paused",
  ARCHIVED: "Archived",
  REVERSED: "Reversed",
  CANCELLED: "Cancelled",
  OPEN: "Open",
};

const CLASSES: Record<DisplayStatus, string> = {
  PENDING: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  PARTIALLY_PAID: "bg-warn/10 text-warn",
  FULLY_PAID: "bg-money-in/10 text-money-in",
  OVERPAID: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  OVERDUE: "bg-money-out/10 text-money-out",
  ACTIVE: "bg-money-in/10 text-money-in",
  PAUSED: "bg-warn/10 text-warn",
  ARCHIVED: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  REVERSED: "bg-money-out/10 text-money-out",
  CANCELLED: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  OPEN: "bg-warn/10 text-warn",
};

export function StatusBadge({
  status,
  suffix,
  className,
}: {
  status: DisplayStatus;
  /** e.g. "· ₹8,000/₹20,000" appended after the label (Section 7.2). */
  suffix?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 w-fit shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        CLASSES[status],
        className
      )}
    >
      {LABELS[status]}
      {suffix ? <span className="font-normal opacity-80">{suffix}</span> : null}
    </span>
  );
}
