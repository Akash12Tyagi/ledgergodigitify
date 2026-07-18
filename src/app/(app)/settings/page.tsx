import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/PageHeader";
import { SettingsForm } from "@/features/settings/components/SettingsForm";
import { ReconciliationPanel } from "@/features/settings/components/ReconciliationPanel";
import { ExportButtons } from "@/features/settings/components/ExportButtons";
import { getSettings } from "@/server/services/settings.service";
import { listLockedAccounts } from "@/server/services/accounts.service";
import { requireUser } from "@/server/auth/guards";

export const metadata: Metadata = { title: "Settings — Finance & Ledger" };
export const dynamic = "force-dynamic";

// Section 7.14 — /settings. Owner-only (Section 1.2's most restrictive row).
export default async function SettingsPage() {
  await requireUser("owner");

  const [settings, lockedAccounts] = await Promise.all([getSettings(), listLockedAccounts()]);

  return (
    <div className="grid gap-6">
      <PageHeader title="Settings" />
      <SettingsForm
        initial={{
          companyName: settings.companyName,
          largeExpenseAlertPaise: settings.largeExpenseAlertPaise,
          lowBalanceDefaultPaise: settings.lowBalanceDefaultPaise,
          dueSoonDays: settings.dueSoonDays,
          financialYearStartMonth: settings.financialYearStartMonth,
          goLiveDate: settings.goLiveDate ? settings.goLiveDate.toISOString() : null,
        }}
      />
      <ReconciliationPanel accounts={lockedAccounts} />
      <ExportButtons />
    </div>
  );
}
