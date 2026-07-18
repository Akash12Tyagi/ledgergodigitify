import type { ClientSession } from "mongoose";
import { Types } from "mongoose";

import { db } from "@/database/connection";
import { NotificationModel } from "@/database/models/notification.model";
import type {
  NotificationAudience,
  NotificationEntityKind,
  NotificationSeverity,
  NotificationType,
} from "@/constants/domain";

export type InsertNotificationInput = {
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  body: string;
  entityRef: { kind: NotificationEntityKind; id: string | null };
  href: string;
  audience: NotificationAudience;
  dedupeKey: string;
};

/**
 * Section 6.8/14 edge case 41 — dedupeKey uniqueness makes cron
 * (re-)creation idempotent. A collision here is not an error: the
 * notification for this exact event already exists, so it's a silent
 * no-op, matching "unique index makes re-runs no-ops."
 */
export async function createNotificationIfNotExists(
  input: InsertNotificationInput,
  session?: ClientSession
) {
  await db();
  try {
    const [doc] = await NotificationModel.create(
      [
        {
          type: input.type,
          severity: input.severity,
          title: input.title,
          body: input.body,
          entityRef: { kind: input.entityRef.kind, id: input.entityRef.id ? new Types.ObjectId(input.entityRef.id) : null },
          href: input.href,
          audience: input.audience,
          dedupeKey: input.dedupeKey,
        },
      ],
      session ? { session } : undefined
    );
    return doc ?? null;
  } catch (error) {
    if (isDuplicateDedupeKey(error)) return null;
    throw error;
  }
}

function isDuplicateDedupeKey(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const err = error as { code?: unknown; keyPattern?: unknown; message?: unknown };
  return err.code === 11000 && JSON.stringify(err.keyPattern ?? err.message ?? "").includes("dedupeKey");
}

/** Section 6.1 step 9 / 6.2 step 5 — clears/recreates DUE_OVERDUE
 * notifications tied to a billing as its paid state changes. */
export async function markUnreadNotificationsReadByEntity(
  entityKind: NotificationEntityKind,
  entityId: string,
  type: NotificationType,
  session?: ClientSession
) {
  await db();
  await NotificationModel.updateMany(
    {
      "entityRef.kind": entityKind,
      "entityRef.id": new Types.ObjectId(entityId),
      type,
      isRead: false,
    },
    { $set: { isRead: true } },
    session ? { session } : undefined
  );
}

export async function findNotificationByDedupeKey(dedupeKey: string) {
  await db();
  return NotificationModel.findOne({ dedupeKey }).lean();
}

export type NotificationListFilter = {
  /** Section 5.9 — "owner"-audience notifications are excluded entirely
   * for non-owner roles, not just visually hidden. */
  visibleToOwnerOnly: boolean;
  type?: NotificationType;
  isRead?: boolean;
  page?: number;
  pageSize?: number;
};

export async function findNotificationsPaginated(filter: NotificationListFilter) {
  await db();
  const page = filter.page ?? 1;
  const pageSize = filter.pageSize ?? 20;
  const match: Record<string, unknown> = {};
  if (!filter.visibleToOwnerOnly) match.audience = "all";
  if (filter.type) match.type = filter.type;
  if (filter.isRead !== undefined) match.isRead = filter.isRead;

  const [rows, total] = await Promise.all([
    NotificationModel.find(match)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean(),
    NotificationModel.countDocuments(match),
  ]);

  return { rows, total, page, pageSize };
}

/** Section 7.6/1.3 — the bell's unread count, audience-scoped the same
 * way as the list. */
export async function countUnreadNotifications(visibleToOwnerOnly: boolean): Promise<number> {
  await db();
  const match: Record<string, unknown> = { isRead: false };
  if (!visibleToOwnerOnly) match.audience = "all";
  return NotificationModel.countDocuments(match);
}

export async function markNotificationRead(id: string) {
  await db();
  if (!Types.ObjectId.isValid(id)) return;
  await NotificationModel.updateOne({ _id: new Types.ObjectId(id) }, { $set: { isRead: true } });
}

export async function markAllNotificationsRead(visibleToOwnerOnly: boolean) {
  await db();
  const match: Record<string, unknown> = { isRead: false };
  if (!visibleToOwnerOnly) match.audience = "all";
  await NotificationModel.updateMany(match, { $set: { isRead: true } });
}
