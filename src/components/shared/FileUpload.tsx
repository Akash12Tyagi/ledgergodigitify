"use client";

import * as React from "react";
import { Loader2, Paperclip, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ALLOWED_UPLOAD_MIME, MAX_ATTACHMENTS_PER_ENTITY, MAX_UPLOAD_BYTES } from "@/constants/finance";
import type { AttachmentMetaInput } from "@/types/attachment";

type UploadScope = "payments" | "expenses" | "credits";

type SignResponse = {
  cloudName: string;
  apiKey: string;
  timestamp: number;
  folder: string;
  signature: string;
};

/**
 * Section 10.9 — direct-to-Cloudinary signed upload, never through our
 * own server (no file bytes ever touch a Next.js route). Validates
 * mime/size client-side before ever hitting the network; the server
 * re-verifies both after upload (lib/cloudinary.ts#verifyUploadedAsset)
 * since a client-side check is UX only, never a security boundary.
 */
export function FileUpload({
  scope,
  value,
  onChange,
  disabled,
}: {
  scope: UploadScope;
  value: AttachmentMetaInput[];
  onChange: (next: AttachmentMetaInput[]) => void;
  disabled?: boolean;
}) {
  const [uploading, setUploading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    const file = files[0];
    if (!file) return;

    if (value.length >= MAX_ATTACHMENTS_PER_ENTITY) {
      setError(`At most ${MAX_ATTACHMENTS_PER_ENTITY} attachments allowed.`);
      return;
    }
    if (!(ALLOWED_UPLOAD_MIME as readonly string[]).includes(file.type)) {
      setError("Only PDF, JPEG, PNG, or WEBP files are allowed.");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError("File is too large (max 10 MB).");
      return;
    }

    setUploading(true);
    try {
      const signRes = await fetch("/api/uploads/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope }),
      });
      const signJson = (await signRes.json()) as {
        success: boolean;
        data?: SignResponse;
        message?: string;
      };
      if (!signJson.success || !signJson.data) {
        throw new Error(signJson.message ?? "Could not start upload");
      }
      const sign = signJson.data;

      const formData = new FormData();
      formData.append("file", file);
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
      if (!uploadRes.ok || !uploadJson.public_id || !uploadJson.secure_url) {
        throw new Error(uploadJson.error?.message ?? "Upload failed");
      }

      const attachment: AttachmentMetaInput = {
        publicId: uploadJson.public_id,
        url: uploadJson.secure_url,
        originalName: file.name,
        bytes: uploadJson.bytes ?? file.size,
        mime: file.type as AttachmentMetaInput["mime"],
      };
      onChange([...value, attachment]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function removeAt(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  const atLimit = value.length >= MAX_ATTACHMENTS_PER_ENTITY;

  return (
    <div className="grid gap-2">
      {value.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {value.map((att, i) => (
            <div
              key={att.publicId}
              className="flex items-center gap-1 rounded-lg border px-2 py-1 text-xs"
            >
              <Paperclip className="size-3 shrink-0" />
              <span className="max-w-[140px] truncate">{att.originalName ?? att.publicId}</span>
              <button
                type="button"
                onClick={() => removeAt(i)}
                disabled={disabled}
                aria-label="Remove attachment"
                className="text-muted-foreground hover:text-destructive"
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <input
        ref={inputRef}
        type="file"
        accept={ALLOWED_UPLOAD_MIME.join(",")}
        onChange={(e) => void handleFiles(e.target.files)}
        disabled={disabled || uploading || atLimit}
        className="hidden"
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-fit"
        disabled={disabled || uploading || atLimit}
        onClick={() => inputRef.current?.click()}
      >
        {uploading ? <Loader2 className="size-4 animate-spin" /> : <Paperclip className="size-4" />}
        {uploading ? "Uploading…" : "Attach file"}
      </Button>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
