/**
 * Section 10.9/15 — end-to-end proof that the signed-upload flow actually
 * works against a real Cloudinary account: sign → upload → server-side
 * re-verify (lib/cloudinary.ts#verifyUploadedAsset) → clean up the test
 * asset. Run with: `npx tsx scripts/cloudinary-check.ts`.
 *
 * Requires real CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET in .env.local —
 * the "dev-placeholder" values checked into .env.local for local Mongo-only
 * development are deliberately rejected below rather than allowed to fail
 * with a confusing network/auth error three steps in.
 */
import { config as loadDotenv } from "dotenv";

loadDotenv({ path: ".env" });
loadDotenv({ path: ".env.local", override: true });

// A 1x1 transparent PNG — smallest possible real image/png payload, well
// under MAX_UPLOAD_BYTES, so this exercises the actual allowed-mime path.
const TEST_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

async function main() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error("CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET must be set in .env.local.");
  }
  if ([cloudName, apiKey, apiSecret].some((v) => v === "dev-placeholder")) {
    throw new Error(
      "CLOUDINARY_* env vars are still the dev-placeholder values from .env.local. " +
        "Real Cloudinary credentials are required to run this check — see .env.example " +
        "and Section 17.1's environment-provisioning steps."
    );
  }

  const { signUpload, verifyUploadedAsset } = await import("@/lib/cloudinary");

  const folder = "ledger/_healthcheck";
  console.log(`1/4 — signing an upload for folder "${folder}"...`);
  const sign = signUpload(folder);
  console.log("     signature minted:", sign.signature.slice(0, 12) + "…");

  console.log("2/4 — uploading a test image to Cloudinary...");
  const bytes = Buffer.from(TEST_PNG_BASE64, "base64");
  const formData = new FormData();
  formData.append("file", `data:image/png;base64,${TEST_PNG_BASE64}`);
  formData.append("api_key", sign.apiKey);
  formData.append("timestamp", String(sign.timestamp));
  formData.append("signature", sign.signature);
  formData.append("folder", sign.folder);

  const uploadRes = await fetch(`https://api.cloudinary.com/v1_1/${sign.cloudName}/auto/upload`, {
    method: "POST",
    body: formData,
  });
  const uploadJson = (await uploadRes.json()) as {
    public_id?: string;
    secure_url?: string;
    bytes?: number;
    error?: { message: string };
  };
  if (!uploadRes.ok || !uploadJson.public_id) {
    throw new Error(`Upload failed: ${uploadJson.error?.message ?? uploadRes.statusText}`);
  }
  console.log("     uploaded:", uploadJson.public_id, "->", uploadJson.secure_url);

  console.log("3/4 — re-verifying the asset via the Admin API (same path createExpense uses)...");
  await verifyUploadedAsset(uploadJson.public_id, folder, uploadJson.bytes ?? bytes.length);
  console.log("     verified: bytes match what Cloudinary recorded.");

  console.log("4/4 — deleting the test asset...");
  const auth = Buffer.from(`${apiKey}:${apiSecret}`).toString("base64");
  const deleteRes = await fetch(
    `https://api.cloudinary.com/v1_1/${cloudName}/resources/image/upload?public_ids[]=${encodeURIComponent(uploadJson.public_id)}`,
    { method: "DELETE", headers: { Authorization: `Basic ${auth}` } }
  );
  if (!deleteRes.ok) {
    console.warn(`     warning: cleanup delete returned ${deleteRes.status} — remove ${uploadJson.public_id} manually.`);
  } else {
    console.log("     deleted.");
  }

  console.log("\nCloudinary signed-upload round trip: PASS");
}

main().catch((error) => {
  console.error("\nCloudinary signed-upload round trip: FAIL");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
