import { AppError } from "@/lib/errors";

/**
 * Section 6 preamble / 14 edge case 5 — every mutating service wraps its
 * DB-transaction body with this. On first call, `run()` executes normally.
 * On a retried call with the same idempotencyKey (double-click, network
 * retry), the unique index on the entity's `idempotencyKey` field makes
 * the insert fail with Mongo error 11000; this catches specifically that,
 * fetches the original result via `fetchExisting`, and throws an
 * IDEMPOTENT_REPLAY AppError carrying it — `runAction` (lib/result.ts)
 * turns that into the `error.code: "IDEMPOTENT_REPLAY"` envelope Section
 * 8.1 defines, which the client treats as success using `error.data`.
 *
 * Because the insert that trips E11000 happens INSIDE `session.
 * withTransaction`, the whole attempt rolls back on conflict — no partial
 * writes (Law 3/4) — before this ever fetches the pre-existing document.
 */
export async function runWithIdempotency<T>(params: {
  run: () => Promise<T>;
  fetchExisting: () => Promise<T | null>;
}): Promise<T> {
  try {
    return await params.run();
  } catch (error) {
    if (!isDuplicateKeyError(error, "idempotencyKey")) throw error;

    const existing = await params.fetchExisting();
    if (!existing) throw error; // genuinely unexpected — surface the real error

    throw new AppError("IDEMPOTENT_REPLAY", "This action was already completed.", {
      data: existing,
    });
  }
}

/** Shared with payments.service.ts for the invoiceNumber/receiptNumber
 * unique-index race-condition safety net (the common case is caught by an
 * explicit pre-check; this is the rare-concurrent-submit fallback). */
export function isDuplicateKeyError(error: unknown, field: string): boolean {
  if (typeof error !== "object" || error === null) return false;
  const err = error as { code?: unknown; keyPattern?: unknown; message?: unknown };
  const isDuplicateKey = err.code === 11000;
  if (!isDuplicateKey) return false;
  const keyPattern = JSON.stringify(err.keyPattern ?? {});
  const message = String(err.message ?? "");
  return keyPattern.includes(field) || message.includes(field);
}
