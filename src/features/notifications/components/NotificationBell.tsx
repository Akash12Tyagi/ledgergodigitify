"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Bell } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { NOTIFICATION_POLL_MS } from "@/constants/finance";

type BellFeed = { unreadCount: number };

async function fetchBellFeed(): Promise<BellFeed> {
  const res = await fetch("/api/notifications/poll");
  const json = (await res.json()) as { success: boolean; data?: BellFeed };
  if (!json.success || !json.data) return { unreadCount: 0 };
  return json.data;
}

/**
 * Section 1.3/7 — the topbar bell. A direct link to /notifications (the
 * "notification dashboard"), not a dropdown-trigger — a click here must
 * always navigate there in one step. The unread badge is still kept fresh
 * by the one client-side polling fetch in the app (TanStack Query, 60s);
 * everything else reads via a direct in-process RSC service call
 * (Section 9).
 */
export function NotificationBell() {
  const { data } = useQuery({
    queryKey: ["notifications-bell"],
    queryFn: fetchBellFeed,
    refetchInterval: NOTIFICATION_POLL_MS,
  });

  const unreadCount = data?.unreadCount ?? 0;

  return (
    <Button
      variant="ghost"
      size="icon"
      className="relative"
      render={<Link href="/notifications" aria-label="Notifications" />}
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
    </Button>
  );
}
