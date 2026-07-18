import { afterEach, describe, expect, it } from "vitest";

import { reconcileAccount, reconcileAll } from "@/server/services/financial-engine";
import { seedAccount, seedTransaction } from "../../../helpers/seed-financial";
import { seedUser, clearAllCollections } from "../../../helpers/seed-user";

// Section 4.5 — pure derive-vs-materialized comparison. The side-effecting
// lock+notify behavior belongs to reconciliation.service.ts (M6); this
// only tests that drift is correctly detected and reported.
describe("reconcileAccount / reconcileAll", () => {
  afterEach(async () => {
    await clearAllCollections();
  });

  it("reports zero drift when materializedPaise matches the ledger", async () => {
    const owner = await seedUser({
      name: "Owner",
      email: `rec-${Date.now()}@example.com`,
      password: "Correct-Horse-Battery-Staple-9",
      role: "owner",
    });
    const account = await seedAccount({ openingBalancePaise: 1000_00, currentBalancePaise: 1000_00 });

    await seedTransaction(owner._id, { accountId: account._id, direction: "IN", amountPaise: 500_00 });
    // Materialized balance kept in sync by hand here, since recordPayment
    // (M3) is what normally does this inside its own DB transaction.
    const { AccountModel } = await import("@/database/models/account.model");
    await AccountModel.findByIdAndUpdate(account._id, { $set: { currentBalancePaise: 1500_00 } });

    const result = await reconcileAccount(account._id.toString());
    expect(result.derivedPaise).toBe(1500_00);
    expect(result.materializedPaise).toBe(1500_00);
    expect(result.driftPaise).toBe(0);
  });

  it("detects drift when the materialized balance disagrees with the ledger", async () => {
    const owner = await seedUser({
      name: "Owner2",
      email: `rec2-${Date.now()}@example.com`,
      password: "Correct-Horse-Battery-Staple-9",
      role: "owner",
    });
    const account = await seedAccount({ openingBalancePaise: 1000_00, currentBalancePaise: 1000_00 });

    // Ledger says +500, but materializedPaise was never updated to match
    // (simulating a bug/bypass — exactly what reconciliation exists to catch).
    await seedTransaction(owner._id, { accountId: account._id, direction: "IN", amountPaise: 500_00 });

    const result = await reconcileAccount(account._id.toString());
    expect(result.derivedPaise).toBe(1500_00);
    expect(result.materializedPaise).toBe(1000_00);
    expect(result.driftPaise).toBe(500_00);
  });

  it("reconcileAll reports hasDrift=true if any account drifts", async () => {
    const owner = await seedUser({
      name: "Owner3",
      email: `rec3-${Date.now()}@example.com`,
      password: "Correct-Horse-Battery-Staple-9",
      role: "owner",
    });
    const clean = await seedAccount({ openingBalancePaise: 100_00, currentBalancePaise: 100_00 });
    const drifted = await seedAccount({ openingBalancePaise: 200_00, currentBalancePaise: 200_00 });
    await seedTransaction(owner._id, { accountId: drifted._id, direction: "IN", amountPaise: 50_00 });

    const report = await reconcileAll();
    expect(report.hasDrift).toBe(true);
    const cleanResult = report.accounts.find((a) => a.accountId === clean._id.toString());
    const driftedResult = report.accounts.find((a) => a.accountId === drifted._id.toString());
    expect(cleanResult?.driftPaise).toBe(0);
    expect(driftedResult?.driftPaise).toBe(50_00);
  });
});
