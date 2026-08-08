/**
 * Wipes application data from the configured database.
 *
 * SAFETY MODEL — this deletes financial records, so nothing is destroyed by
 * accident:
 *
 *   - With no flags it only REPORTS: target host, database name, and a
 *     per-collection document count. Nothing is written.
 *   - `--yes` is required to actually delete, and the target database name
 *     must also be passed as `--db=<name>` so a wrong MONGODB_URI (a
 *     production cluster, a colleague's Atlas) cannot be wiped by a command
 *     copied from chat.
 *   - `--keep-access` preserves users, sessions, accounts(auth) and settings,
 *     so you stay logged in and keep your configuration. Without it you must
 *     re-run `npm run bootstrap-owner` before you can sign in again.
 *
 * Usage:
 *   npx tsx scripts/reset-db.ts                          # report only
 *   npx tsx scripts/reset-db.ts --yes --db=finance       # wipe everything
 *   npx tsx scripts/reset-db.ts --yes --db=finance --keep-access
 */
import { config as loadDotenv } from "dotenv";
loadDotenv({ path: ".env" });
loadDotenv({ path: ".env.local", override: true });

const args = process.argv.slice(2);
const CONFIRMED = args.includes("--yes");
const KEEP_ACCESS = args.includes("--keep-access");
const DB_ARG = args.find((a) => a.startsWith("--db="))?.slice("--db=".length);

/**
 * Collections holding who can log in and how the app is configured — kept
 * under --keep-access so a reset doesn't also lock you out.
 *
 * NOTE the naming trap: better-auth's credential store is `authAccounts`
 * (server/auth/auth.ts remaps it), while plain `accounts` is this app's BANK
 * accounts — business data. Getting those two the wrong way round would
 * either preserve the test bank account or delete everyone's login.
 */
const ACCESS_COLLECTIONS = new Set([
  "users",
  "sessions",
  "authAccounts",
  "verifications",
  "settings",
  "rate_limits",
]);

/** Business data. Everything else in the database is left alone unless it
 * matches one of these — an unexpected collection is reported, never
 * silently dropped. */
const DATA_COLLECTIONS = new Set([
  "accounts", // bank/cash accounts, NOT auth
  "clients",
  "monthlybillings",
  "payments",
  "transactions",
  "expenses",
  "credits",
  "notifications",
  "auditlogs",
  "counters", // legacy invoice/receipt counters, no longer written
]);

async function main() {
  const { db } = await import("@/database/connection");
  const conn = await db();
  const native = conn.connection.db;
  if (!native) throw new Error("No database handle");

  const dbName = conn.connection.name;
  const host = conn.connection.host ?? "(srv)";

  console.log(`\nTarget database : ${dbName}`);
  console.log(`Target host     : ${host}`);
  console.log(`Mode            : ${CONFIRMED ? "DELETE" : "REPORT ONLY (pass --yes to delete)"}`);
  console.log(`Access data     : ${KEEP_ACCESS ? "KEPT" : "DELETED — re-run bootstrap-owner after"}\n`);

  const collections = (await native.listCollections().toArray())
    .map((c) => c.name)
    .sort((a, b) => a.localeCompare(b));

  const planned: Array<{ collection: string; docs: number; action: string }> = [];
  for (const name of collections) {
    const docs = await native.collection(name).countDocuments();
    let action: string;
    if (DATA_COLLECTIONS.has(name)) action = "delete";
    else if (ACCESS_COLLECTIONS.has(name)) action = KEEP_ACCESS ? "keep" : "delete";
    else action = "skip (unrecognised)";
    planned.push({ collection: name, docs, action });
  }

  console.table(planned);

  const toDelete = planned.filter((p) => p.action === "delete");
  const totalDocs = toDelete.reduce((sum, p) => sum + p.docs, 0);

  if (!CONFIRMED) {
    console.log(
      `\nNothing was changed. This would delete ${totalDocs} document(s) across ${toDelete.length} collection(s).`
    );
    console.log(`To proceed:  npx tsx scripts/reset-db.ts --yes --db=${dbName}${KEEP_ACCESS ? " --keep-access" : ""}\n`);
    process.exit(0);
  }

  // Name confirmation: guards against a MONGODB_URI pointing somewhere other
  // than the operator thinks it does.
  if (DB_ARG !== dbName) {
    console.error(
      `\nRefusing to delete. --db=${DB_ARG ?? "(missing)"} does not match the connected database "${dbName}".`
    );
    console.error(`If "${dbName}" really is the one you mean, pass --db=${dbName}.\n`);
    process.exit(1);
  }

  for (const entry of toDelete) {
    const result = await native.collection(entry.collection).deleteMany({});
    console.log(`  cleared ${entry.collection}: ${result.deletedCount} document(s)`);
  }

  console.log(`\nDone. ${totalDocs} document(s) removed from "${dbName}".`);
  if (!KEEP_ACCESS) {
    console.log("Users were removed — run `npm run bootstrap-owner` before signing in again.\n");
  }
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
