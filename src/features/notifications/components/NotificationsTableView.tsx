"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTable } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { notificationsColumns } from "@/features/notifications/components/notifications-columns";
import { markAllNotificationsReadAction, markNotificationReadAction } from "@/features/notifications/actions";
import type { NotificationRow } from "@/types/notification";

// Matches NotificationBell's query key — invalidated here too so the
// topbar badge reflects a read/mark-all-read immediately instead of
// waiting for its own 60s poll to catch up.
const BELL_QUERY_KEY = ["notifications-bell"];

export function NotificationsTableView({
  rows,
  total,
  page,
  pageSize,
}: {
  rows: NotificationRow[];
  total: number;
  page: number;
  pageSize: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value && value !== "all") params.set(key, value);
    else params.delete(key);
    params.set("page", "1");
    router.push(`${pathname}?${params.toString()}`);
  }

  async function handleRowClick(row: NotificationRow) {
    if (!row.isRead) {
      await markNotificationReadAction(row.id);
      void queryClient.invalidateQueries({ queryKey: BELL_QUERY_KEY });
    }
    router.push(row.href);
  }

  async function handleMarkAllRead() {
    await markAllNotificationsReadAction();
    void queryClient.invalidateQueries({ queryKey: BELL_QUERY_KEY });
    router.refresh();
  }

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between">
        <Select value={searchParams.get("isRead") ?? "all"} onValueChange={(v) => setParam("isRead", v ?? "all")}>
          <SelectTrigger className="w-40">
            <SelectValue labels={{ all: "All", false: "Unread", true: "Read" }} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="false">Unread</SelectItem>
            <SelectItem value="true">Read</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={() => void handleMarkAllRead()}>
          Mark all read
        </Button>
      </div>

      <DataTable
        columns={notificationsColumns}
        data={rows}
        total={total}
        page={page}
        pageSize={pageSize}
        onRowClick={(row) => void handleRowClick(row)}
        emptyState={<EmptyState title="No notifications" />}
      />
    </div>
  );
}
