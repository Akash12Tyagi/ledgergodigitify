"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/server/auth/guards";
import { checkRateLimit } from "@/lib/rate-limit";
import { parseActionInput } from "@/lib/validate-action";
import { runAction, type ApiResult } from "@/lib/result";
import { updateSettingsSchema } from "@/schemas/settings.schema";
import { createUserSchema, updateUserRoleSchema } from "@/schemas/user.schema";
import * as settingsService from "@/server/services/settings.service";
import { listLockedAccounts } from "@/server/services/accounts.service";
import { resolveReconciliation } from "@/server/services/reconciliation.service";
import type { CreateUserResult, UserRow } from "@/server/services/settings.service";

export type { CreateUserResult, UserRow };

function revalidateSettingsPaths() {
  revalidatePath("/settings");
  revalidatePath("/settings/users");
}

export async function updateSettingsAction(input: unknown): Promise<ApiResult<null>> {
  return runAction(async () => {
    await checkRateLimit("mutation", "updateSettings");
    const actor = await requireUser("owner");
    const parsed = parseActionInput(updateSettingsSchema, input);
    await settingsService.updateSettings(parsed, actor);
    revalidateSettingsPaths();
    revalidatePath("/dashboard");
    return null;
  });
}

export async function listUsersAction(): Promise<ApiResult<UserRow[]>> {
  return runAction(async () => {
    await requireUser("owner");
    return settingsService.listUsers();
  });
}

export async function createUserAction(input: unknown): Promise<ApiResult<CreateUserResult>> {
  return runAction(async () => {
    await checkRateLimit("mutation", "createUser");
    const actor = await requireUser("owner");
    const parsed = parseActionInput(createUserSchema, input);
    const result = await settingsService.createUser(parsed, actor);
    revalidateSettingsPaths();
    return result;
  });
}

export async function updateUserRoleAction(input: unknown): Promise<ApiResult<null>> {
  return runAction(async () => {
    await checkRateLimit("mutation", "updateUserRole");
    const actor = await requireUser("owner");
    const parsed = parseActionInput(updateUserRoleSchema, input);
    await settingsService.updateUserRole(parsed, actor);
    revalidateSettingsPaths();
    return null;
  });
}

export async function deactivateUserAction(userId: string): Promise<ApiResult<null>> {
  return runAction(async () => {
    await checkRateLimit("mutation", "deactivateUser");
    const actor = await requireUser("owner");
    await settingsService.deactivateUser(userId, actor);
    revalidateSettingsPaths();
    return null;
  });
}

export async function reactivateUserAction(userId: string): Promise<ApiResult<null>> {
  return runAction(async () => {
    await checkRateLimit("mutation", "reactivateUser");
    const actor = await requireUser("owner");
    await settingsService.reactivateUser(userId, actor);
    revalidateSettingsPaths();
    return null;
  });
}

export async function listLockedAccountsAction(): Promise<ApiResult<Awaited<ReturnType<typeof listLockedAccounts>>>> {
  return runAction(async () => {
    await requireUser("owner");
    return listLockedAccounts();
  });
}

export async function resolveReconciliationAction(accountId: string): Promise<ApiResult<null>> {
  return runAction(async () => {
    await checkRateLimit("mutation", "resolveReconciliation");
    const actor = await requireUser("owner");
    await resolveReconciliation(accountId, actor);
    revalidateSettingsPaths();
    revalidatePath("/ledger/accounts");
    revalidatePath(`/ledger/accounts/${accountId}`);
    return null;
  });
}
