"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/server/auth/guards";
import { checkRateLimit } from "@/lib/rate-limit";
import { parseActionInput } from "@/lib/validate-action";
import { runAction, type ApiResult } from "@/lib/result";
import {
  createExpenseTemplateSchema,
  pauseExpenseTemplateSchema,
  resumeExpenseTemplateSchema,
  updateExpenseTemplateSchema,
} from "@/schemas/expense-template.schema";
import * as templatesService from "@/server/services/expense-templates.service";
import type { ExpenseTemplateListFilter } from "@/server/services/expense-templates.service";

function revalidateTemplatePaths() {
  revalidatePath("/ledger/recurring");
  revalidatePath("/ledger/expenses");
}

export type ExpenseTemplateResult = { templateId: string };

/**
 * Role: admin+, deliberately stricter than recording a one-off expense
 * (staff+). A template is a standing instruction to raise money out of an
 * account every month; committing to that is a different decision from
 * entering something that already happened.
 */
export async function createExpenseTemplateAction(
  input: unknown
): Promise<ApiResult<ExpenseTemplateResult>> {
  return runAction(async () => {
    await checkRateLimit("mutation", "createExpenseTemplate");
    const actor = await requireUser("admin");
    const parsed = parseActionInput(createExpenseTemplateSchema, input);
    const result = await templatesService.createExpenseTemplate(parsed, actor);
    revalidateTemplatePaths();
    return { templateId: result.template._id.toString() };
  });
}

export async function updateExpenseTemplateAction(
  input: unknown
): Promise<ApiResult<ExpenseTemplateResult>> {
  return runAction(async () => {
    await checkRateLimit("mutation", "updateExpenseTemplate");
    const actor = await requireUser("admin");
    const parsed = parseActionInput(updateExpenseTemplateSchema, input);
    const result = await templatesService.updateExpenseTemplate(parsed, actor);
    revalidateTemplatePaths();
    return { templateId: result.template._id.toString() };
  });
}

export async function pauseExpenseTemplateAction(
  input: unknown
): Promise<ApiResult<ExpenseTemplateResult>> {
  return runAction(async () => {
    await checkRateLimit("mutation", "pauseExpenseTemplate");
    const actor = await requireUser("admin");
    const parsed = parseActionInput(pauseExpenseTemplateSchema, input);
    await templatesService.pauseExpenseTemplate(parsed, actor);
    revalidateTemplatePaths();
    return { templateId: parsed.templateId };
  });
}

export async function resumeExpenseTemplateAction(
  input: unknown
): Promise<ApiResult<ExpenseTemplateResult>> {
  return runAction(async () => {
    await checkRateLimit("mutation", "resumeExpenseTemplate");
    const actor = await requireUser("admin");
    const parsed = parseActionInput(resumeExpenseTemplateSchema, input);
    await templatesService.resumeExpenseTemplate(parsed, actor);
    revalidateTemplatePaths();
    return { templateId: parsed.templateId };
  });
}

export async function listExpenseTemplatesAction(
  filter: ExpenseTemplateListFilter
): Promise<ApiResult<Awaited<ReturnType<typeof templatesService.listExpenseTemplates>>>> {
  return runAction(async () => {
    await requireUser("viewer");
    return templatesService.listExpenseTemplates(filter);
  });
}
