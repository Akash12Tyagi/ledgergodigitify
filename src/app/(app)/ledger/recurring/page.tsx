import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/shared/PageHeader";
import { ExpenseTemplatesTableView } from "@/features/expense-templates/components/ExpenseTemplatesTableView";
import { listExpenseTemplates } from "@/server/services/expense-templates.service";
import { getPendingExpenseCount } from "@/server/services/expenses.service";
import { requireUser } from "@/server/auth/guards";
import { PAGE_SIZE_DEFAULT } from "@/constants/finance";
import type { ExpenseCategory, ExpenseTemplateStatus } from "@/constants/domain";

export const metadata: Metadata = { title: "Recurring Expenses — Finance & Ledger" };
export const dynamic = "force-dynamic";

/**
 * Section 7.6b — /ledger/recurring.
 *
 * No period picker here, deliberately: a template has no period: it IS the
 * thing that produces periods. Filtering standing instructions by a month
 * range would only ever hide them.
 */
export default async function RecurringExpensesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const actor = await requireUser("viewer");

  const page = Math.max(1, Number(params.page ?? "1"));
  const pageSize = Math.max(1, Number(params.pageSize ?? String(PAGE_SIZE_DEFAULT)));
  const category = (params.category as ExpenseCategory | "all" | undefined) ?? "all";
  const status = (params.status as ExpenseTemplateStatus | "all" | undefined) ?? "all";

  const [result, pendingCount] = await Promise.all([
    listExpenseTemplates({ category, status, page, pageSize }),
    getPendingExpenseCount(),
  ]);

  return (
    <div>
      <PageHeader
        title="Recurring Expenses"
        description="Standing instructions. Each period these raise a pending expense for approval — no money moves on its own."
      />

      {pendingCount > 0 ? (
        <Link
          href="/ledger/expenses?status=pending"
          className="mb-4 flex w-full items-center gap-2 rounded-md border border-warn/30 bg-warn/5 px-3 py-2 text-sm hover:bg-warn/10"
        >
          <span className="font-medium text-warn">
            {pendingCount} expense{pendingCount === 1 ? "" : "s"} awaiting approval
          </span>
          <span className="text-muted-foreground">— review and approve</span>
        </Link>
      ) : null}

      <ExpenseTemplatesTableView
        rows={result.rows}
        total={result.total}
        page={result.page}
        pageSize={result.pageSize}
        role={actor.role}
      />
    </div>
  );
}
