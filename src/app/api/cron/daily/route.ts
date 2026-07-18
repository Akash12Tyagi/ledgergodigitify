import { NextResponse } from "next/server";

import { env } from "@/config/env";
import { runRollover } from "@/server/services/rollover.service";
import { runDueReminders, runMonthSummary } from "@/server/services/notifications.service";
import { runReconciliation } from "@/server/services/reconciliation.service";
import { logAudit } from "@/server/services/audit.service";
import { SYSTEM_ACTOR_ID, SYSTEM_ACTOR_NAME } from "@/constants/system";

export const dynamic = "force-dynamic";

/**
 * Section 6.8 A–D — the single daily cron entry point. Every job inside
 * is independently idempotent (state-based, not "did I run today" —
 * Section 14 edge case 41/42), so Vercel's at-least-once cron delivery
 * and manual re-triggers are always safe: running this 5x in a row
 * produces the exact same end state as running it once.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = new Date().toISOString();

  const rollover = await runRollover(SYSTEM_ACTOR_ID, SYSTEM_ACTOR_NAME);
  const dueReminders = await runDueReminders();
  const monthSummary = await runMonthSummary();
  const reconciliation = await runReconciliation();

  const summary = { rollover, dueReminders, monthSummary, reconciliation };

  await logAudit({
    actorUserId: SYSTEM_ACTOR_ID,
    actorName: SYSTEM_ACTOR_NAME,
    action: "CRON_RUN",
    entity: { kind: "system", id: null },
    after: summary,
    summary: `Daily cron: ${rollover.created} billing(s) generated, ${dueReminders.upcomingCreated + dueReminders.overdueCreated} due reminder(s), month summary ${monthSummary.created ? "sent" : "skipped"}, ${reconciliation.lockedAccountIds.length} account(s) locked for reconciliation.`,
  });

  return NextResponse.json({ ok: true, startedAt, finishedAt: new Date().toISOString(), ...summary });
}
