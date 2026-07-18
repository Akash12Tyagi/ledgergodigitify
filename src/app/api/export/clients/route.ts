import { NextResponse } from "next/server";

import { requireUser } from "@/server/auth/guards";
import { checkRateLimit } from "@/lib/rate-limit";
import { exportClientsCsv } from "@/server/services/export.service";
import { logAudit } from "@/server/services/audit.service";
import { AppError } from "@/lib/errors";
import { statusForCode } from "@/lib/result";
import type { ClientEngagementType, ClientStatus } from "@/constants/domain";

export const dynamic = "force-dynamic";

// Section 7.13 — WYSIWYG: identical filter to /clients, same rows.
export async function GET(request: Request) {
  try {
    await checkRateLimit("export", "clients");
    const actor = await requireUser("viewer");

    const { searchParams } = new URL(request.url);
    const status = (searchParams.get("status") as ClientStatus | "all" | null) ?? "active";
    const engagementType = (searchParams.get("type") as ClientEngagementType | "all" | null) ?? "all";
    const search = searchParams.get("search") ?? undefined;

    const csv = await exportClientsCsv({ status, engagementType, ...(search ? { search } : {}) });

    await logAudit({
      actorUserId: actor.id,
      actorName: actor.name,
      action: "EXPORT_GENERATED",
      entity: { kind: "client", id: null },
      summary: `${actor.name} exported clients (status=${status}, type=${engagementType})`,
    });

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="clients-${Date.now()}.csv"`,
      },
    });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json({ success: false, error: { code: error.code } }, { status: statusForCode(error.code) });
    }
    return NextResponse.json({ success: false, error: { code: "INTERNAL" } }, { status: 500 });
  }
}
