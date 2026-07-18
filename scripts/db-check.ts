/**
 * Section 17.1/M8 hardening — a connectivity/replica-set health check,
 * meant to be run after provisioning a new MONGODB_URI (local Docker or
 * Atlas) before trusting the app against it: confirms the database is
 * reachable, is a genuine replica set (required for transactions —
 * Law 4/withDbTransaction), and reports each collection's document/index
 * counts as a quick sanity snapshot.
 *
 * Usage: `npx tsx scripts/db-check.ts`
 */
import { config as loadDotenv } from "dotenv";
loadDotenv({ path: ".env" });
loadDotenv({ path: ".env.local", override: true });

async function main() {
  const { db, nativeDb } = await import("@/database/connection");

  console.log("1) Connecting...");
  const connection = await db();
  console.log(`   ✓ connected to ${connection.connection.host}:${connection.connection.port}/${connection.connection.name}`);

  console.log("2) Pinging...");
  const pingResult = await Promise.race([
    connection.connection.db?.admin().ping(),
    new Promise((_resolve, reject) => setTimeout(() => reject(new Error("ping timeout after 5s")), 5000)),
  ]);
  if (!pingResult) throw new Error("No database handle to ping");
  console.log("   ✓ ping ok");

  console.log("3) Checking replica set status (required for Law 4 transactions)...");
  const { database } = await nativeDb();
  try {
    const status = (await database.admin().command({ replSetGetStatus: 1 })) as {
      set?: string;
      myState?: number;
      members?: Array<{ name: string; stateStr: string; health: number }>;
    };
    console.log(`   ✓ replica set "${status.set}" — state ${status.myState}`);
    for (const member of status.members ?? []) {
      console.log(`     - ${member.name}: ${member.stateStr} (health=${member.health})`);
    }
  } catch (error) {
    throw new Error(
      `Not running as a replica set — transactions (session.withTransaction, used by every money mutation) ` +
        `will fail. Original error: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  console.log("4) Collection snapshot (documents / indexes)...");
  const collections = await database.listCollections().toArray();
  for (const { name } of collections.sort((a, b) => a.name.localeCompare(b.name))) {
    const count = await database.collection(name).countDocuments();
    const indexes = await database.collection(name).indexes();
    console.log(`   ${name}: ${count} doc(s), ${indexes.length} index(es)`);
  }

  console.log("\nDB CHECK: PASS");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\nDB CHECK: FAIL");
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
