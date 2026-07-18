import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/server/auth/guards";
import { checkRateLimit } from "@/lib/rate-limit";
import { signUpload } from "@/lib/cloudinary";
import { statusForCode, type ApiResult } from "@/lib/result";
import { AppError } from "@/lib/errors";

const UPLOAD_SCOPES = ["payments", "expenses", "credits"] as const;
const bodySchema = z.strictObject({ scope: z.enum(UPLOAD_SCOPES) });

// Section 10.9 — issues a Cloudinary signed-upload payload. The browser
// never sees CLOUDINARY_API_SECRET; it only receives a short-lived
// signature scoped to one folder, minted per request.
export async function POST(request: Request) {
  try {
    await checkRateLimit("mutation", "uploadSign");
    await requireUser("staff");

    const json = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      throw new AppError("VALIDATION", "Invalid upload scope.");
    }

    const folder = `ledger/${parsed.data.scope}`;
    const signature = signUpload(folder);
    const result: ApiResult<typeof signature> = { success: true, message: "OK", data: signature };
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AppError) {
      const result: ApiResult<never> = {
        success: false,
        message: error.message,
        data: null,
        error: { code: error.code },
      };
      return NextResponse.json(result, { status: statusForCode(error.code) });
    }
    const result: ApiResult<never> = {
      success: false,
      message: "Something went wrong.",
      data: null,
      error: { code: "INTERNAL" },
    };
    return NextResponse.json(result, { status: 500 });
  }
}
