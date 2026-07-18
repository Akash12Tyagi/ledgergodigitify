import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AccountDetailHeader } from "@/features/accounts/components/AccountDetailHeader";
import { AccountActivityTableView } from "@/features/accounts/components/AccountActivityTableView";
import { getAccount } from "@/server/services/accounts.service";
import { getAccountActivity } from "@/server/services/financial-engine";
import { requireUser } from "@/server/auth/guards";
import { PAGE_SIZE_DEFAULT } from "@/constants/finance";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  try {
    const account = await getAccount(id);
    return { title: `${account.name} — Finance & Ledger` };
  } catch {
    return { title: "Account — Finance & Ledger" };
  }
}

// Section 7.8 — /ledger/accounts/[id]. One composed call per page
// (Section 9): the account doc plus its server-paginated activity table
// with a running balance (financial-engine.ts#getAccountActivity).
export default async function AccountDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string; pageSize?: string }>;
}) {
  const { id } = await params;
  const { page, pageSize } = await searchParams;

  const actor = await requireUser("viewer");

  let account;
  try {
    account = await getAccount(id);
  } catch {
    notFound();
  }

  const activity = await getAccountActivity(id, {
    page: Math.max(1, Number(page ?? "1")),
    pageSize: Math.max(1, Number(pageSize ?? String(PAGE_SIZE_DEFAULT))),
  });

  return (
    <div>
      <AccountDetailHeader
        account={{
          id: account._id.toString(),
          name: account.name,
          type: account.type,
          currentBalancePaise: account.currentBalancePaise,
          isDefault: account.isDefault,
          status: account.status,
          bankName: account.bankName ?? null,
          last4: account.last4 ?? null,
          openingBalancePaise: account.openingBalancePaise,
          lowBalanceThresholdPaise: account.lowBalanceThresholdPaise ?? null,
          version: account.version,
        }}
        role={actor.role}
      />

      <AccountActivityTableView
        rows={activity.rows}
        total={activity.total}
        page={activity.page}
        pageSize={activity.pageSize}
        role={actor.role}
      />
    </div>
  );
}
