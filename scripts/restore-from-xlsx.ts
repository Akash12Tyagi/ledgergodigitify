/**
 * RUNBOOK §7 — restores a full-backup .xlsx (Settings → Download full
 * backup) into a database.
 *
 * Usage:
 *   npm run restore-from-xlsx -- --file <backup.xlsx> --uri <target mongodb uri>
 *   npm run restore-from-xlsx -- --file <backup.xlsx> --verify-only
 *
 * Flags:
 *   --file        the .xlsx to restore. Required.
 *   --uri         TARGET database. Required unless --verify-only. Passed
 *                 explicitly and never defaulted from .env, because the one
 *                 unrecoverable mistake this tool can make is restoring over
 *                 a live database that somebody meant to keep.
 *   --verify-only reads and checksums the file, touches no database. This is
 *                 the restore DRILL — run it on every backup you keep.
 *   --force       allow writing into a target that already holds documents.
 *                 Existing collections are DROPPED first.
 *
 * What it guarantees, in order, refusing to continue at the first failure:
 *   1. the file's format version is one this build understands
 *   2. every sheet's SHA-256 matches the manifest (no silent corruption, no
 *      "someone opened it in Excel and re-saved it" damage)
 *   3. the target is empty, or --force was passed deliberately
 *   4. indexes are rebuilt — including the unique idempotencyKey ones that
 *      are the only thing standing between this system and duplicate money
 *   5. reconciliation passes: every account's derived balance equals its
 *      stored balance. A restore that leaves drift is not a restore.
 */
import { config as loadDotenv } from "dotenv";
loadDotenv({ path: ".env" });
loadDotenv({ path: ".env.local", override: true });

import { createHash } from "node:crypto";

import { EJSON } from "bson";
import ExcelJS from "exceljs";

// Safe to import eagerly: constants/backup.ts has no imports of its own, so
// this does NOT drag in config/env and snapshot `MONGODB_URI` before --uri
// has been applied. See the comment at the top of that file.
import {
  BACKUP_FORMAT_VERSION,
  LOSSLESS_COLUMN,
  MANIFEST_JSON_KEY,
  MANIFEST_SHEET,
  toBackupSheetName,
} from "@/constants/backup";

type Args = {
  file: string;
  uri?: string;
  verifyOnly: boolean;
  force: boolean;
};

function parseArgs(argv: string[]): Args {
  const get = (name: string): string | undefined => {
    const index = argv.indexOf(`--${name}`);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const file = get("file");
  if (!file) throw new Error("--file <backup.xlsx> is required");

  const verifyOnly = argv.includes("--verify-only");
  const uri = get("uri");
  if (!verifyOnly && !uri) {
    throw new Error(
      "--uri <target mongodb uri> is required.\n" +
        "It is never taken from .env on purpose: restoring over a live database is the one\n" +
        "mistake this tool cannot undo. Pass the target explicitly, or use --verify-only."
    );
  }

  return { file, ...(uri ? { uri } : {}), verifyOnly, force: argv.includes("--force") };
}

type ManifestEntry = {
  collection: string;
  documents: number;
  sha256: string;
  unexpected: boolean;
};

type Manifest = {
  formatVersion: number;
  exportedAt: string;
  database: string;
  collections: ManifestEntry[];
  totalDocuments: number;
};

/**
 * The database name a URI points at — used to prove, after connecting, that
 * we really are talking to the target that was passed in. An emptiness check
 * alone would not catch a connection that silently resolved somewhere else.
 */
function databaseNameOf(uri: string): string | null {
  const withoutQuery = uri.split("?")[0] ?? "";
  const afterHost = withoutQuery.replace(/^mongodb(\+srv)?:\/\/[^/]+\/?/, "");
  return afterHost.length > 0 ? decodeURIComponent(afterHost) : null;
}

async function readBackup(file: string) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file);

  const manifestSheet = workbook.getWorksheet(MANIFEST_SHEET);
  if (!manifestSheet) throw new Error(`Not a backup file: no "${MANIFEST_SHEET}" sheet`);

  const keyCell = manifestSheet.getCell("A1").text;
  if (keyCell !== MANIFEST_JSON_KEY) {
    throw new Error(`Not a backup file: cell A1 of "${MANIFEST_SHEET}" is "${keyCell}"`);
  }
  const manifest = JSON.parse(manifestSheet.getCell("B1").text) as Manifest;

  const documentsByCollection = new Map<string, Record<string, unknown>[]>();

  for (const entry of manifest.collections) {
    const sheet = workbook.getWorksheet(toBackupSheetName(entry.collection));
    if (!sheet) throw new Error(`Manifest lists "${entry.collection}" but the sheet is missing`);

    const header = sheet.getRow(1);
    let jsonColumn = -1;
    header.eachCell((cell, colNumber) => {
      if (cell.text === LOSSLESS_COLUMN) jsonColumn = colNumber;
    });
    if (jsonColumn < 0) {
      throw new Error(`Sheet "${entry.collection}" has no ${LOSSLESS_COLUMN} column — cannot restore from it`);
    }

    const hash = createHash("sha256");
    const documents: Record<string, unknown>[] = [];
    for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
      const json = sheet.getRow(rowNumber).getCell(jsonColumn).text;
      if (!json) continue;
      hash.update(`${json}\n`);
      documents.push(EJSON.parse(json, { relaxed: false }) as Record<string, unknown>);
    }

    const sha256 = hash.digest("hex");
    if (documents.length !== entry.documents) {
      throw new Error(
        `"${entry.collection}": manifest says ${entry.documents} document(s), sheet holds ${documents.length}`
      );
    }
    if (sha256 !== entry.sha256) {
      throw new Error(
        `"${entry.collection}": checksum mismatch — the file has been modified or is corrupt.\n` +
          `  expected ${entry.sha256}\n  actual   ${sha256}`
      );
    }

    documentsByCollection.set(entry.collection, documents);
  }

  return { manifest, documentsByCollection };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // FIRST, before any `@/database` or `@/server` import: config/env.ts
  // validates and freezes MONGODB_URI the moment it is imported, so setting
  // this later would leave every downstream module pointed at whatever
  // `.env` happened to say. A round-trip drill caught exactly that, with
  // the target resolving to production.
  if (args.uri) process.env.MONGODB_URI = args.uri;

  console.log(`1) Reading ${args.file}...`);
  const { manifest, documentsByCollection } = await readBackup(args.file);

  if (manifest.formatVersion !== BACKUP_FORMAT_VERSION) {
    throw new Error(
      `Backup format version ${manifest.formatVersion}, but this build understands ${BACKUP_FORMAT_VERSION}. ` +
        `Restore with the app version that produced it.`
    );
  }

  console.log(`   ✓ format v${manifest.formatVersion}, taken ${manifest.exportedAt} from "${manifest.database}"`);
  console.log(`   ✓ all ${manifest.collections.length} sheet checksums match`);
  for (const entry of manifest.collections) {
    console.log(`     - ${entry.collection}: ${entry.documents} doc(s)${entry.unexpected ? " (unexpected)" : ""}`);
  }
  console.log(`   ✓ ${manifest.totalDocuments} document(s) total, parsed without loss`);

  if (args.verifyOnly) {
    console.log("\nVERIFY ONLY — no database was touched.");
    console.log("RESTORE DRILL: PASS");
    return;
  }

  const { nativeDb } = await import("@/database/connection");
  const { database } = await nativeDb();
  console.log(`\n2) Target database: "${database.databaseName}"`);

  // Belt and braces on top of setting the env var early: prove the
  // connection actually landed where --uri asked. Without this, any future
  // import-order slip would be caught only by the emptiness check below —
  // which passes silently against an empty production database.
  const expectedDatabase = databaseNameOf(args.uri!);
  if (expectedDatabase && database.databaseName !== expectedDatabase) {
    throw new Error(
      `Refusing to continue: --uri names database "${expectedDatabase}" but the connection ` +
        `resolved to "${database.databaseName}". Nothing was written.`
    );
  }

  const existing = await database.listCollections().toArray();
  const collidingCounts: Array<{ name: string; count: number }> = [];
  for (const entry of manifest.collections) {
    if (!existing.some((c) => c.name === entry.collection)) continue;
    const count = await database.collection(entry.collection).countDocuments();
    if (count > 0) collidingCounts.push({ name: entry.collection, count });
  }

  if (collidingCounts.length > 0 && !args.force) {
    const detail = collidingCounts.map((c) => `${c.name} (${c.count})`).join(", ");
    throw new Error(
      `Target already holds documents: ${detail}.\n` +
        `Restore into an EMPTY database, or pass --force to DROP these collections and replace them.`
    );
  }

  console.log("3) Writing collections...");
  for (const entry of manifest.collections) {
    const documents = documentsByCollection.get(entry.collection) ?? [];
    if (collidingCounts.some((c) => c.name === entry.collection)) {
      await database.collection(entry.collection).drop();
    }
    if (documents.length === 0) {
      console.log(`   - ${entry.collection}: empty`);
      continue;
    }
    // ordered:false so one bad document surfaces every other failure in the
    // same pass rather than one per re-run.
    const result = await database.collection(entry.collection).insertMany(documents, { ordered: false });
    console.log(`   ✓ ${entry.collection}: ${result.insertedCount} doc(s)`);
  }

  console.log("4) Rebuilding indexes (Mongoose syncIndexes — includes the unique idempotencyKey ones)...");
  const mongoose = (await import("mongoose")).default;
  // Imported for their side effect: each module calls registerModel, which
  // is what puts the schema (and therefore its indexes) into
  // `mongoose.models`. There is no barrel to import instead — models are
  // pulled in per-repository throughout the app, so this is the one place
  // that needs the full set at once.
  await Promise.all([
    import("@/database/models/account.model"),
    import("@/database/models/audit-log.model"),
    import("@/database/models/borrow-repayment.model"),
    import("@/database/models/borrowing.model"),
    import("@/database/models/client.model"),
    import("@/database/models/credit.model"),
    import("@/database/models/expense-template.model"),
    import("@/database/models/expense.model"),
    import("@/database/models/monthly-billing.model"),
    import("@/database/models/notification.model"),
    import("@/database/models/payment.model"),
    import("@/database/models/rate-limit.model"),
    import("@/database/models/settings.model"),
    import("@/database/models/transaction.model"),
    import("@/database/models/user.model"),
  ]);
  for (const name of Object.keys(mongoose.models)) {
    const model = mongoose.models[name];
    if (!model) continue;
    await model.syncIndexes();
    console.log(`   ✓ ${model.collection.collectionName}`);
  }

  console.log("5) Reconciling — derived balance vs stored balance, per account...");
  const { reconcileAll } = await import("@/server/services/financial-engine");
  const report = await reconcileAll();
  for (const account of report.accounts) {
    const status = account.driftPaise === 0 ? "✓" : "✗";
    console.log(`   ${status} ${account.name}: drift ${account.driftPaise} paise`);
  }
  if (report.hasDrift) {
    throw new Error(
      "Reconciliation found drift after restore. The data is NOT trustworthy — do not go live on it."
    );
  }

  console.log("\nRESTORE: PASS — every account reconciles.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\nRESTORE: FAIL");
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
