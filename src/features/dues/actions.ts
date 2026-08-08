"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/server/auth/guards";
import { checkRateLimit } from "@/lib/rate-limit";
import { parseActionInput } from "@/lib/validate-action";
import { runAction, type ApiResult } from "@/lib/result";
import { createDueSchema, deleteDueSchema, updateDueSchema } from "@/schemas/due.schema";
import * as duesService from "@/server/services/dues.service";
import { runRollover } from "@/server/services/rollover.service";
import { SYSTEM_ACTOR_NAME } from "@/constants/system";

/**
 * Raising, editing or removing a due changes what a client owes, which every
 * one of these screens totals. Missing any of them here is what left the
 * Ledger's "Billed" card showing a stale figure after a client was added —
 * the data was correct in the database and wrong on screen.
 */
function revalidateDuePaths(clientId?: string) {
  revalidatePath("/clients");
  if (clientId) revalidatePath(`/clients/${clientId}`);
  revalidatePath("/ledger/dues");
  revalidatePath("/ledger/overview");
  revalidatePath("/ledger/billed");
  revalidatePath("/dashboard");
  revalidatePath("/notifications");
}

export async function createDueAction(input: unknown): Promise<ApiResult<{ dueId: string }>> {
  return runAction(async () => {
    await checkRateLimit("mutation", "createDue");
    const actor = await requireUser("staff");
    const parsed = parseActionInput(createDueSchema, input);
    const billing = await duesService.createDue(parsed, actor);
    revalidateDuePaths(parsed.clientId);
    return { dueId: billing._id.toString() };
  });
}

export async function updateDueAction(input: unknown): Promise<ApiResult<{ version: number }>> {
  return runAction(async () => {
    await checkRateLimit("mutation", "updateDue");
    const actor = await requireUser("staff");
    const parsed = parseActionInput(updateDueSchema, input);
    const updated = await duesService.updateDue(parsed, actor);
    revalidateDuePaths(updated.clientId.toString());
    return { version: updated.version ?? 0 };
  });
}

/** Deleting a due removes money the business was owed, so it sits with the
 * other admin-only corrections (reversals, archiving) rather than with
 * everyday staff entry. */
export async function deleteDueAction(input: unknown): Promise<ApiResult<null>> {
  return runAction(async () => {
    await checkRateLimit("mutation", "deleteDue");
    const actor = await requireUser("admin");
    const parsed = parseActionInput(deleteDueSchema, input);
    const { clientId } = await duesService.deleteDue(parsed, actor);
    revalidateDuePaths(clientId);
    return null;
  });
}

export type GenerateDuesResult = {
  scanned: number;
  created: number;
  skipped: number;
  failed: Array<{ clientId: string; clientName: string; error: string }>;
};

/**
 * Runs the recurring-billing job on demand.
 *
 * The same job runs nightly on a schedule, but that only exists in a
 * deployed environment — locally, and on the day someone actually needs the
 * dues raised NOW, there was no way to trigger it. Since the job is
 * state-based and idempotent, pressing this when there is nothing to do is
 * a no-op rather than a way to double-bill.
 */
export async function generateDuesAction(): Promise<ApiResult<GenerateDuesResult>> {
  return runAction(async () => {
    await checkRateLimit("mutation", "generateDues");
    const actor = await requireUser("admin");
    const result = await runRollover(actor.id, `${actor.name} (${SYSTEM_ACTOR_NAME})`);
    revalidateDuePaths();
    return {
      scanned: result.scanned,
      created: result.created,
      skipped: result.skipped,
      failed: result.failed,
    };
  });
}
