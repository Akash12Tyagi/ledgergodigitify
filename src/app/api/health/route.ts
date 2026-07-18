import { NextResponse } from "next/server";

import { db } from "@/database/connection";

// Section 8.3 — { ok, db, time }; db ping with a 2s timeout. Used by the
// uptime monitor (Section 18.2) and to warm the connection on cold start
// (Section 14 edge case 43).
export const dynamic = "force-dynamic";

export async function GET() {
  const time = new Date().toISOString();
  try {
    const connection = await db();
    const pingResult = await Promise.race([
      connection.connection.db?.admin().ping(),
      new Promise((_resolve, reject) =>
        setTimeout(() => reject(new Error("DB ping timeout")), 2000)
      ),
    ]);
    if (!pingResult) throw new Error("No database handle");
    return NextResponse.json({ ok: true, db: "up", time });
  } catch {
    return NextResponse.json({ ok: false, db: "down", time }, { status: 500 });
  }
}
