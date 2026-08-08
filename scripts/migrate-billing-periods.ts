/**
 * One-time migration: move MonthlyBilling from calendar-month identity to
 * explicit billing PERIODS.
 *
 * What changes
 * ------------
 * 1. Every existing row gets `periodStart`/`periodEnd` backfilled from its
 *    `monthKey` — the calendar month is exactly what those rows meant when
 *    they were written, so this is a faithful restatement, not a guess.
 * 2. The old `{clientId, monthKey}` unique index is dropped and replaced by
 *    `{clientId, periodStart}`. Mongoose creates new indexes on connect but
 *    never removes retired ones, so without this step the old constraint
 *    would keep rejecting legitimate second dues in the same reporting month
 *    (a 20th-to-20th cycle, or a one-off charge alongside a retainer).
 *
 * What deliberately does NOT change
 * ---------------------------------
 * Rows carrying a non-zero `carriedInPaise`/`carriedOutPaise` from the old
 * carry-forward behaviour are left exactly as they are. Those amounts were
 * really moved between months at the time, and `deriveBillingStatus` still
 * accounts for them, so historical totals stay correct. Rewriting them to
 * match the new "each period stands alone" rule would restate closed books —
 * the one thing a ledger must never do silently.
 *
 * Safe to run more than once: rows that already have a period are skipped,
 * and index changes are checked before being applied.
 *
 * Usage: `npx tsx scripts/migrate-billing-periods.ts`
 *        `npx tsx scripts/migrate-billing-periods.ts --dry-run`
 */
import { config as loadDotenv } from "dotenv";
loadDotenv({ path: ".env" });
loadDotenv({ path: ".env.local", override: true });

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  const { db } = await import("@/database/connection");
  const { MonthlyBillingModel } = await import("@/database/models/monthly-billing.model");
  const { monthKeyToRange } = await import("@/lib/dates");

  await db();
  const collection = MonthlyBillingModel.collection;

  console.log(DRY_RUN ? "DRY RUN — no writes will be made\n" : "Applying migration\n");

  // ── Step 1: backfill periods ──────────────────────────────────────────
  const missing = await collection
    .find({ $or: [{ periodStart: { $exists: false } }, { periodEnd: { $exists: false } }] })
    .toArray();

  console.log(`1) Rows needing a period backfill: ${missing.length}`);

  let backfilled = 0;
  let unfixable = 0;

  for (const row of missing) {
    const monthKey = typeof row.monthKey === "string" ? row.monthKey : null;
    if (!monthKey || !/^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey)) {
      console.warn(`   ! ${String(row._id)} has no usable monthKey ("${String(row.monthKey)}") — skipped`);
      unfixable += 1;
      continue;
    }

    const { startUTC, endUTC } = monthKeyToRange(monthKey);
    if (!DRY_RUN) {
      await collection.updateOne(
        { _id: row._id },
        { $set: { periodStart: startUTC, periodEnd: endUTC } }
      );
    }
    backfilled += 1;
  }

  console.log(`   ✓ ${backfilled} row(s) ${DRY_RUN ? "would be" : ""} backfilled`);
  if (unfixable > 0) {
    console.warn(`   ! ${unfixable} row(s) could not be backfilled — inspect these by hand before relying on the rollover.`);
  }

  // ── Step 2: swap the uniqueness constraint ────────────────────────────
  const indexes = await collection.indexes();
  const byName = new Map(indexes.map((i) => [i.name, i]));

  const legacy = indexes.find(
    (i) => JSON.stringify(i.key) === JSON.stringify({ clientId: 1, monthKey: 1 }) && i.unique
  );

  console.log(`\n2) Index changes`);

  if (legacy?.name) {
    console.log(`   - dropping legacy unique index ${legacy.name} {clientId, monthKey}`);
    if (!DRY_RUN) await collection.dropIndex(legacy.name);
  } else {
    console.log("   - legacy unique index {clientId, monthKey} not present (already migrated)");
  }

  const hasNew = [...byName.values()].some(
    (i) => JSON.stringify(i.key) === JSON.stringify({ clientId: 1, periodStart: 1 }) && i.unique
  );

  if (hasNew) {
    console.log("   - unique index {clientId, periodStart} already present");
  } else {
    console.log("   + creating unique index {clientId, periodStart}");
    if (!DRY_RUN) {
      // Fails loudly if two rows share a period — which would mean a client
      // was genuinely billed twice for the same window and needs a human
      // decision, not an automatic merge.
      await collection.createIndex({ clientId: 1, periodStart: 1 }, { unique: true });
    }
  }

  // ── Step 3: report ────────────────────────────────────────────────────
  const total = await collection.countDocuments();
  const stillMissing = await collection.countDocuments({
    $or: [{ periodStart: { $exists: false } }, { periodEnd: { $exists: false } }],
  });
  const withLegacyCarry = await collection.countDocuments({
    $or: [{ carriedInPaise: { $gt: 0 } }, { carriedOutPaise: { $gt: 0 } }],
  });

  console.log(`\n3) Result`);
  console.log(`   total billings:        ${total}`);
  console.log(`   without a period:      ${stillMissing}${DRY_RUN ? " (dry run — nothing written)" : ""}`);
  console.log(`   with legacy carry:     ${withLegacyCarry} (left untouched by design)`);

  process.exit(stillMissing > 0 && !DRY_RUN ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
