"use server";

import { revalidatePath } from "next/cache";

import { requireAuthenticated } from "@/server/auth/guards";
import { checkRateLimit } from "@/lib/rate-limit";
import { parseActionInput } from "@/lib/validate-action";
import { runAction, type ApiResult } from "@/lib/result";
import { updateProfileSchema } from "@/schemas/profile.schema";
import * as profileService from "@/server/services/profile.service";
import type { ProfileData } from "@/server/services/profile.service";

export type { ProfileData };

export async function updateProfileAction(input: unknown): Promise<ApiResult<ProfileData>> {
  return runAction(async () => {
    await checkRateLimit("mutation", "updateProfile");
    const actor = await requireAuthenticated();
    const parsed = parseActionInput(updateProfileSchema, input);
    const result = await profileService.updateProfile(parsed, actor);
    revalidatePath("/profile");
    return result;
  });
}
