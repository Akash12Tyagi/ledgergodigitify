import { NextResponse } from "next/server";

import { requireUser } from "@/server/auth/guards";
import { getBellFeed } from "@/server/services/notifications.service";
import { AppError } from "@/lib/errors";
import { statusForCode } from "@/lib/result";

export const dynamic = "force-dynamic";

// Section 1.3/7 — the topbar bell's TanStack Query poll target (60s).
// The only fetch('/api/...') in the app's normal navigation flow — every
// other page reads data via a direct in-process RSC service call
// (Section 9) since a bell badge needs to update without a full page
// re-render.
export async function GET() {
  try {
    const actor = await requireUser("viewer");
    const feed = await getBellFeed(actor.role);
    return NextResponse.json({ success: true, data: feed });
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
