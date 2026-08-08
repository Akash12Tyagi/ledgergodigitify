import { Schema, type InferSchemaType } from "mongoose";
import { registerModel } from "@/database/models/register-model";

// Section 10.2 — Mongo-backed sliding-window rate limiter storage.
// TTL index auto-expires entries after 1 hour regardless of window length.
const rateLimitSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    windowStart: { type: Date, required: true },
    count: { type: Number, required: true, default: 0 },
  },
  { collection: "rate_limits" }
);

rateLimitSchema.index({ windowStart: 1 }, { expireAfterSeconds: 60 * 60 });

export type RateLimitDoc = InferSchemaType<typeof rateLimitSchema>;

export const RateLimitModel = registerModel<RateLimitDoc>("RateLimit", rateLimitSchema);
