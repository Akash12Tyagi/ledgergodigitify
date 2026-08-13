/**
 * Backup FILE FORMAT constants, deliberately in a module with no imports.
 *
 * `scripts/restore-from-xlsx.ts` needs these before it has decided which
 * database to talk to. Reaching into backup.service.ts for them pulls in
 * database/connection → config/env, which snapshots `MONGODB_URI` at import
 * time — so the restore would silently connect to whatever is in `.env`
 * instead of the `--uri` it was handed. That exact bug was caught by a
 * round-trip drill pointing at production; keeping the constants importable
 * without touching config is what makes it unrepeatable.
 */

/** Bumped whenever the sheet layout changes in a way a restore must know
 * about. `restore-from-xlsx.ts` refuses a version it was not written for,
 * rather than guessing at an older shape. */
export const BACKUP_FORMAT_VERSION = 1;

/** Holds canonical Extended JSON of the whole document — the source of
 * truth on restore. The readable columns beside it are decoration. */
export const LOSSLESS_COLUMN = "__json";

export const MANIFEST_SHEET = "_manifest";

/** Cell A1/B1 of the manifest sheet: the machine-readable manifest, so the
 * restore never has to parse the human-readable table below it. */
export const MANIFEST_JSON_KEY = "__manifest_json";

/** Excel rejects these in a sheet name, and caps the name at 31 chars. Our
 * own collections are all safely short; this exists so an unexpected one
 * cannot break the whole export — and so the restore finds sheets by
 * exactly the rule that wrote them. */
export function toBackupSheetName(collection: string): string {
  return collection.replace(/[[\]:*?/\\]/g, "_").slice(0, 31);
}
