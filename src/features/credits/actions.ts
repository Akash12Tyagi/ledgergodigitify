"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/server/auth/guards";
import { checkRateLimit } from "@/lib/rate-limit";
import { parseActionInput } from "@/lib/validate-action";
import { runAction, type ApiResult } from "@/lib/result";
import { createCreditSchema, reverseCreditSchema } from "@/schemas/credit.schema";
import * as creditsService from "@/server/services/credits.service";
import type { CreditListFilter } from "@/server/services/credits.service";

function revalidateCreditPaths() {
  revalidatePath("/ledger/credits");
  revalidatePath("/ledger/overview");
  revalidatePath("/ledger/accounts");
  revalidatePath("/dashboard");
  revalidatePath("/notifications");
}

export type CreditResult = { creditId: string; accountNewBalance: number };

// Section 8.2 — createCreditAction. Section 1.2: recording credits needs
// staff+ (same row as recordPayment/createExpense).
export async function createCreditAction(input: unknown): Promise<ApiResult<CreditResult>> {
  return runAction(async () => {
    await checkRateLimit("mutation", "createCredit");
    const actor = await requireUser("staff");
    const parsed = parseActionInput(createCreditSchema, input);
    const result = await creditsService.createCredit(parsed, actor);
    revalidateCreditPaths();
    revalidatePath(`/ledger/accounts/${parsed.accountId}`);
    return { creditId: result.credit._id.toString(), accountNewBalance: result.accountNewBalance };
  });
}

// Section 1.2: reversing transactions needs admin+.
export async function reverseCreditAction(input: unknown): Promise<ApiResult<CreditResult>> {
  return runAction(async () => {
    await checkRateLimit("mutation", "reverseCredit");
    const actor = await requireUser("admin");
    const parsed = parseActionInput(reverseCreditSchema, input);
    const result = await creditsService.reverseCredit(parsed, actor);
    revalidateCreditPaths();
    revalidatePath(`/ledger/accounts/${result.credit.accountId.toString()}`);
    return { creditId: result.credit._id.toString(), accountNewBalance: result.accountNewBalance };
  });
}

export async function listCreditsAction(
  filter: CreditListFilter
): Promise<ApiResult<Awaited<ReturnType<typeof creditsService.listCredits>>>> {
  return runAction(async () => {
    await requireUser("viewer");
    return creditsService.listCredits(filter);
  });
}
