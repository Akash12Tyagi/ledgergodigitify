"use client";

import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NOTIFICATION_POLL_MS } from "@/constants/finance";
import { markNotificationReadAction } from "@/features/notifications/actions";
import type { NotificationRow } from "@/types/notification";

type BellFeed = { unreadCount: number; recent: NotificationRow[] };

const BELL_QUERY_KEY = ["notifications-bell"];

async function fetchBellFeed(): Promise<BellFeed> {
  const res = await fetch("/api/notifications/poll");
  const json = (await res.json()) as { success: boolean; data?: BellFeed };
  if (!json.success || !json.data) return { unreadCount: 0, recent: [] };
  return json.data;
}

/**
 * Section 1.3/7 — the topbar bell. The one client-side polling fetch in
 * the app (TanStack Query, 60s) — everything else reads via a direct
 * in-process RSC service call (Section 9).
 */
export function NotificationBell() {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: BELL_QUERY_KEY,
    queryFn: fetchBellFeed,
    refetchInterval: NOTIFICATION_POLL_MS,
  });

  const unreadCount = data?.unreadCount ?? 0;
  const recent = data?.recent ?? [];

  // Reading a notification here (vs. the /notifications table) previously
  // never called markNotificationReadAction at all — the item was a bare
  // Link, so the badge count never reflected it being read until the next
  // 60s poll happened to run after some OTHER read path updated it.
  function handleItemClick(notification: NotificationRow) {
    if (notification.isRead) return;
    void markNotificationReadAction(notification.id).then(() => {
      void queryClient.invalidateQueries({ queryKey: BELL_QUERY_KEY });
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon" aria-label="Notifications" className="relative" />}
      >
        <Bell className="size-4" />
        {unreadCount > 0 ? (
          <Badge
            variant="destructive"
            className="absolute -right-1 -top-1 h-4 min-w-4 justify-center rounded-full px-1 text-[10px]"
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </Badge>
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>Notifications</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {recent.length === 0 ? (
          <p className="px-2 py-4 text-center text-sm text-muted-foreground">You&apos;re all caught up</p>
        ) : (
          recent.map((n) => (
            <DropdownMenuItem
              key={n.id}
              render={<Link href={n.href} />}
              onClick={() => handleItemClick(n)}
              className={n.isRead ? undefined : "font-medium"}
            >
              <div className="grid gap-0.5">
                <span className="text-sm">{n.title}</span>
                <span className="text-xs text-muted-foreground">{n.body}</span>
              </div>
            </DropdownMenuItem>
          ))
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href="/notifications" />}>View all</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
