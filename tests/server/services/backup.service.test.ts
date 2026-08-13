import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";

import { EJSON } from "bson";
import ExcelJS from "exceljs";
import { afterEach, describe, expect, it } from "vitest";

import {
  BACKUP_FORMAT_VERSION,
  EPHEMERAL_COLLECTIONS,
  LOSSLESS_COLUMN,
  MANIFEST_JSON_KEY,
  MANIFEST_SHEET,
  backupFilename,
  exportBackupXlsx,
} from "@/server/services/backup.service";
import { createCredit } from "@/server/services/credits.service";
import { nativeDb } from "@/database/connection";
import { seedAccount } from "../../helpers/seed-financial";
import { seedUser, clearAllCollections } from "../../helpers/seed-user";
import type { AuthedUser } from "@/server/auth/guards";

const PASSWORD = "Correct-Horse-Battery-Staple-9";

function actorFrom(user: { _id: unknown; name: string; email: string; role: string }): AuthedUser {
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role as AuthedUser["role"],
  };
}

/** Reads a workbook buffer back the way scripts/restore-from-xlsx.ts does. */
async function readBack(buffer: Buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

  const manifestSheet = workbook.getWorksheet(MANIFEST_SHEET)!;
  const manifest = JSON.parse(manifestSheet.getCell("B1").text) as {
    formatVersion: number;
    totalDocuments: number;
    collections: Array<{ collection: string; documents: number; sha256: string }>;
  };

  const byCollection = new Map<string, Record<string, unknown>[]>();
  const checksums = new Map<string, string>();

  for (const entry of manifest.collections) {
    const sheet = workbook.getWorksheet(entry.collection)!;
    let jsonColumn = -1;
    sheet.getRow(1).eachCell((cell, colNumber) => {
      if (cell.text === LOSSLESS_COLUMN) jsonColumn = colNumber;
    });

    const hash = createHash("sha256");
    const documents: Record<string, unknown>[] = [];
    for (let row = 2; row <= sheet.rowCount; row++) {
      const json = sheet.getRow(row).getCell(jsonColumn).text;
      if (!json) continue;
      hash.update(`${json}\n`);
      documents.push(EJSON.parse(json, { relaxed: false }) as Record<string, unknown>);
    }
    byCollection.set(entry.collection, documents);
    checksums.set(entry.collection, hash.digest("hex"));
  }

  return { workbook, manifest, byCollection, checksums, manifestSheet };
}

async function seedOneOfEverything() {
  const owner = await seedUser({
    name: "Owner",
    email: `backup-${randomUUID()}@example.com`,
    password: PASSWORD,
    role: "owner",
  });
  const account = await seedAccount({ openingBalancePaise: 0, currentBalancePaise: 0 });
  await createCredit(
    {
      amountPaise: 19_000_00,
      source: "Previous payment",
      reason: "Backdated settlement",
      category: "other",
      accountId: account._id.toString(),
      receivedAt: new Date("2026-04-22T18:30:00.000Z"),
      idempotencyKey: randomUUID(),
    },
    actorFrom(owner)
  );
  return { owner, account };
}

describe("backup.service — full-database export", () => {
  afterEach(async () => {
    await clearAllCollections();
  });

  it("round-trips every document losslessly, types included", async () => {
    const { account } = await seedOneOfEverything();

    const { buffer } = await exportBackupXlsx();
    const { byCollection } = await readBack(buffer);

    const credits = byCollection.get("credits")!;
    expect(credits).toHaveLength(1);

    const credit = credits[0]!;
    // The whole point of the __json column: a spreadsheet would otherwise
    // hand these back as strings (or worse, as scientific notation).
    expect(credit._id).toBeInstanceOf(Object);
    expect(String(credit._id)).toMatch(/^[a-f0-9]{24}$/);
    expect(credit.receivedAt).toBeInstanceOf(Date);
    expect((credit.receivedAt as Date).toISOString()).toBe("2026-04-22T18:30:00.000Z");
    expect(Number(credit.amountPaise)).toBe(19_000_00);
    expect(String(credit.accountId)).toBe(account._id.toString());
  });

  it("checksums in the manifest match what the sheets actually hold", async () => {
    await seedOneOfEverything();

    const { buffer, manifest } = await exportBackupXlsx();
    const { checksums, manifest: readManifest } = await readBack(buffer);

    expect(readManifest.formatVersion).toBe(BACKUP_FORMAT_VERSION);
    for (const entry of manifest.collections) {
      expect(checksums.get(entry.collection), entry.collection).toBe(entry.sha256);
    }
    expect(manifest.totalDocuments).toBe(
      manifest.collections.reduce((sum, entry) => sum + entry.documents, 0)
    );
  });

  it("includes the credential rows a restore needs to be usable", async () => {
    await seedOneOfEverything();

    const { manifest } = await exportBackupXlsx();
    const names = manifest.collections.map((c) => c.collection);

    // Without these, a restored database is a museum piece: correct, and
    // impossible to log in to.
    expect(names).toContain("users");
    expect(names).toContain("authAccounts");
  });

  it("skips the ephemeral collections", async () => {
    await seedOneOfEverything();
    const { database } = await nativeDb();
    await database.collection("sessions").insertOne({ token: "should-not-be-exported" });

    const { manifest } = await exportBackupXlsx();
    const names = manifest.collections.map((c) => c.collection);

    for (const ephemeral of EPHEMERAL_COLLECTIONS) {
      expect(names).not.toContain(ephemeral);
    }
  });

  // A collection added by a later version must not vanish from backups just
  // because this build has never heard of it.
  it("still exports an unknown collection, flagged as unexpected", async () => {
    await seedOneOfEverything();
    const { database } = await nativeDb();
    await database.collection("futurewidgets").insertOne({ hello: "world" });

    const { manifest } = await exportBackupXlsx();
    const entry = manifest.collections.find((c) => c.collection === "futurewidgets");

    expect(entry).toBeDefined();
    expect(entry!.unexpected).toBe(true);
    expect(entry!.documents).toBe(1);
  });

  it("writes the machine-readable manifest where the restore looks for it", async () => {
    await seedOneOfEverything();
    const { buffer } = await exportBackupXlsx();
    const { manifestSheet } = await readBack(buffer);

    expect(manifestSheet.getCell("A1").text).toBe(MANIFEST_JSON_KEY);
    expect(() => JSON.parse(manifestSheet.getCell("B1").text)).not.toThrow();
  });

  it("names files in IST so successive backups sort correctly", () => {
    // 2026-08-13T18:35Z is just past midnight IST on the 14th.
    expect(backupFilename("2026-08-13T18:35:00.000Z")).toBe("ledger-backup-2026-08-14-0005.xlsx");
    expect(backupFilename("2026-08-13T04:05:00.000Z")).toBe("ledger-backup-2026-08-13-0935.xlsx");
  });
});
