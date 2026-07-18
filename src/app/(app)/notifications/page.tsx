import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/PageHeader";
import { NotificationsTableView } from "@/features/notifications/components/NotificationsTableView";
import { listNotifications } from "@/server/services/notifications.service";
import { requireUser } from "@/server/auth/guards";
import { PAGE_SIZE_DEFAULT } from "@/constants/finance";

export const metadata: Metadata = { title: "Notifications — Finance & Ledger" };
export const dynamic = "force-dynamic";

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const actor = await requireUser("viewer");

  const page = Math.max(1, Number(params.page ?? "1"));
  const pageSize = Math.max(1, Number(params.pageSize ?? String(PAGE_SIZE_DEFAULT)));
  const isRead = params.isRead === "true" ? true : params.isRead === "false" ? false : undefined;

  const result = await listNotifications(actor.role, { ...(isRead !== undefined ? { isRead } : {}), page, pageSize });

  return (
    <div>
      <PageHeader title="Notifications" />
      <NotificationsTableView rows={result.rows} total={result.total} page={result.page} pageSize={result.pageSize} />
    </div>
  );
}
