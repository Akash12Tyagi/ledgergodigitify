"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/server/auth/guards";
import { checkRateLimit } from "@/lib/rate-limit";
import { runAction, type ApiResult } from "@/lib/result";
import * as notificationsService from "@/server/services/notifications.service";
import type { NotificationListFilter, NotificationRow } from "@/server/services/notifications.service";

export type { NotificationRow };

export async function listNotificationsAction(
  filter: Omit<NotificationListFilter, "visibleToOwnerOnly">
): Promise<ApiResult<Awaited<ReturnType<typeof notificationsService.listNotifications>>>> {
  return runAction(async () => {
    const actor = await requireUser("viewer");
    return notificationsService.listNotifications(actor.role, filter);
  });
}

export async function getBellFeedAction(): Promise<ApiResult<Awaited<ReturnType<typeof notificationsService.getBellFeed>>>> {
  return runAction(async () => {
    const actor = await requireUser("viewer");
    return notificationsService.getBellFeed(actor.role);
  });
}

export async function markNotificationReadAction(id: string): Promise<ApiResult<null>> {
  return runAction(async () => {
    await checkRateLimit("mutation", "markNotificationRead");
    await requireUser("viewer");
    await notificationsService.markRead(id);
    revalidatePath("/notifications");
    return null;
  });
}

export async function markAllNotificationsReadAction(): Promise<ApiResult<null>> {
  return runAction(async () => {
    await checkRateLimit("mutation", "markAllNotificationsRead");
    const actor = await requireUser("viewer");
    await notificationsService.markAllRead(actor.role);
    revalidatePath("/notifications");
    return null;
  });
}
