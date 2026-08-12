import { Types } from "mongoose";

import { AppError } from "@/lib/errors";
import { withDbTransaction } from "@/lib/db-transaction";
import { runWithIdempotency, isDuplicateKeyError } from "@/lib/idempotency";
import { nowIST, dayOfMonthIST } from "@/lib/dates";
import { formatINR } from "@/lib/money";
import { buildPeriod, formatPeriodLabel, nextPeriodAfter, type BillingPeriod } from "@/lib/billing-period";
import { findAccountById, findAccountsByIds } from "@/server/repositories/accounts.repository";
import {
  findActiveExpenseTemplates,
  findExpenseTemplateById,
  findExpenseTemplatesPaginated,
  insertExpenseTemplate,
  setExpenseTemplateStatus,
  updateExpenseTemplateOptimistic,
  type ExpenseTemplateListFilter,
} from "@/server/repositories/expense-templates.repository";
import { findLatestExpenseForTemplate, insertExpense } from "@/server/repositories/expenses.repository";
import { logAudit } from "@/server/services/audit.service";
import { notify } from "@/server/services/notifications.service";
import type { AuthedUser } from "@/server/auth/guards";
import type {
  CreateExpenseTemplateInput,
  PauseExpenseTemplateInput,
  ResumeExpenseTemplateInput,
  UpdateExpenseTemplateInput,
} from "@/schemas/expense-template.schema";
import type { ExpenseTemplateRow } from "@/types/expense";

export type { ExpenseTemplateListFilter };

/** Same reasoning as rollover.service's constant: a template started years
 * ago SHOULD backfill every period it missed, so this sits far above any
 * realistic gap and exists only so a corrupt date can't spin forever. */
const MAX_CATCHUP_PERIODS = 36;

/** Pure infinite-loop guard on the calendar walk (50 years of months). Only
 * a corrupt date should ever reach it. */
const MAX_WALK_PERIODS = 600;

/** Deterministic, so a re-run of the rollover produces the identical key and
 * trips the unique index instead of raising the period twice. */
function periodIdempotencyKey(templateId: string, periodStart: Date): string {
  return `exptpl:${templateId}:${periodStart.toISOString()}`;
}

export async function listExpenseTemplates(filter: ExpenseTemplateListFilter) {
  const { rows, total, page, pageSize } = await findExpenseTemplatesPaginated(filter);
  const accountIds = [...new Set(rows.map((r) => r.accountId.toString()))];
  const accounts = await findAccountsByIds(accountIds);
  const nameById = new Map(accounts.map((a) => [a._id.toString(), a.name]));

  const items: ExpenseTemplateRow[] = rows.map((r) => ({
    id: r._id.toString(),
    amountPaise: r.amountPaise,
    reason: r.reason,
    paidToEntity: r.paidToEntity,
    category: r.category,
    accountId: r.accountId.toString(),
    accountName: nameById.get(r.accountId.toString()) ?? "",
    startDate: r.startDate.toISOString(),
    billingDay: r.billingDay,
    status: r.status as "active" | "paused",
    pausedReason: r.pausedReason ?? null,
    note: r.note ?? null,
    version: r.version,
  }));

  return { rows: items, page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
}

export async function createExpenseTemplate(input: CreateExpenseTemplateInput, actor: AuthedUser) {
  return runWithIdempotency({
    // Templates carry no idempotencyKey of their own (they are not money),
    // so a replay is detected by the first period's expense key instead.
    fetchExisting: async () => null,
    run: () =>
      withDbTransaction(async (session) => {
        const account = await findAccountById(input.accountId);
        if (!account || account.status !== "active") {
          throw new AppError("VALIDATION", "Selected account is not active");
        }

        const billingDay = input.billingDay ?? dayOfMonthIST(input.startDate);
        const templateId = new Types.ObjectId();

        const template = await insertExpenseTemplate(
          {
            _id: templateId,
            amountPaise: input.amountPaise,
            reason: input.reason,
            paidToEntity: input.paidToEntity,
            category: input.category,
            accountId: input.accountId,
            startDate: input.startDate,
            billingDay,
            generateFrom: input.startDate,
            note: input.note ?? null,
            createdBy: actor.id,
          },
          session
        );

        await logAudit(
          {
            actorUserId: actor.id,
            actorName: actor.name,
            action: "EXPENSE_TEMPLATE_CREATED",
            entity: { kind: "expense", id: templateId },
            after: {
              amountPaise: input.amountPaise,
              category: input.category,
              paidToEntity: input.paidToEntity,
              billingDay,
            },
            summary: `${actor.name} set up a recurring ${formatINR(input.amountPaise)} expense to ${input.paidToEntity} on day ${billingDay} of each month`,
          },
          session
        );

        return { template: template.toObject() };
      }),
  });
}

export async function updateExpenseTemplate(input: UpdateExpenseTemplateInput, actor: AuthedUser) {
  const before = await findExpenseTemplateById(input.templateId);
  if (!before) throw new AppError("NOT_FOUND", "Recurring expense not found");

  const account = await findAccountById(input.accountId);
  if (!account || account.status !== "active") {
    throw new AppError("VALIDATION", "Selected account is not active");
  }

  const updated = await updateExpenseTemplateOptimistic(input.templateId, input.version, {
    amountPaise: input.amountPaise,
    reason: input.reason,
    paidToEntity: input.paidToEntity,
    category: input.category,
    accountId: new Types.ObjectId(input.accountId),
    billingDay: input.billingDay,
    note: input.note ?? null,
  });
  if (!updated) {
    throw new AppError("CONFLICT", "This recurring expense changed while you were editing. Reopen and try again.");
  }

  await logAudit({
    actorUserId: actor.id,
    actorName: actor.name,
    action: "EXPENSE_TEMPLATE_UPDATED",
    entity: { kind: "expense", id: updated._id },
    before: { amountPaise: before.amountPaise, billingDay: before.billingDay },
    after: { amountPaise: updated.amountPaise, billingDay: updated.billingDay },
    summary: `${actor.name} updated the recurring expense to ${updated.paidToEntity}`,
  });

  return { template: updated };
}

/**
 * Stops future periods without touching anything already raised. Pending
 * expenses this template produced stay pending — pausing says "raise no
 * more", not "the ones I already raised never happened"; dismissing those
 * is a separate, deliberate cancel per row.
 */
export async function pauseExpenseTemplate(input: PauseExpenseTemplateInput, actor: AuthedUser) {
  const template = await findExpenseTemplateById(input.templateId);
  if (!template) throw new AppError("NOT_FOUND", "Recurring expense not found");
  if (template.status === "paused") {
    throw new AppError("CONFLICT", "This recurring expense is already paused.");
  }

  const updated = await setExpenseTemplateStatus(input.templateId, "paused", {
    pausedAt: new Date(),
    pausedReason: input.reason,
  });

  await logAudit({
    actorUserId: actor.id,
    actorName: actor.name,
    action: "EXPENSE_TEMPLATE_PAUSED",
    entity: { kind: "expense", id: new Types.ObjectId(input.templateId) },
    before: { status: "active" },
    after: { status: "paused", reason: input.reason },
    summary: `${actor.name} paused the recurring expense to ${template.paidToEntity} (${input.reason})`,
  });

  return { template: updated };
}

/**
 * Resuming does NOT backfill the paused stretch. Rollover advances from the
 * last period actually raised, so a template paused for three months will,
 * on its next run, raise those three periods as catch-up — which is wrong:
 * they were paused deliberately. `startDate` is therefore re-anchored to the
 * current period so the gap stays a gap.
 */
export async function resumeExpenseTemplate(input: ResumeExpenseTemplateInput, actor: AuthedUser) {
  const template = await findExpenseTemplateById(input.templateId);
  if (!template) throw new AppError("NOT_FOUND", "Recurring expense not found");
  if (template.status === "active") {
    throw new AppError("CONFLICT", "This recurring expense is already active.");
  }

  // Re-anchor before reactivating: rollover advances from the last period
  // raised, so without this the paused stretch would be backfilled on the
  // very next run.
  const updated = await setExpenseTemplateStatus(input.templateId, "active", {
    pausedAt: null,
    pausedReason: null,
    generateFrom: nowIST(),
  });

  await logAudit({
    actorUserId: actor.id,
    actorName: actor.name,
    action: "EXPENSE_TEMPLATE_RESUMED",
    entity: { kind: "expense", id: new Types.ObjectId(input.templateId) },
    before: { status: "paused" },
    after: { status: "active" },
    summary: `${actor.name} resumed the recurring expense to ${template.paidToEntity}`,
  });

  return { template: updated };
}

export type ExpenseRolloverResult = {
  ranAt: string;
  scanned: number;
  created: number;
  skipped: number;
  failed: Array<{ templateId: string; label: string; error: string }>;
};

/**
 * Section 6.8 E — the recurring-expense job, run daily alongside the client
 * rollover it is modelled on.
 *
 * The one deliberate difference from runRollover: a client's due is money
 * OWED the moment its period starts, so rollover posts it outright. An
 * expense is money LEAVING, and nobody should be able to drain an account
 * on a schedule with no human in the loop — so this raises PENDING rows
 * only. Nothing here touches a balance; approveExpense does that, once a
 * person confirms the money actually went out.
 *
 * Idempotency is state-based for the same reason as the client rollover:
 * the only signal consulted is what already exists, so five runs in a row —
 * or two concurrent ones — leave exactly one expense per template-period,
 * and a missed day self-heals on the next run.
 */
export async function runExpenseRollover(
  actorId: string,
  actorName: string
): Promise<ExpenseRolloverResult> {
  const templates = await findActiveExpenseTemplates();
  const nowMs = nowIST().getTime();

  let created = 0;
  let skipped = 0;
  const failed: ExpenseRolloverResult["failed"] = [];

  for (const template of templates) {
    const templateId = template._id.toString();
    const label = `${template.paidToEntity} — ${template.reason}`;

    try {
      const anchorDay = template.billingDay;
      let createdForTemplate = 0;

      const raise = async (period: BillingPeriod) => {
        await withDbTransaction(async (session) => {
          const expenseId = new Types.ObjectId();
          await insertExpense(
            {
              _id: expenseId,
              amountPaise: template.amountPaise,
              reason: template.reason,
              paidToEntity: template.paidToEntity,
              category: template.category,
              accountId: template.accountId.toString(),
              // The date it is EXPECTED to go out. approveExpense replaces
              // this with the date it actually did.
              spentAt: period.periodStart,
              note: template.note ?? null,
              status: "pending",
              transactionId: null,
              templateId: template._id,
              generatedBy: "rollover",
              periodStart: period.periodStart,
              periodEnd: period.periodEnd,
              overrideNegativeBalance: false,
              idempotencyKey: periodIdempotencyKey(templateId, period.periodStart),
              createdBy: actorId,
            },
            session
          );

          await notify(
            {
              type: "EXPENSE_PENDING_APPROVAL",
              severity: "info",
              title: "Recurring expense ready to approve",
              body: `${formatINR(template.amountPaise)} to ${template.paidToEntity} for ${formatPeriodLabel(period.periodStart, period.periodEnd)}`,
              entityRef: { kind: "expense", id: expenseId.toString() },
              href: `/ledger/expenses?status=pending`,
              audience: "all",
              dedupeKey: `EXPPEND:${expenseId.toString()}`,
            },
            session
          );

          await logAudit(
            {
              actorUserId: actorId,
              actorName,
              action: "EXPENSE_GENERATED",
              entity: { kind: "expense", id: expenseId },
              after: {
                templateId,
                period: formatPeriodLabel(period.periodStart, period.periodEnd),
                amountPaise: template.amountPaise,
              },
              summary: `Raised ${formatINR(template.amountPaise)} pending expense to ${template.paidToEntity} for ${formatPeriodLabel(period.periodStart, period.periodEnd)}`,
            },
            session
          );
        });
        createdForTemplate += 1;
      };

      const generateFromMs = template.generateFrom.getTime();
      const latest = await findLatestExpenseForTemplate(templateId);
      let cursor: BillingPeriod | null =
        latest?.periodStart && latest?.periodEnd
          ? { periodStart: latest.periodStart, periodEnd: latest.periodEnd }
          : null;

      if (!cursor) {
        // Nothing raised yet. The first period is the one anchored on the
        // template's startDate — and a template scheduled to begin next
        // month must wait, not be raised early.
        const first = buildPeriod(template.startDate, anchorDay);
        if (first.periodStart.getTime() > nowMs) {
          skipped += 1;
          continue;
        }
        if (first.periodStart.getTime() >= generateFromMs) await raise(first);
        cursor = first;
      }

      // A period becomes raisable the moment it starts, which is exactly
      // when the previous one ends (periodEnd is exclusive).
      //
      // Two separate caps, because they bound different things: iterations
      // walk the calendar and cost nothing, while raises write to the
      // database. A template resumed after a long pause legitimately walks
      // many periods and raises none of them, so bounding the walk by the
      // raise limit would report a false failure.
      let iterations = 0;
      while (cursor.periodEnd.getTime() <= nowMs) {
        if (createdForTemplate >= MAX_CATCHUP_PERIODS || iterations >= MAX_WALK_PERIODS) {
          failed.push({
            templateId,
            label,
            error: `Stopped after ${createdForTemplate} raised / ${iterations} period(s) walked — check this template's dates.`,
          });
          break;
        }
        iterations += 1;

        const next = nextPeriodAfter(cursor, anchorDay);
        cursor = next;

        // Periods before `generateFrom` were skipped deliberately (the
        // template was paused across them). Walk past without raising.
        if (next.periodStart.getTime() < generateFromMs) continue;

        await raise(next);
      }

      if (createdForTemplate === 0) skipped += 1;
      created += createdForTemplate;
    } catch (error) {
      if (isDuplicateKeyError(error, "templateId") || isDuplicateKeyError(error, "idempotencyKey")) {
        // A concurrent run already raised this exact {templateId,
        // periodStart}. The guarantee working, not a failure.
        skipped += 1;
        continue;
      }
      failed.push({
        templateId,
        label,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    ranAt: new Date().toISOString(),
    scanned: templates.length,
    created,
    skipped,
    failed,
  };
}
