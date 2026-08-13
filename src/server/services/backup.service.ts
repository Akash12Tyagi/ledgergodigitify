import { createHash } from "node:crypto";

import { EJSON } from "bson";
import ExcelJS from "exceljs";

import { nativeDb } from "@/database/connection";
import {
  BACKUP_FORMAT_VERSION,
  LOSSLESS_COLUMN,
  MANIFEST_JSON_KEY,
  MANIFEST_SHEET,
  toBackupSheetName,
} from "@/constants/backup";

// Re-exported so callers that already have the service in hand do not need a
// second import; the definitions live in constants/backup.ts because the
// restore script must read them without pulling in config/env.
export {
  BACKUP_FORMAT_VERSION,
  LOSSLESS_COLUMN,
  MANIFEST_JSON_KEY,
  MANIFEST_SHEET,
  toBackupSheetName,
};

/**
 * RUNBOOK §7 — the entire database as one .xlsx, one sheet per collection,
 * downloadable from Settings and restorable with
 * `scripts/restore-from-xlsx.ts`.
 *
 * Why a spreadsheet and not just `mongodump`: a dump needs a paid tier, a
 * bucket, a scheduler and credentials to be worth anything. A file the
 * owner can download on a whim, keep on a pen drive and open in Excel needs
 * none of that, and "no backup at all" is the state this replaces.
 *
 * The honest trade-offs, so nobody mistakes this for continuous backup:
 * it is a point-in-time copy taken whenever someone clicks; it is only as
 * fresh as the last click; and it holds password hashes, so the file is a
 * SECRET — treat it exactly like the database itself.
 *
 * ## How a lossless round-trip survives a spreadsheet
 *
 * Every sheet carries two representations of each document. The named
 * columns are for human eyes — flattened, readable, and lossy on purpose.
 * The final `__json` column holds the document as CANONICAL Extended JSON,
 * which is what the restore actually reads. That is what keeps an ObjectId
 * an ObjectId, a Date a Date, and an int an int through a format that would
 * otherwise happily turn `6031...` into 6.031e+23.
 *
 * Every cell is written as text (`numFmt: "@"`) so that a human opening,
 * glancing at, and re-saving the file in Excel cannot silently retype the
 * data underneath it.
 */

/**
 * Rebuilt from scratch on any fresh install, and meaningless once moved:
 * sessions and verification tokens are tied to a secret that a restored
 * environment may not even share, and rate-limit counters are per-minute
 * buckets. Restoring them would at best be noise and at worst hand out live
 * sessions from a file sitting on a pen drive.
 */
export const EPHEMERAL_COLLECTIONS = new Set(["sessions", "verifications", "rate_limits"]);

/**
 * Everything a restore genuinely needs. `users` and `authAccounts` are in
 * here deliberately: without the credential rows nobody can log in to the
 * restored system, which would make it a museum piece rather than a
 * recovery. That is also precisely why the file is sensitive.
 */
export const KNOWN_COLLECTIONS = [
  "settings",
  "users",
  "authAccounts",
  "accounts",
  "clients",
  "monthlybillings",
  "payments",
  "expenses",
  "expensetemplates",
  "credits",
  "borrowings",
  "borrowrepayments",
  "transactions",
  "notifications",
  "auditlogs",
] as const;

export type BackupCollectionEntry = {
  collection: string;
  documents: number;
  /** SHA-256 over the `__json` lines, in `_id` order. The restore recomputes
   * it and refuses a file that does not match. */
  sha256: string;
  /** True for a collection this build did not know about. Included anyway —
   * a backup that silently skips data is worse than one that surprises you. */
  unexpected: boolean;
};

export type BackupManifest = {
  formatVersion: number;
  exportedAt: string;
  database: string;
  collections: BackupCollectionEntry[];
  totalDocuments: number;
};

export type BackupResult = {
  buffer: Buffer;
  manifest: BackupManifest;
  filename: string;
};

/** Readable rendering for the human columns. Never read back on restore, so
 * it can be as lossy as it likes in exchange for being legible. */
function toCellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const bson = value as { _bsontype?: string; toHexString?: () => string };
    if (bson._bsontype === "ObjectId" && typeof bson.toHexString === "function") {
      return bson.toHexString();
    }
    if (bson._bsontype) return String(value);
    // Arrays and subdocuments (attachments, engine snapshots) — relaxed EJSON
    // reads far better than canonical here, and `__json` carries the exact
    // form regardless.
    return EJSON.stringify(value, { relaxed: true });
  }
  return String(value);
}

/**
 * Column order, stable across exports so two backups of unchanged data
 * produce comparable files: `_id` first, then every other key in the order
 * documents first present it, then `__json` last.
 */
function collectColumns(documents: Record<string, unknown>[]): string[] {
  const seen = new Set<string>(["_id"]);
  for (const doc of documents) {
    for (const key of Object.keys(doc)) seen.add(key);
  }
  return [...seen, LOSSLESS_COLUMN];
}

async function writeCollectionSheet(
  workbook: ExcelJS.Workbook,
  collection: string,
  documents: Record<string, unknown>[],
  unexpected: boolean
): Promise<BackupCollectionEntry> {
  const sheet = workbook.addWorksheet(toBackupSheetName(collection));
  const columns = collectColumns(documents);

  sheet.columns = columns.map((key) => ({
    header: key,
    key,
    width: key === LOSSLESS_COLUMN ? 80 : Math.min(Math.max(key.length + 4, 12), 40),
    style: { numFmt: "@" },
  }));
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  const hash = createHash("sha256");
  for (const doc of documents) {
    const json = EJSON.stringify(doc, { relaxed: false });
    hash.update(`${json}\n`);

    const row: Record<string, string> = { [LOSSLESS_COLUMN]: json };
    for (const key of columns) {
      if (key === LOSSLESS_COLUMN) continue;
      row[key] = toCellText(doc[key]);
    }
    sheet.addRow(row);
  }

  return { collection, documents: documents.length, sha256: hash.digest("hex"), unexpected };
}

/** Fills the (already-created, already-first) manifest sheet once every
 * collection has been counted and checksummed. */
function writeManifestSheet(sheet: ExcelJS.Worksheet, manifest: BackupManifest): void {
  sheet.columns = [
    { key: "a", width: 22, style: { numFmt: "@" } },
    { key: "b", width: 70, style: { numFmt: "@" } },
    { key: "c", width: 68, style: { numFmt: "@" } },
    { key: "d", width: 12, style: { numFmt: "@" } },
  ];

  // Row 1 is the machine-readable manifest; the restore reads B1 and never
  // has to parse the presentation below.
  sheet.addRow({ a: MANIFEST_JSON_KEY, b: JSON.stringify(manifest) });
  sheet.addRow({});
  sheet.addRow({ a: "Finance & Ledger — full database backup" }).font = { bold: true, size: 14 };
  sheet.addRow({ a: "formatVersion", b: String(manifest.formatVersion) });
  sheet.addRow({ a: "exportedAt", b: manifest.exportedAt });
  sheet.addRow({ a: "database", b: manifest.database });
  sheet.addRow({ a: "totalDocuments", b: String(manifest.totalDocuments) });
  sheet.addRow({});
  sheet.addRow({
    a: "Restore with:",
    b: "npm run restore-from-xlsx -- --file <this file> --uri <target mongodb uri>",
  });
  sheet.addRow({
    a: "WARNING",
    b: "Contains password hashes and every financial record. Treat this file exactly like the database.",
  }).font = { bold: true };
  sheet.addRow({});

  const header = sheet.addRow({ a: "collection", b: "documents", c: "sha256", d: "note" });
  header.font = { bold: true };
  for (const entry of manifest.collections) {
    sheet.addRow({
      a: entry.collection,
      b: String(entry.documents),
      c: entry.sha256,
      d: entry.unexpected ? "unexpected" : "",
    });
  }
}

/**
 * Reads every non-ephemeral collection and returns the workbook bytes.
 *
 * Documents are read in `_id` order so two exports of unchanged data agree
 * byte-for-byte in the `__json` column, which is what makes the per-
 * collection checksum meaningful as a "did this file change" signal.
 */
export async function exportBackupXlsx(): Promise<BackupResult> {
  const { database } = await nativeDb();

  const existing = await database.listCollections().toArray();
  const present = existing.map((c) => c.name).filter((name) => !EPHEMERAL_COLLECTIONS.has(name));

  // Known collections first, in dependency-ish order, then anything this
  // build has never heard of — a collection added by a later version still
  // ends up in the backup instead of being quietly dropped.
  const known = KNOWN_COLLECTIONS.filter((name) => present.includes(name));
  const unexpected = present.filter((name) => !KNOWN_COLLECTIONS.includes(name as never)).sort();

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Finance & Ledger";
  workbook.created = new Date();

  // Created before the data sheets so it lands first in the tab bar — the
  // file should open on the summary, not on whichever collection happened
  // to be written first. Its rows are filled in once the checksums exist.
  const manifestSheet = workbook.addWorksheet(MANIFEST_SHEET, {
    properties: { tabColor: { argb: "FF1F6FEB" } },
  });

  const entries: BackupCollectionEntry[] = [];
  for (const name of [...known, ...unexpected]) {
    const documents = (await database
      .collection(name)
      .find({})
      .sort({ _id: 1 })
      .toArray()) as unknown as Record<string, unknown>[];
    entries.push(await writeCollectionSheet(workbook, name, documents, unexpected.includes(name)));
  }

  const manifest: BackupManifest = {
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    database: database.databaseName,
    collections: entries,
    totalDocuments: entries.reduce((sum, e) => sum + e.documents, 0),
  };

  writeManifestSheet(manifestSheet, manifest);

  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

  return { buffer, manifest, filename: backupFilename(manifest.exportedAt) };
}

/** `ledger-backup-2026-08-13-2034.xlsx`, in IST — the timezone every date in
 * this app means, so two files sort the way the owner expects. */
export function backupFilename(exportedAtISO: string): string {
  const ist = new Date(new Date(exportedAtISO).getTime() + 5.5 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp =
    `${ist.getUTCFullYear()}-${pad(ist.getUTCMonth() + 1)}-${pad(ist.getUTCDate())}` +
    `-${pad(ist.getUTCHours())}${pad(ist.getUTCMinutes())}`;
  return `ledger-backup-${stamp}.xlsx`;
}
