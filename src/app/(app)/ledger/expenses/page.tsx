import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/PageHeader";
import { ExpensesTableView } from "@/features/expenses/components/ExpensesTableView";
import { listExpenses } from "@/server/services/expenses.service";
import { requireUser } from "@/server/auth/guards";
import { PAGE_SIZE_DEFAULT } from "@/constants/finance";
import type { ExpenseCategory } from "@/constants/domain";

export const metadata: Metadata = { title: "Expenses — Finance & Ledger" };
export const dynamic = "force-dynamic";

// Section 7.6 — /ledger/expenses.
export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const actor = await requireUser("viewer");

  const page = Math.max(1, Number(params.page ?? "1"));
  const pageSize = Math.max(1, Number(params.pageSize ?? String(PAGE_SIZE_DEFAULT)));
  const category = (params.category as ExpenseCategory | "all" | undefined) ?? "all";
  const status = (params.status as "active" | "reversed" | "all" | undefined) ?? "active";

  const result = await listExpenses({ category, status, page, pageSize });

  return (
    <div>
      <PageHeader title="Expenses" />
      <ExpensesTableView
        rows={result.rows}
        total={result.total}
        page={result.page}
        pageSize={result.pageSize}
        role={actor.role}
      />
    </div>
  );
}
