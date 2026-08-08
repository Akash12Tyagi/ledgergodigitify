import { NextResponse } from "next/server";

import { requireUser } from "@/server/auth/guards";
import { checkRateLimit } from "@/lib/rate-limit";
import { exportCreditsCsv } from "@/server/services/export.service";
import { currentExportPeriod } from "@/server/services/export-period";
import { logAudit } from "@/server/services/audit.service";
import { AppError } from "@/lib/errors";
import { statusForCode } from "@/lib/result";
import type { CreditCategory } from "@/constants/domain";

export const dynamic = "force-dynamic";

// Section 7.13 — WYSIWYG: identical filter to /ledger/credits, same rows.
export async function GET(request: Request) {
  try {
    await checkRateLimit("export", "credits");
    const actor = await requireUser("viewer");

    const { searchParams } = new URL(request.url);
    const category = (searchParams.get("category") as CreditCategory | "all" | null) ?? "all";
    const status = (searchParams.get("status") as "active" | "reversed" | "all" | null) ?? "active";
    const accountId = searchParams.get("accountId") ?? undefined;

    const period = await currentExportPeriod();
    const csv = await exportCreditsCsv({
      category,
      status,
      ...(accountId ? { accountId } : {}),
      receivedFrom: period.startUTC,
      receivedTo: period.endUTC,
    });

    await logAudit({
      actorUserId: actor.id,
      actorName: actor.name,
      action: "EXPORT_GENERATED",
      entity: { kind: "credit", id: null },
      summary: `${actor.name} exported credits (category=${category}, status=${status})`,
    });

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="credits-${Date.now()}.csv"`,
      },
    });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json({ success: false, error: { code: error.code } }, { status: statusForCode(error.code) });
    }
    return NextResponse.json({ success: false, error: { code: "INTERNAL" } }, { status: 500 });
  }
}
