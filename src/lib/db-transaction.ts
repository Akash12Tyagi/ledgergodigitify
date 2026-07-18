import mongoose, { type ClientSession } from "mongoose";

import { db } from "@/database/connection";

/**
 * Law 4 — every multi-document mutation runs inside
 * `session.withTransaction`. This is the one place that pattern is
 * implemented, so every service composes it the same way instead of
 * hand-rolling session start/commit/end (and forgetting `endSession` in
 * some path).
 */
export async function withDbTransaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
  await db();
  const session = await mongoose.startSession();
  try {
    let result: T | undefined;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result as T;
  } finally {
    await session.endSession();
  }
}
