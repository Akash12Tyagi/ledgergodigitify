import { afterEach, describe, expect, it } from "vitest";

import { createDue, deleteDue, updateDue } from "@/server/services/dues.service";
import { recordPayment } from "@/server/services/payments.service";
import { MonthlyBillingModel } from "@/database/models/monthly-billing.model";
import { AuditLogModel } from "@/database/models/audit-log.model";
import { seedAccount, seedClient } from "../../helpers/seed-financial";
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

function istMidnight(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0) - 5.5 * 60 * 60 * 1000);
}

async function setup(label: string) {
  const owner = await seedUser({
    name: "Owner",
    email: `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
    password: PASSWORD,
    role: "owner",
  });
  const client = await seedClient(owner._id, { amountPaise: 10_000_00 });
  return { owner, actor: actorFrom(owner), client };
}

describe("dues.service — manual dues", () => {
  afterEach(async () => {
    await clearAllCollections();
  });

  it("creates a due for an arbitrary period and buckets it by due date", async () => {
    const { actor, client } = await setup("due1");

    const billing = await createDue(
      {
        clientId: client._id.toString(),
        periodStart: istMidnight(2026, 8, 20),
        periodEnd: istMidnight(2026, 9, 20),
        dueDate: istMidnight(2026, 8, 20),
        amountPaise: 12_000_00,
        note: "Extra project fee",
      },
      actor
    );

    expect(billing.periodStart.getTime()).toBe(istMidnight(2026, 8, 20).getTime());
    expect(billing.periodEnd.getTime()).toBe(istMidnight(2026, 9, 20).getTime());
    expect(billing.billedPaise).toBe(12_000_00);
    expect(billing.generatedBy).toBe("manual");
    expect(billing.monthKey).toBe("2026-08");
    expect(billing.carriedInPaise).toBe(0);

    const audit = await AuditLogModel.findOne({ action: "DUE_CREATED" }).lean();
    expect(audit).not.toBeNull();
  });

  it("allows two dues in the same reporting month", async () => {
    // The old {clientId, monthKey} unique index made this impossible, which
    // blocked both non-calendar cycles and a one-off charge sitting
    // alongside a retainer in the same month.
    const { actor, client } = await setup("due2");

    await createDue(
      {
        clientId: client._id.toString(),
        periodStart: istMidnight(2026, 8, 1),
        periodEnd: istMidnight(2026, 9, 1),
        dueDate: istMidnight(2026, 8, 1),
        amountPaise: 10_000_00,
      },
      actor
    );
    await createDue(
      {
        clientId: client._id.toString(),
        periodStart: istMidnight(2026, 8, 15),
        periodEnd: istMidnight(2026, 9, 15),
        dueDate: istMidnight(2026, 8, 20),
        amountPaise: 3_000_00,
      },
      actor
    );

    const billings = await MonthlyBillingModel.find({ clientId: client._id }).lean();
    expect(billings).toHaveLength(2);
    expect(billings.every((b) => b.monthKey === "2026-08")).toBe(true);
  });

  it("refuses a second due starting on the same day", async () => {
    const { actor, client } = await setup("due3");
    const period = {
      periodStart: istMidnight(2026, 8, 1),
      periodEnd: istMidnight(2026, 9, 1),
      dueDate: istMidnight(2026, 8, 1),
      amountPaise: 10_000_00,
    };

    await createDue({ clientId: client._id.toString(), ...period }, actor);
    await expect(createDue({ clientId: client._id.toString(), ...period }, actor)).rejects.toThrow(
      /already has a due starting on that date/i
    );
  });

  it("updates an untouched due and re-buckets it when the due date moves", async () => {
    const { actor, client } = await setup("due4");
    const billing = await createDue(
      {
        clientId: client._id.toString(),
        periodStart: istMidnight(2026, 8, 1),
        periodEnd: istMidnight(2026, 9, 1),
        dueDate: istMidnight(2026, 8, 1),
        amountPaise: 10_000_00,
      },
      actor
    );

    const updated = await updateDue(
      {
        dueId: billing._id.toString(),
        version: billing.version ?? 0,
        periodStart: istMidnight(2026, 8, 1),
        periodEnd: istMidnight(2026, 9, 1),
        dueDate: istMidnight(2026, 9, 1),
        amountPaise: 11_000_00,
        note: null,
      },
      actor
    );

    expect(updated.billedPaise).toBe(11_000_00);
    expect(updated.monthKey).toBe("2026-09");
  });

  it("refuses to edit or delete a due that has a payment against it", async () => {
    const { owner, actor, client } = await setup("due5");
    const account = await seedAccount({ openingBalancePaise: 0, currentBalancePaise: 0 });

    const billing = await createDue(
      {
        clientId: client._id.toString(),
        periodStart: istMidnight(2026, 8, 1),
        periodEnd: istMidnight(2026, 9, 1),
        dueDate: istMidnight(2026, 8, 1),
        amountPaise: 10_000_00,
      },
      actor
    );

    await recordPayment(
      {
        clientId: client._id.toString(),
        monthlyBillingId: billing._id.toString(),
        accountId: account._id.toString(),
        amountPaise: 4_000_00,
        paidAt: new Date(),
        method: "upi",
        invoiceNumber: `INV-${owner._id.toString().slice(-6)}`,
        receiptNumber: `RCP-${owner._id.toString().slice(-6)}`,
        reference: null,
        note: null,
        attachments: [],
        idempotencyKey: `pay-${Date.now()}`,
      },
      actor
    );

    // Re-dating a due that an issued receipt already points at would change
    // what that receipt was for.
    await expect(
      updateDue(
        {
          dueId: billing._id.toString(),
          version: billing.version ?? 0,
          periodStart: istMidnight(2026, 8, 1),
          periodEnd: istMidnight(2026, 9, 1),
          dueDate: istMidnight(2026, 8, 1),
          amountPaise: 99_000_00,
          note: null,
        },
        actor
      )
    ).rejects.toThrow(/payment/i);

    await expect(
      deleteDue({ dueId: billing._id.toString(), reason: "entered by mistake" }, actor)
    ).rejects.toThrow(/payment/i);
  });

  it("deletes an unpaid due but keeps a permanent audit record of it", async () => {
    const { actor, client } = await setup("due6");
    const billing = await createDue(
      {
        clientId: client._id.toString(),
        periodStart: istMidnight(2026, 8, 1),
        periodEnd: istMidnight(2026, 9, 1),
        dueDate: istMidnight(2026, 8, 1),
        amountPaise: 10_000_00,
      },
      actor
    );

    await deleteDue({ dueId: billing._id.toString(), reason: "raised against wrong client" }, actor);

    expect(await MonthlyBillingModel.countDocuments({ _id: billing._id })).toBe(0);

    const audit = await AuditLogModel.findOne({ action: "DUE_DELETED" }).lean();
    expect(audit).not.toBeNull();
    expect(audit?.summary).toContain("raised against wrong client");
  });
});
