import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/PageHeader";
import { AccountsPageView } from "@/features/accounts/components/AccountsPageView";
import { listAllAccounts } from "@/server/services/accounts.service";
import { requireUser } from "@/server/auth/guards";

export const metadata: Metadata = { title: "Accounts — Finance & Ledger" };
export const dynamic = "force-dynamic";

// Section 7.7 — /ledger/accounts.
export default async function AccountsPage() {
  const actor = await requireUser("viewer");
  const accounts = await listAllAccounts();

  return (
    <div>
      <PageHeader
        title="Accounts"
        description="Where your money physically sits. Use “Move money” to record cash deposited into the bank, or anything else that shifts between accounts."
      />
      <AccountsPageView
        accounts={accounts.map((a) => ({
          id: a._id.toString(),
          name: a.name,
          type: a.type,
          currentBalancePaise: a.currentBalancePaise,
          isDefault: a.isDefault,
          status: a.status,
          bankName: a.bankName ?? null,
          last4: a.last4 ?? null,
          openingBalancePaise: a.openingBalancePaise,
          lowBalanceThresholdPaise: a.lowBalanceThresholdPaise ?? null,
          version: a.version,
        }))}
        role={actor.role}
      />
    </div>
  );
}
