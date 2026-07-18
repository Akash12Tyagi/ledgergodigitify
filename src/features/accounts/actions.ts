"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/server/auth/guards";
import { checkRateLimit } from "@/lib/rate-limit";
import { parseActionInput } from "@/lib/validate-action";
import { runAction, type ApiResult } from "@/lib/result";
import { createAccountSchema, reverseTransferSchema, transferSchema, updateAccountSchema } from "@/schemas/account.schema";
import * as accountsService from "@/server/services/accounts.service";
import * as transfersService from "@/server/services/transfers.service";
import { getAccountActivity } from "@/server/services/financial-engine";
import type { TxFilter } from "@/types/engine";

export type AccountOption = {
  id: string;
  name: string;
  type: string;
  currentBalancePaise: number;
  isDefault: boolean;
};

function revalidateAccountPaths(accountId?: string) {
  revalidatePath("/ledger/accounts");
  if (accountId) revalidatePath(`/ledger/accounts/${accountId}`);
  revalidatePath("/ledger/overview");
  revalidatePath("/ledger/expenses");
  revalidatePath("/ledger/credits");
  revalidatePath("/dashboard");
  revalidatePath("/notifications");
}

/**
 * Read-only listing for AccountSelect (Section 7.4/7.6) — active accounts
 * only, matching Section 14 edge case 19 (archived accounts disappear
 * from every account picker).
 */
export async function listActiveAccountsAction(): Promise<ApiResult<AccountOption[]>> {
  return runAction(async () => {
    await requireUser("viewer");
    const accounts = await accountsService.listActiveAccounts();
    return accounts.map((a) => ({
      id: a._id.toString(),
      name: a.name,
      type: a.type,
      currentBalancePaise: a.currentBalancePaise,
      isDefault: a.isDefault,
    }));
  });
}

export type AccountRow = AccountOption & {
  status: "active" | "archived";
  bankName: string | null;
  last4: string | null;
  openingBalancePaise: number;
  lowBalanceThresholdPaise: number | null;
  version: number;
};

/** Section 7.7 — /ledger/accounts lists every account, active or
 * archived. */
export async function listAllAccountsAction(): Promise<ApiResult<AccountRow[]>> {
  return runAction(async () => {
    await requireUser("viewer");
    const accounts = await accountsService.listAllAccounts();
    return accounts.map((a) => ({
      id: a._id.toString(),
      name: a.name,
      type: a.type,
      currentBalancePaise: a.currentBalancePaise,
      isDefault: a.isDefault,
      status: a.status,
      bankName: a.bankName ?? null,
      last4: a.last4 ?? null,
      openingBalancePaise: a.openingBalancePaise,
      lowBalanceThresholdPaise: a.lowBalanceThresholdPaise ?? null,
      version: a.version,
    }));
  });
}

export async function createAccountAction(input: unknown): Promise<ApiResult<{ accountId: string }>> {
  return runAction(async () => {
    await checkRateLimit("mutation", "createAccount");
    const actor = await requireUser("admin");
    const parsed = parseActionInput(createAccountSchema, input);
    const account = await accountsService.createAccount(parsed, actor);
    revalidateAccountPaths();
    return { accountId: account._id.toString() };
  });
}

export async function updateAccountAction(input: unknown): Promise<ApiResult<{ version: number }>> {
  return runAction(async () => {
    await checkRateLimit("mutation", "updateAccount");
    const actor = await requireUser("admin");
    const parsed = parseActionInput(updateAccountSchema, input);
    const updated = await accountsService.updateAccount(parsed, actor);
    revalidateAccountPaths(parsed.accountId);
    return { version: updated.version };
  });
}

export async function archiveAccountAction(accountId: string): Promise<ApiResult<null>> {
  return runAction(async () => {
    await checkRateLimit("mutation", "archiveAccount");
    const actor = await requireUser("admin");
    await accountsService.archiveAccount(accountId, actor);
    revalidateAccountPaths(accountId);
    return null;
  });
}

export async function setDefaultAccountAction(accountId: string): Promise<ApiResult<null>> {
  return runAction(async () => {
    await checkRateLimit("mutation", "setDefaultAccount");
    const actor = await requireUser("admin");
    await accountsService.setDefaultAccount(accountId, actor);
    revalidateAccountPaths(accountId);
    return null;
  });
}

export type TransferResultDto = {
  groupId: string;
  fromAccountId: string;
  toAccountId: string;
  amountPaise: number;
  fromNewBalance: number;
  toNewBalance: number;
};

// Section 8.2 — transferAction. Role: admin+ (Section 1.2 — moving money
// between accounts is a structural change, same row as archiving).
export async function transferAction(input: unknown): Promise<ApiResult<TransferResultDto>> {
  return runAction(async () => {
    await checkRateLimit("mutation", "transfer");
    const actor = await requireUser("admin");
    const parsed = parseActionInput(transferSchema, input);
    const result = await transfersService.transferBetweenAccounts(parsed, actor);
    revalidateAccountPaths();
    return result;
  });
}

export async function reverseTransferAction(input: unknown): Promise<ApiResult<TransferResultDto>> {
  return runAction(async () => {
    await checkRateLimit("mutation", "reverseTransfer");
    const actor = await requireUser("admin");
    const parsed = parseActionInput(reverseTransferSchema, input);
    const result = await transfersService.reverseTransfer(parsed, actor);
    revalidateAccountPaths();
    return result;
  });
}

/** Section 7.8 — account detail activity table, server-paginated. */
export async function getAccountActivityAction(
  accountId: string,
  filter: Omit<TxFilter, "accountId">
): Promise<ApiResult<Awaited<ReturnType<typeof getAccountActivity>>>> {
  return runAction(async () => {
    await requireUser("viewer");
    return getAccountActivity(accountId, { ...filter, accountId });
  });
}
