import mongoose, { type Schema } from "mongoose";

/**
 * Registers a Mongoose model, refreshing it on hot reload in development.
 *
 * `mongoose.models` lives on the mongoose singleton, which survives Next's
 * HMR module reloads. The usual `mongoose.models.X ?? mongoose.model(...)`
 * guard therefore pins the FIRST schema ever compiled under a name for the
 * life of the dev process: editing an enum, an index or a field and saving
 * leaves the server validating against the old shape, with no hint that
 * anything is stale. That surfaced as
 *
 *   "`DUE_CREATED` is not a valid enum value for path `action`"
 *
 * for a value plainly present in constants/audit-actions.ts — the file had
 * been edited, the compiled schema had not.
 *
 * Only `development` re-registers. Production starts a fresh process, and
 * tests deliberately keep the register-once behaviour: a test worker can
 * re-evaluate a model module while other modules still hold the previous
 * model object, and swapping it underneath them would be a worse problem
 * than the one this solves.
 */
/**
 * `mongoose.model` is called untyped and the result cast, rather than going
 * through `mongoose.model<TDoc>(...)`. Its generic overloads re-infer the
 * whole schema shape at every one of the dozen call sites, which was enough
 * to exhaust tsc's heap — the previous per-model `as mongoose.Model<XDoc>`
 * casts happened to avoid that, and this preserves the same short-circuit in
 * one place.
 */
export function registerModel<TDoc>(name: string, schema: Schema): mongoose.Model<TDoc> {
  const existing = mongoose.models[name] as mongoose.Model<TDoc> | undefined;

  if (existing) {
    if (process.env.NODE_ENV !== "development") return existing;
    mongoose.deleteModel(name);
  }

  return mongoose.model(name, schema) as unknown as mongoose.Model<TDoc>;
}
