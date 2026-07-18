import { NextResponse } from "next/server";

import { requireUser } from "@/server/auth/guards";
import { checkRateLimit } from "@/lib/rate-limit";
import { exportTransactionsCsv } from "@/server/services/export.service";
import { logAudit } from "@/server/services/audit.service";
import { AppError } from "@/lib/errors";
import { statusForCode } from "@/lib/result";
import { nowIST, toMonthKey } from "@/lib/dates";
import { TRANSACTION_TYPES, type TransactionType } from "@/constants/domain";

export const dynamic = "force-dynamic";

// Section 7.13 — WYSIWYG: identical filter to /ledger/overview's
// transaction list, same rows.
export async function GET(request: Request) {
  try {
    await checkRateLimit("export", "transactions");
    const actor = await requireUser("viewer");

    const { searchParams } = new URL(request.url);
    const monthKey = searchParams.get("monthKey") ?? toMonthKey(nowIST());
    const typeParam = searchParams.get("type");
    const type =
      typeParam && (TRANSACTION_TYPES as readonly string[]).includes(typeParam)
        ? [typeParam as TransactionType]
        : undefined;

    const csv = await exportTransactionsCsv({ monthKey, ...(type ? { type } : {}) });

    await logAudit({
      actorUserId: actor.id,
      actorName: actor.name,
      action: "EXPORT_GENERATED",
      entity: { kind: "system", id: null },
      summary: `${actor.name} exported transactions (monthKey=${monthKey}${type ? `, type=${type[0]}` : ""})`,
    });

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="transactions-${monthKey}.csv"`,
      },
    });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json({ success: false, error: { code: error.code } }, { status: statusForCode(error.code) });
    }
    return NextResponse.json({ success: false, error: { code: "INTERNAL" } }, { status: 500 });
  }
}
