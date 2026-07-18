import type { NotificationSeverity, NotificationType } from "@/constants/domain";

// Section 5.9 — the /notifications list row and bell-feed item shape.
// Lives here (not in server/services/notifications.service.ts) so client
// components can import the type without importing the service module
// itself (Section 3 layering).
export type NotificationRow = {
  id: string;
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  body: string;
  href: string;
  isRead: boolean;
  createdAt: string;
};
