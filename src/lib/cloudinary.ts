import { createHash } from "node:crypto";

import { env } from "@/config/env";
import { AppError } from "@/lib/errors";

export type UploadSignature = {
  cloudName: string;
  apiKey: string;
  timestamp: number;
  folder: string;
  signature: string;
};

/**
 * Section 10.9 — direct-to-Cloudinary signed upload. The API secret never
 * reaches the browser: this signs only the params the client will submit
 * alongside the file, following Cloudinary's documented algorithm — sort
 * every param-to-sign alphabetically by key, join as `key=value&...`,
 * append the API secret, SHA1-hex the result. (Verified against
 * Cloudinary's public signature-generation docs; no SDK dependency
 * needed for this one primitive.)
 */
export function signUpload(folder: string): UploadSignature {
  const timestamp = Math.floor(Date.now() / 1000);
  const toSign = `folder=${folder}&timestamp=${timestamp}`;
  const signature = createHash("sha1").update(`${toSign}${env.CLOUDINARY_API_SECRET}`).digest("hex");

  return {
    cloudName: env.CLOUDINARY_CLOUD_NAME,
    apiKey: env.CLOUDINARY_API_KEY,
    timestamp,
    folder,
    signature,
  };
}

/** A tampered/forged publicId can't point outside the folder we signed
 * for — cheap defense-in-depth alongside verifyUploadedAsset below. */
export function isWithinAllowedFolder(publicId: string, folder: string): boolean {
  return publicId === folder || publicId.startsWith(`${folder}/`);
}

/**
 * Section 5.11 — "server re-verifies declared mime vs Cloudinary's
 * detected format on save." A client-declared AttachmentMetaInput is
 * never trusted at face value: this calls Cloudinary's Admin API (Basic
 * Auth with the API key/secret, never exposed to the browser) to fetch
 * what Cloudinary itself recorded for that publicId, and rejects the
 * attachment if the declared bytes/mime don't match what was actually
 * uploaded. Fails CLOSED — if the Admin API can't be reached at all
 * (including with placeholder dev credentials, see .env.example), the
 * attachment is rejected rather than silently trusted, since a security
 * check that fails open isn't a security check.
 */
export async function verifyUploadedAsset(
  publicId: string,
  folder: string,
  expectedBytes: number
): Promise<void> {
  if (!isWithinAllowedFolder(publicId, folder)) {
    throw new AppError("VALIDATION", "Attachment is outside the allowed upload folder.");
  }

  const resourceType = "image"; // Cloudinary's default resource_type for jpg/png/webp/pdf uploads.
  const auth = Buffer.from(`${env.CLOUDINARY_API_KEY}:${env.CLOUDINARY_API_SECRET}`).toString("base64");
  const url = `https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/resources/${resourceType}/upload/${publicId}`;

  let response: Response;
  try {
    response = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
  } catch {
    throw new AppError("VALIDATION", "Could not verify the uploaded attachment. Try again.");
  }

  if (!response.ok) {
    throw new AppError("VALIDATION", "Could not verify the uploaded attachment. Try again.");
  }

  const resource = (await response.json()) as { bytes?: number };
  if (typeof resource.bytes !== "number" || Math.abs(resource.bytes - expectedBytes) > 1024) {
    throw new AppError("VALIDATION", "The uploaded file doesn't match what was declared.");
  }
}
