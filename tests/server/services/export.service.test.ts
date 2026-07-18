import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import {
  exportClientsCsv,
  exportCreditsCsv,
  exportExpensesCsv,
  exportTransactionsCsv,
} from "@/server/services/export.service";
import { listExpenses } from "@/server/services/expenses.service";
import { listCredits } from "@/server/services/credits.service";
import { listTransactions } from "@/server/services/financial-engine";
import { createExpense } from "@/server/services/expenses.service";
import { createCredit } from "@/server/services/credits.service";
import { createClient } from "@/server/services/clients.service";
import { seedAccount } from "../../helpers/seed-financial";
import { seedUser, clearAllCollections } from "../../helpers/seed-user";
import type { AuthedUser } from "@/server/auth/guards";

const PASSWORD = "Correct-Horse-Battery-Staple-9";

function actorFrom(user: { _id: unknown; name: string; email: string; role: string }): AuthedUser {
  return { id: String(user._id), name: user.name, email: user.email, role: user.role as AuthedUser["role"] };
}

function dataRowCount(csv: string): number {
  return csv.split("\r\n").length - 1; // minus the header row
}

afterEach(async () => {
  await clearAllCollections();
});

describe("export.service — WYSIWYG (Section 7.13/15)", () => {
  it("exportExpensesCsv has exactly as many rows as listExpenses for the identical filter", async () => {
    const owner = await seedUser({ name: "Owner", email: `exp-csv1-${Date.now()}@example.com`, password: PASSWORD, role: "owner" });
    const actor = actorFrom(owner);
    const account = await seedAccount({ openingBalancePaise: 50_000_00, currentBalancePaise: 50_000_00 });

    for (const amount of [1_000_00, 2_000_00, 3_000_00]) {
      await createExpense(
        {
          amountPaise: amount,
          reason: "Export test",
          paidToEntity: "Vendor",
          category: "misc",
          accountId: account._id.toString(),
          spentAt: new Date("2026-07-05T00:00:00.000Z"),
          idempotencyKey: randomUUID(),
        },
        actor
      );
    }

    const filter = { category: "misc" as const, status: "active" as const };
    const screen = await listExpenses({ ...filter, page: 1, pageSize: 20 });
    const csv = await exportExpensesCsv(filter);

    expect(dataRowCount(csv)).toBe(screen.total);
    expect(dataRowCount(csv)).toBe(3);
    expect(csv).toContain("1000");
    expect(csv).toContain("Vendor");
  });

  it("exportCreditsCsv has exactly as many rows as listCredits for the identical filter", async () => {
    const owner = await seedUser({ name: "Owner2", email: `exp-csv2-${Date.now()}@example.com`, password: PASSWORD, role: "owner" });
    const actor = actorFrom(owner);
    const account = await seedAccount({ openingBalancePaise: 0, currentBalancePaise: 0 });

    await createCredit(
      {
        amountPaise: 5_000_00,
        source: "Bank",
        reason: "Interest",
        category: "interest",
        accountId: account._id.toString(),
        receivedAt: new Date("2026-07-05T00:00:00.000Z"),
        idempotencyKey: randomUUID(),
      },
      actor
    );

    const filter = { category: "interest" as const, status: "active" as const };
    const screen = await listCredits({ ...filter, page: 1, pageSize: 20 });
    const csv = await exportCreditsCsv(filter);

    expect(dataRowCount(csv)).toBe(screen.total);
    expect(dataRowCount(csv)).toBe(1);
    expect(csv).toContain("5000");
  });

  it("exportClientsCsv has exactly as many rows as getClientsListView for the identical filter", async () => {
    const owner = await seedUser({ name: "Owner3", email: `exp-csv3-${Date.now()}@example.com`, password: PASSWORD, role: "owner" });
    const actor = actorFrom(owner);

    await createClient(
      {
        name: `Export Client ${randomUUID()}`,
        service: "Bookkeeping",
        engagementType: "retainer",
        amountPaise: 15_000_00,
        nextDueDate: new Date("2026-08-01T00:00:00.000Z"),
      },
      actor
    );

    const csv = await exportClientsCsv({ status: "active" });
    expect(dataRowCount(csv)).toBe(1);
    expect(csv).toContain("15000");
  });

  it("exportTransactionsCsv has exactly as many rows as listTransactions for the identical filter", async () => {
    const owner = await seedUser({ name: "Owner4", email: `exp-csv4-${Date.now()}@example.com`, password: PASSWORD, role: "owner" });
    const actor = actorFrom(owner);
    const account = await seedAccount({ openingBalancePaise: 50_000_00, currentBalancePaise: 50_000_00 });

    await createExpense(
      {
        amountPaise: 2_500_00,
        reason: "Tx export test",
        paidToEntity: "Vendor",
        category: "misc",
        accountId: account._id.toString(),
        spentAt: new Date("2026-07-05T00:00:00.000Z"),
        idempotencyKey: randomUUID(),
      },
      actor
    );

    const filter = { monthKey: "2026-07", type: ["EXPENSE_OUT" as const] };
    const screen = await listTransactions({ ...filter, page: 1, pageSize: 20 });
    const csv = await exportTransactionsCsv(filter);

    expect(dataRowCount(csv)).toBe(screen.total);
    expect(dataRowCount(csv)).toBe(1);
    expect(csv).toContain("2500");
  });
});
