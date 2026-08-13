import { NextResponse } from "next/server";

import { requireUser } from "@/server/auth/guards";
import { checkRateLimit } from "@/lib/rate-limit";
import { exportBackupXlsx } from "@/server/services/backup.service";
import { logAudit } from "@/server/services/audit.service";
import { AppError } from "@/lib/errors";
import { statusForCode } from "@/lib/result";

export const dynamic = "force-dynamic";
/** Reads every collection and builds a workbook — well past the default
 * function timeout on anything but a trivial database. */
export const maxDuration = 60;

/**
 * RUNBOOK §7 — full-database backup as one .xlsx.
 *
 * OWNER only, unlike the per-list CSV exports (viewer). Those hand out one
 * screen's rows; this hands out the entire ledger plus the credential rows
 * behind every login, in a single file. It is the most sensitive request the
 * app can serve, so it sits at the highest role and is written to the audit
 * log every single time — if a copy of the business ever walks out, the
 * trail of who took it and when is the thing that matters.
 */
export async function GET() {
  try {
    await checkRateLimit("export", "backup");
    const actor = await requireUser("owner");

    const { buffer, manifest, filename } = await exportBackupXlsx();

    await logAudit({
      actorUserId: actor.id,
      actorName: actor.name,
      action: "EXPORT_GENERATED",
      entity: { kind: "system", id: null },
      after: {
        kind: "full-backup",
        formatVersion: manifest.formatVersion,
        totalDocuments: manifest.totalDocuments,
        collections: manifest.collections.length,
      },
      summary: `${actor.name} downloaded a full database backup (${manifest.totalDocuments} document(s) across ${manifest.collections.length} collection(s))`,
    });

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(buffer.byteLength),
        // Never let a proxy or the browser hold a copy of this one.
        "Cache-Control": "no-store, no-cache, must-revalidate, private",
      },
    });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json(
        { success: false, error: { code: error.code } },
        { status: statusForCode(error.code) }
      );
    }
    return NextResponse.json({ success: false, error: { code: "INTERNAL" } }, { status: 500 });
  }
}
