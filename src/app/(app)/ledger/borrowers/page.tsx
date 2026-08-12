import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/PageHeader";
import { KpiCard } from "@/components/shared/KpiCard";
import { AmountText } from "@/components/shared/AmountText";
import { BorrowingsTableView } from "@/features/borrowings/components/BorrowingsTableView";
import { getOutstandingBorrowedTotal, listBorrowings } from "@/server/services/borrowings.service";
import { requireUser } from "@/server/auth/guards";
import { PAGE_SIZE_DEFAULT } from "@/constants/finance";
import type { BorrowingStatus } from "@/constants/domain";

export const metadata: Metadata = { title: "Borrowers — Finance & Ledger" };
export const dynamic = "force-dynamic";

/**
 * Section 7.10 — /ledger/borrowers.
 *
 * No period picker, deliberately. A loan is outstanding until it is repaid,
 * regardless of which month it was handed over in; scoping this list to a
 * period would hide exactly the old debts most worth chasing.
 */
export default async function BorrowersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const actor = await requireUser("viewer");

  const page = Math.max(1, Number(params.page ?? "1"));
  const pageSize = Math.max(1, Number(params.pageSize ?? String(PAGE_SIZE_DEFAULT)));
  const status = (params.status as BorrowingStatus | "all" | undefined) ?? "open";
  const search = params.search ?? "";

  const [result, outstandingPaise] = await Promise.all([
    listBorrowings({ status, search, page, pageSize }),
    getOutstandingBorrowedTotal(),
  ]);

  return (
    <div>
      <PageHeader
        title="Borrowers"
        description="Money you lent out and are still waiting on. This is not an expense — it stays counted as owed to you until it comes back."
      />

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard
          label="Still out with people"
          value={<AmountText paise={outstandingPaise} tone={outstandingPaise > 0 ? "out" : "neutral"} />}
          tone={outstandingPaise > 0 ? "warn" : "neutral"}
        />
      </div>

      <BorrowingsTableView
        rows={result.rows}
        total={result.total}
        page={result.page}
        pageSize={result.pageSize}
        role={actor.role}
      />
    </div>
  );
}
