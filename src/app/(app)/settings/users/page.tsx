import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/PageHeader";
import { UsersTableView } from "@/features/settings/components/UsersTableView";
import { listUsers } from "@/server/services/settings.service";
import { requireUser } from "@/server/auth/guards";

export const metadata: Metadata = { title: "Users — Finance & Ledger" };
export const dynamic = "force-dynamic";

// Section 6.10/7.14 — /settings/users. Owner-only.
export default async function SettingsUsersPage() {
  const actor = await requireUser("owner");
  const users = await listUsers();

  return (
    <div>
      <PageHeader title="Users" />
      <UsersTableView users={users} currentUserId={actor.id} />
    </div>
  );
}
