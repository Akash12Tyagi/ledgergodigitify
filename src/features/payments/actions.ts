"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/server/auth/guards";
import { checkRateLimit } from "@/lib/rate-limit";
import { parseActionInput } from "@/lib/validate-action";
import { runAction, type ApiResult } from "@/lib/result";
import { recordPaymentSchema, reversePaymentSchema } from "@/schemas/payment.schema";
import * as paymentsService from "@/server/services/payments.service";
import type { PayStatus } from "@/constants/domain";

function revalidatePaymentPaths(clientId: string) {
  revalidatePath("/clients");
  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/ledger/overview");
  revalidatePath("/ledger/dues");
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
    revalidatePaymentPaths(parsed.clientId);
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
    revalidatePaymentPaths(result.payment.clientId.toString());
    return {
      paymentId: result.payment._id.toString(),
      receiptNumber: result.payment.receiptNumber,
      invoiceNumber: result.payment.invoiceNumber,
      newBillingStatus: result.newBillingStatus,
      accountNewBalance: result.accountNewBalance,
    };
  });
}
