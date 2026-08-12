"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTable } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { transactionsColumns } from "@/components/shared/transactions-columns";
import type { TransactionType } from "@/constants/domain";
import type { TxRow } from "@/types/engine";

// Every TransactionType is listed here. Dues are deliberately absent —
// they are not transactions: a due is money OWED, with no account and no
// movement, so it belongs to /ledger/dues and /ledger/billed, not to a
// table whose rows must sum to the account balances above it.
const TYPE_OPTIONS: { value: TransactionType | "all"; label: string }[] = [
  { value: "all", label: "All types" },
  { value: "PAYMENT_IN", label: "Payments" },
  { value: "CREDIT_IN", label: "Credits" },
  { value: "EXPENSE_OUT", label: "Expenses" },
  { value: "TRANSFER", label: "Transfers" },
  { value: "LOAN_OUT", label: "Lent out" },
  { value: "LOAN_REPAY_IN", label: "Loan repayments" },
  { value: "REVERSAL", label: "Reversals" },
  { value: "ADJUSTMENT", label: "Adjustments" },
];

const TYPE_LABELS: Record<string, string> = Object.fromEntries(
  TYPE_OPTIONS.map((o) => [o.value, o.label])
);

/** Section 7.5 — /ledger/overview's transaction sibling-list, filterable
 * by type via the URL (matching each DrilldownCard's href) with
 * server-side pagination (Section 14 edge case 33). */
export function TransactionsTableView({
  rows,
  total,
  page,
  pageSize,
}: {
  rows: TxRow[];
  total: number;
  page: number;
  pageSize: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function setType(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value && value !== "all") params.set("type", value);
    else params.delete("type");
    params.set("page", "1");
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Transactions</h2>
        <Select value={searchParams.get("type") ?? "all"} onValueChange={(v) => setType(v ?? "all")}>
          <SelectTrigger className="w-40">
            <SelectValue labels={TYPE_LABELS} />
          </SelectTrigger>
          <SelectContent>
            {TYPE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <DataTable
        columns={transactionsColumns}
        data={rows}
        total={total}
        page={page}
        pageSize={pageSize}
        emptyState={<EmptyState title="No transactions for this filter" />}
      />
    </div>
  );
}
