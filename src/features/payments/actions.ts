"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/server/auth/guards";
import { checkRateLimit } from "@/lib/rate-limit";
import { parseActionInput } from "@/lib/validate-action";
import { runAction, type ApiResult } from "@/lib/result";
import { recordPaymentSchema, reversePaymentSchema } from "@/schemas/payment.schema";
import * as paymentsService from "@/server/services/payments.service";
import type { PayStatus } from "@/constants/domain";

/**
 * A payment moves money into a real account and changes what a client owes,
 * so it invalidates both sides of the ledger.
 *
 * The account paths matter as much as the client ones: recording a payment
 * calls incrementAccountBalance, so leaving /ledger/accounts out — as this
 * did, while the expenses and credits actions correctly included it — meant
 * account balances kept showing a pre-payment figure until something else
 * happened to refresh them.
 */
function revalidatePaymentPaths(clientId: string, accountId?: string) {
  revalidatePath("/clients");
  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/ledger/overview");
  revalidatePath("/ledger/dues");
  revalidatePath("/ledger/billed");
  revalidatePath("/ledger/accounts");
  if (accountId) revalidatePath(`/ledger/accounts/${accountId}`);
  revalidatePath("/dashboard");
  revalidatePath("/notifications");
}

export type RecordPaymentResult = {
  paymentId: string;
  receiptNumber: string;
  invoiceNumber: string;
  newBillingStatus: PayStatus;
  accountNewBalance: number;
};

// Section 8.2 — recordPaymentAction. Section 1.2: record payments needs
// staff+.
export async function recordPaymentAction(input: unknown): Promise<ApiResult<RecordPaymentResult>> {
  return runAction(async () => {
    await checkRateLimit("mutation", "recordPayment");
    const actor = await requireUser("staff");
    const parsed = parseActionInput(recordPaymentSchema, input);
    const result = await paymentsService.recordPayment(parsed, actor);
    revalidatePaymentPaths(parsed.clientId, parsed.accountId);
    return {
      paymentId: result.payment._id.toString(),
      receiptNumber: result.payment.receiptNumber,
      invoiceNumber: result.payment.invoiceNumber,
      newBillingStatus: result.newBillingStatus,
      accountNewBalance: result.accountNewBalance,
    };
  });
}

// Section 8.2 — reversePaymentAction. Section 1.2: reversing transactions
// needs admin+.
export async function reversePaymentAction(input: unknown): Promise<ApiResult<RecordPaymentResult>> {
  return runAction(async () => {
    await checkRateLimit("mutation", "reversePayment");
    const actor = await requireUser("admin");
    const parsed = parseActionInput(reversePaymentSchema, input);
    const result = await paymentsService.reversePayment(parsed, actor);
    revalidatePaymentPaths(
      result.payment.clientId.toString(),
      result.payment.accountId.toString()
    );
    return {
      paymentId: result.payment._id.toString(),
      receiptNumber: result.payment.receiptNumber,
      invoiceNumber: result.payment.invoiceNumber,
      newBillingStatus: result.newBillingStatus,
      accountNewBalance: result.accountNewBalance,
    };
  });
}
