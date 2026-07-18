"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/server/auth/guards";
import { checkRateLimit } from "@/lib/rate-limit";
import { parseActionInput } from "@/lib/validate-action";
import { runAction, type ApiResult } from "@/lib/result";
import { clientInputSchema, updateClientSchema } from "@/schemas/client.schema";
import * as clientsService from "@/server/services/clients.service";
import { getClientTotalDue } from "@/server/services/financial-engine";

// Section 8.2 — every mutation follows the same skeleton: rateLimit ->
// requireUser(role) -> schema.parse -> service call -> revalidatePath ->
// return envelope. Role thresholds match Section 1.2's matrix: creating/
// editing/pausing/resuming a client needs staff+; archiving needs admin+
// (same row as "Archive clients" in the matrix).

function revalidateClientPaths(clientId?: string) {
  revalidatePath("/clients");
  if (clientId) revalidatePath(`/clients/${clientId}`);
  revalidatePath("/dashboard");
  revalidatePath("/ledger/dues");
}

export async function createClientAction(input: unknown): Promise<ApiResult<{ clientId: string }>> {
  return runAction(async () => {
    await checkRateLimit("mutation", "createClient");
    const actor = await requireUser("staff");
    const parsed = parseActionInput(clientInputSchema, input);
    const { client } = await clientsService.createClient(parsed, actor);
    revalidateClientPaths();
    return { clientId: client._id.toString() };
  });
}

export async function updateClientAction(
  clientId: string,
  input: unknown
): Promise<ApiResult<{ version: number }>> {
  return runAction(async () => {
    await checkRateLimit("mutation", "updateClient");
    const actor = await requireUser("staff");
    const parsed = parseActionInput(updateClientSchema, input);
    const updated = await clientsService.updateClient(clientId, parsed, actor);
    revalidateClientPaths(clientId);
    return { version: updated.version };
  });
}

export async function pauseClientAction(clientId: string): Promise<ApiResult<null>> {
  return runAction(async () => {
    await checkRateLimit("mutation", "pauseClient");
    const actor = await requireUser("staff");
    await clientsService.pauseClient(clientId, actor);
    revalidateClientPaths(clientId);
    return null;
  });
}

export async function resumeClientAction(clientId: string): Promise<ApiResult<null>> {
  return runAction(async () => {
    await checkRateLimit("mutation", "resumeClient");
    const actor = await requireUser("staff");
    await clientsService.resumeClient(clientId, actor);
    revalidateClientPaths(clientId);
    return null;
  });
}

export async function archiveClientAction(
  clientId: string,
  reason: string | null
): Promise<ApiResult<null>> {
  return runAction(async () => {
    await checkRateLimit("mutation", "archiveClient");
    const actor = await requireUser("admin");
    await clientsService.archiveClient(clientId, reason, actor);
    revalidateClientPaths(clientId);
    revalidatePath("/ledger/dues");
    return null;
  });
}

export async function unarchiveClientAction(clientId: string): Promise<ApiResult<null>> {
  return runAction(async () => {
    await checkRateLimit("mutation", "unarchiveClient");
    const actor = await requireUser("admin");
    await clientsService.unarchiveClient(clientId, actor);
    revalidateClientPaths(clientId);
    return null;
  });
}

/** Read-only pre-submit warning (Section 6.6 step 1) — no rate-limit/role
 * gate beyond plain authentication, since it never mutates anything. */
export async function checkClientNameAction(
  name: string
): Promise<ApiResult<{ duplicate: boolean; existingClientId: string | null }>> {
  return runAction(async () => {
    await requireUser("viewer");
    return clientsService.checkClientName(name);
  });
}

/** Section 7.4 — archive confirmation dialog needs the current total due
 * to word its warning with a real number. */
export async function getClientTotalDueAction(clientId: string): Promise<ApiResult<number>> {
  return runAction(async () => {
    await requireUser("viewer");
    return getClientTotalDue(clientId);
  });
}
