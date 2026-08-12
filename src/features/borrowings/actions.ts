"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/server/auth/guards";
import { checkRateLimit } from "@/lib/rate-limit";
import { parseActionInput } from "@/lib/validate-action";
import { runAction, type ApiResult } from "@/lib/result";
import {
  createBorrowingSchema,
  recordRepaymentSchema,
  writeOffBorrowingSchema,
} from "@/schemas/borrowing.schema";
import * as borrowingsService from "@/server/services/borrowings.service";
import type { BorrowingListFilter } from "@/server/services/borrowings.service";

function revalidateBorrowingPaths() {
  revalidatePath("/ledger/borrowers");
  revalidatePath("/ledger/overview");
  revalidatePath("/ledger/accounts");
  revalidatePath("/dashboard");
}

export type BorrowingResult = { borrowingId: string; accountNewBalance: number };

/**
 * Role: admin+. Lending is money leaving the business against nothing but a
 * promise, which is a heavier call than recording a spend that already
 * happened (staff+).
 */
export async function createBorrowingAction(input: unknown): Promise<ApiResult<BorrowingResult>> {
  return runAction(async () => {
    await checkRateLimit("mutation", "createBorrowing");
    const actor = await requireUser("admin");
    const parsed = parseActionInput(createBorrowingSchema, input);
    const result = await borrowingsService.createBorrowing(parsed, actor);
    revalidateBorrowingPaths();
    revalidatePath(`/ledger/accounts/${parsed.accountId}`);
    return {
      borrowingId: result.borrowing._id.toString(),
      accountNewBalance: result.accountNewBalance,
    };
  });
}

/** Role: staff+ — the same bar as recording a client payment. Money coming
 * IN is the one direction that cannot leave the business short. */
export async function recordRepaymentAction(input: unknown): Promise<ApiResult<BorrowingResult>> {
  return runAction(async () => {
    await checkRateLimit("mutation", "recordBorrowRepayment");
    const actor = await requireUser("staff");
    const parsed = parseActionInput(recordRepaymentSchema, input);
    const result = await borrowingsService.recordRepayment(parsed, actor);
    revalidateBorrowingPaths();
    revalidatePath(`/ledger/accounts/${parsed.accountId}`);
    return {
      borrowingId: result.borrowing._id.toString(),
      accountNewBalance: result.accountNewBalance,
    };
  });
}

/** Role: owner only. Writing off is deciding the business will never see
 * this money again — the one action here nobody else should be able to take. */
export async function writeOffBorrowingAction(
  input: unknown
): Promise<ApiResult<{ borrowingId: string; forgivenPaise: number }>> {
  return runAction(async () => {
    await checkRateLimit("mutation", "writeOffBorrowing");
    const actor = await requireUser("owner");
    const parsed = parseActionInput(writeOffBorrowingSchema, input);
    const result = await borrowingsService.writeOffBorrowing(parsed, actor);
    revalidateBorrowingPaths();
    return {
      borrowingId: result.borrowing._id.toString(),
      forgivenPaise: result.forgivenPaise,
    };
  });
}

export async function listBorrowingsAction(
  filter: BorrowingListFilter
): Promise<ApiResult<Awaited<ReturnType<typeof borrowingsService.listBorrowings>>>> {
  return runAction(async () => {
    await requireUser("viewer");
    return borrowingsService.listBorrowings(filter);
  });
}

export async function getBorrowingDetailAction(
  borrowingId: string
): Promise<ApiResult<Awaited<ReturnType<typeof borrowingsService.getBorrowingDetail>>>> {
  return runAction(async () => {
    await requireUser("viewer");
    return borrowingsService.getBorrowingDetail(borrowingId);
  });
}
