"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { AlertTriangle, Info, ShieldAlert } from "lucide-react";

import { cn } from "@/lib/utils";
import type { NotificationRow } from "@/types/notification";

const SEVERITY_ICON: Record<NotificationRow["severity"], typeof Info> = {
  info: Info,
  warning: AlertTriangle,
  critical: ShieldAlert,
};

const SEVERITY_CLASSES: Record<NotificationRow["severity"], string> = {
  info: "text-muted-foreground",
  warning: "text-warn",
  critical: "text-money-out",
};

// Section 5.9/7.6 — the /notifications table columns.
export const notificationsColumns: ColumnDef<NotificationRow, unknown>[] = [
  {
    id: "severity",
    header: "",
    cell: ({ row }) => {
      const Icon = SEVERITY_ICON[row.original.severity];
      // Decorative — the notification's title/body already convey its
      // content; the icon is a redundant visual accent, not information
      // on its own (Section 12: never color/icon alone).
      return <Icon aria-hidden="true" className={cn("size-4", SEVERITY_CLASSES[row.original.severity])} />;
    },
  },
  {
    id: "content",
    header: "Notification",
    cell: ({ row }) => (
      <div className={cn(!row.original.isRead && "font-medium")}>
        <p>{row.original.title}</p>
        <p className="text-xs text-muted-foreground">{row.original.body}</p>
      </div>
    ),
  },
  {
    id: "createdAt",
    header: "When",
    cell: ({ row }) =>
      new Date(row.original.createdAt).toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }),
  },
  {
    id: "isRead",
    header: "",
    // Section 12 — never color alone: the dot is paired with sr-only text
    // so a screen reader announces "Unread" instead of nothing.
    cell: ({ row }) =>
      !row.original.isRead ? (
        <span className="inline-flex items-center gap-1">
          <span aria-hidden="true" className="size-2 rounded-full bg-primary" />
          <span className="sr-only">Unread</span>
        </span>
      ) : null,
  },
];
