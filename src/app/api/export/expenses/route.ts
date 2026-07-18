import { NextResponse } from "next/server";

import { requireUser } from "@/server/auth/guards";
import { checkRateLimit } from "@/lib/rate-limit";
import { exportExpensesCsv } from "@/server/services/export.service";
import { logAudit } from "@/server/services/audit.service";
import { AppError } from "@/lib/errors";
import { statusForCode } from "@/lib/result";
import type { ExpenseCategory } from "@/constants/domain";

export const dynamic = "force-dynamic";

// Section 7.13 — WYSIWYG: identical filter to /ledger/expenses, same rows.
export async function GET(request: Request) {
  try {
    await checkRateLimit("export", "expenses");
    const actor = await requireUser("viewer");

    const { searchParams } = new URL(request.url);
    const category = (searchParams.get("category") as ExpenseCategory | "all" | null) ?? "all";
    const status = (searchParams.get("status") as "active" | "reversed" | "all" | null) ?? "active";
    const accountId = searchParams.get("accountId") ?? undefined;

    const csv = await exportExpensesCsv({ category, status, ...(accountId ? { accountId } : {}) });

    await logAudit({
      actorUserId: actor.id,
      actorName: actor.name,
      action: "EXPORT_GENERATED",
      entity: { kind: "expense", id: null },
      summary: `${actor.name} exported expenses (category=${category}, status=${status})`,
    });

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="expenses-${Date.now()}.csv"`,
      },
    });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json({ success: false, error: { code: error.code } }, { status: statusForCode(error.code) });
    }
    return NextResponse.json({ success: false, error: { code: "INTERNAL" } }, { status: 500 });
  }
}
