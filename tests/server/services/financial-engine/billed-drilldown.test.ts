import { afterEach, describe, expect, it } from "vitest";

import { getBilledClientsForMonth, getMonthOverview } from "@/server/services/financial-engine";
import { seedBilling, seedClient } from "../../../helpers/seed-financial";
import { seedUser, clearAllCollections } from "../../../helpers/seed-user";

const MONTH_KEY = "2026-07";

// Section 15/M8 — the Ledger Overview's "Billed" card became a drill-down
// onto /ledger/billed (getBilledClientsForMonth). Same sibling-list rule
// as Section 4.6's transaction-based cards, just sourced from MonthlyBilling
// instead of Transaction: the card's total must equal the sum of the rows
// the drill-down shows.
describe("getBilledClientsForMonth (Billed drill-down)", () => {
  afterEach(async () => {
    await clearAllCollections();
  });

  it("returns one row per client billed that month, summing to getMonthOverview's billedPaise", async () => {
    const owner = await seedUser({
      name: "OwnerBilled",
      email: `billed-${Date.now()}@example.com`,
      password: "Correct-Horse-Battery-Staple-9",
      role: "owner",
    });
    const clientA = await seedClient(owner._id, { name: "Alpha Retainer Co" });
    const clientB = await seedClient(owner._id, { name: "Bravo Retainer Co" });

    await seedBilling(clientA._id, { monthKey: MONTH_KEY, billedPaise: 20_000_00, carriedInPaise: 0 });
    await seedBilling(clientB._id, { monthKey: MONTH_KEY, billedPaise: 15_000_00, carriedInPaise: 5_000_00 });
    // A different month must not leak into this month's drill-down.
    await seedBilling(clientA._id, { monthKey: "2026-06", billedPaise: 20_000_00 });

    const overview = await getMonthOverview(MONTH_KEY);
    const rows = await getBilledClientsForMonth(MONTH_KEY);

    const sumOfRows = rows.reduce((sum, r) => sum + r.billedPaise, 0);
    expect(sumOfRows).toBe(overview.billedPaise);
    expect(sumOfRows).toBe(35_000_00);
    expect(rows).toHaveLength(2);

    const byName = new Map(rows.map((r) => [r.clientName, r]));
    expect(byName.get("Alpha Retainer Co")?.billedPaise).toBe(20_000_00);
    expect(byName.get("Bravo Retainer Co")?.carriedInPaise).toBe(5_000_00);
  });

  it("returns an empty list for a month with no billings", async () => {
    const rows = await getBilledClientsForMonth("2030-01");
    expect(rows).toEqual([]);
  });
});
