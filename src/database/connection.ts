import mongoose from "mongoose";
import type { Db, MongoClient } from "mongodb";

import { env } from "@/config/env";

// Section 3.1 — exact singleton pattern. Caches the connection promise on
// globalThis so dev hot-reload doesn't open a new connection per edit, and
// so a cold Vercel function reuses the promise across warm invocations.
// Every service calls `await db()` first; there is no second connect path.
type MongooseCache = {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
};

declare global {
  var __mongoose: MongooseCache | undefined;
}

const cached: MongooseCache = (globalThis.__mongoose ??= { conn: null, promise: null });

export async function db(): Promise<typeof mongoose> {
  if (cached.conn) return cached.conn;
  cached.promise ??= mongoose.connect(env.MONGODB_URI, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000,
  });
  cached.conn = await cached.promise;
  return cached.conn;
}

/** Native `mongodb` driver handles, for Better Auth's adapter (Section 2.1 —
 * Mongoose for domain data, Better Auth's own adapter for auth collections,
 * same underlying connection/database, no second connection opened). */
export async function nativeDb(): Promise<{ client: MongoClient; database: Db }> {
  const connection = await db();
  const client = connection.connection.getClient() as unknown as MongoClient;
  const database = connection.connection.db as unknown as Db;
  return { client, database };
}
