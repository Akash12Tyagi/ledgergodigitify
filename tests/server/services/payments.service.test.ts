import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import { createClient } from "@/server/services/clients.service";
import { recordPayment, reversePayment } from "@/server/services/payments.service";
import { AccountModel } from "@/database/models/account.model";
import { MonthlyBillingModel } from "@/database/models/monthly-billing.model";
import { AuditLogModel } from "@/database/models/audit-log.model";
import { NotificationModel } from "@/database/models/notification.model";
import { seedAccount } from "../../helpers/seed-financial";
import { seedUser, clearAllCollections } from "../../helpers/seed-user";
import type { AuthedUser } from "@/server/auth/guards";

const PASSWORD = "Correct-Horse-Battery-Staple-9";

function actorFrom(user: { _id: unknown; name: string; email: string; role: string }): AuthedUser {
  return { id: String(user._id), name: user.name, email: user.email, role: user.role as AuthedUser["role"] };
}

// Task 2 — invoiceNumber/receiptNumber are manually entered now (no more
// counter-based auto-generation), and both carry a unique index, so every
// recordPayment call in these tests needs its own distinct pair.
let paymentNumberSeq = 0;
function uniquePaymentNumbers() {
  paymentNumberSeq += 1;
  return {
    invoiceNumber: `INV-TEST-${randomUUID()}-${paymentNumberSeq}`,
    receiptNumber: `RCP-TEST-${randomUUID()}-${paymentNumberSeq}`,
  };
}

async function setupClientAndBilling(actor: AuthedUser, amountPaise = 20_000_00) {
  const { client, billing } = await createClient(
    {
      name: `Client ${randomUUID()}`,
      service: "Bookkeeping",
      engagementType: "retainer",
      amountPaise,
      nextDueDate: new Date("2026-07-15T00:00:00.000Z"),
    },
    actor
  );
  return { client, billing };
}

describe("payments.service — recordPayment (Section 6.1)", () => {
  afterEach(async () => {
    await clearAllCollections();
  });

  it("a partial payment moves the billing to PARTIALLY_PAID and increments the account balance", async () => {
    const owner = await seedUser({ name: "Owner", email: `pay-${Date.now()}@example.com`, password: PASSWORD, role: "owner" });
    const actor = actorFrom(owner);
    const { client, billing } = await setupClientAndBilling(actor);
    const account = await seedAccount({ openingBalancePaise: 0, currentBalancePaise: 0 });

    const numbers = uniquePaymentNumbers();
    const result = await recordPayment(
      {
        clientId: client._id.toString(),
        monthlyBillingId: billing._id.toString(),
        amountPaise: 8_000_00,
        accountId: account._id.toString(),
        paidAt: new Date("2026-07-05T00:00:00.000Z"),
        method: "upi",
        ...numbers,
        idempotencyKey: randomUUID(),
      },
      actor
    );

    expect(result.newBillingStatus).toBe("PARTIALLY_PAID");
    expect(result.accountNewBalance).toBe(8_000_00);
    expect(result.payment.invoiceNumber).toBe(numbers.invoiceNumber);
    expect(result.payment.receiptNumber).toBe(numbers.receiptNumber);

    const updatedBilling = await MonthlyBillingModel.findById(billing._id).lean();
    expect(updatedBilling?.paidPaise).toBe(8_000_00);
    expect(updatedBilling?.status).toBe("PARTIALLY_PAID");

    const updatedAccount = await AccountModel.findById(account._id).lean();
    expect(updatedAccount?.currentBalancePaise).toBe(8_000_00);

    const notification = await NotificationModel.findOne({ type: "PAYMENT_RECEIVED" }).lean();
    expect(notification).not.toBeNull();
    expect(notification?.dedupeKey).toBe(`PAY:${result.payment._id.toString()}`);

    const audit = await AuditLogModel.findOne({ action: "PAYMENT_RECORDED" }).lean();
    expect(audit).not.toBeNull();
  });

  it("a second payment completing the total moves the billing to FULLY_PAID (the milestone's partial->full flow)", async () => {
    const owner = await seedUser({ name: "Owner2", email: `pay2-${Date.now()}@example.com`, password: PASSWORD, role: "owner" });
    const actor = actorFrom(owner);
    const { client, billing } = await setupClientAndBilling(actor);
    const account = await seedAccount({ openingBalancePaise: 0, currentBalancePaise: 0 });

    await recordPayment(
      {
        clientId: client._id.toString(),
        monthlyBillingId: billing._id.toString(),
        amountPaise: 8_000_00,
        accountId: account._id.toString(),
        paidAt: new Date("2026-07-05T00:00:00.000Z"),
        method: "upi",
        ...uniquePaymentNumbers(),
        idempotencyKey: randomUUID(),
      },
      actor
    );
    const second = await recordPayment(
      {
        clientId: client._id.toString(),
        monthlyBillingId: billing._id.toString(),
        amountPaise: 12_000_00,
        accountId: account._id.toString(),
        paidAt: new Date("2026-07-10T00:00:00.000Z"),
        method: "cash",
        ...uniquePaymentNumbers(),
        idempotencyKey: randomUUID(),
      },
      actor
    );

    expect(second.newBillingStatus).toBe("FULLY_PAID");
    expect(second.accountNewBalance).toBe(20_000_00);

    const updatedBilling = await MonthlyBillingModel.findById(billing._id).lean();
    expect(updatedBilling?.paidPaise).toBe(20_000_00);
    expect(updatedBilling?.status).toBe("FULLY_PAID");

    // Two distinct, unique invoice/receipt numbers — never reused.
    expect(second.payment.invoiceNumber).not.toBe(second.payment.receiptNumber);
  });

  it("rejects payments for an archived client (Section 6.1 step 1 / ARCHIVED_CLIENT)", async () => {
    const owner = await seedUser({ name: "Owner3", email: `pay3-${Date.now()}@example.com`, password: PASSWORD, role: "owner" });
    const actor = actorFrom(owner);
    const { client, billing } = await setupClientAndBilling(actor);
    const account = await seedAccount();

    const { archiveClient } = await import("@/server/services/clients.service");
    await archiveClient(client._id.toString(), null, actor);

    await expect(
      recordPayment(
        {
          clientId: client._id.toString(),
          monthlyBillingId: billing._id.toString(),
          amountPaise: 1000_00,
          accountId: account._id.toString(),
          paidAt: new Date("2026-07-05T00:00:00.000Z"),
          method: "cash",
          ...uniquePaymentNumbers(),
          idempotencyKey: randomUUID(),
        },
        actor
      )
    ).rejects.toMatchObject({ code: "ARCHIVED_CLIENT" });
  });

  it("rejects a future-dated payment using server-derived todayIST, never the client's claim (Section 14 edge case 45)", async () => {
    const owner = await seedUser({ name: "Owner4", email: `pay4-${Date.now()}@example.com`, password: PASSWORD, role: "owner" });
    const actor = actorFrom(owner);
    const { client, billing } = await setupClientAndBilling(actor);
    const account = await seedAccount();

    const farFuture = new Date();
    farFuture.setFullYear(farFuture.getFullYear() + 1);

    await expect(
      recordPayment(
        {
          clientId: client._id.toString(),
          monthlyBillingId: billing._id.toString(),
          amountPaise: 1000_00,
          accountId: account._id.toString(),
          paidAt: farFuture,
          method: "cash",
          ...uniquePaymentNumbers(),
          idempotencyKey: randomUUID(),
        },
        actor
      )
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("a double-submit with the same idempotencyKey replays instead of double-applying (Section 14 edge case 5)", async () => {
    const owner = await seedUser({ name: "Owner5", email: `pay5-${Date.now()}@example.com`, password: PASSWORD, role: "owner" });
    const actor = actorFrom(owner);
    const { client, billing } = await setupClientAndBilling(actor);
    const account = await seedAccount({ openingBalancePaise: 0, currentBalancePaise: 0 });
    const idempotencyKey = randomUUID();

    const input = {
      clientId: client._id.toString(),
      monthlyBillingId: billing._id.toString(),
      amountPaise: 5_000_00,
      accountId: account._id.toString(),
      paidAt: new Date("2026-07-05T00:00:00.000Z"),
      method: "cash" as const,
      ...uniquePaymentNumbers(),
      idempotencyKey,
    };

    const first = await recordPayment(input, actor);

    await expect(recordPayment(input, actor)).rejects.toMatchObject({ code: "IDEMPOTENT_REPLAY" });

    const updatedAccount = await AccountModel.findById(account._id).lean();
    expect(updatedAccount?.currentBalancePaise).toBe(5_000_00); // NOT 10,000 — applied once
    const updatedBilling = await MonthlyBillingModel.findById(billing._id).lean();
    expect(updatedBilling?.paidPaise).toBe(5_000_00);
    expect(first.payment.amountPaise).toBe(5_000_00);
  });

  it("rejects a duplicate invoice number with a clear per-field error (Task 2)", async () => {
    const owner = await seedUser({ name: "OwnerInv", email: `payinv-${Date.now()}@example.com`, password: PASSWORD, role: "owner" });
    const actor = actorFrom(owner);
    const { client, billing } = await setupClientAndBilling(actor, 40_000_00);
    const account = await seedAccount({ openingBalancePaise: 0, currentBalancePaise: 0 });
    const numbers = uniquePaymentNumbers();

    await recordPayment(
      {
        clientId: client._id.toString(),
        monthlyBillingId: billing._id.toString(),
        amountPaise: 5_000_00,
        accountId: account._id.toString(),
        paidAt: new Date("2026-07-05T00:00:00.000Z"),
        method: "cash",
        ...numbers,
        idempotencyKey: randomUUID(),
      },
      actor
    );

    await expect(
      recordPayment(
        {
          clientId: client._id.toString(),
          monthlyBillingId: billing._id.toString(),
          amountPaise: 5_000_00,
          accountId: account._id.toString(),
          paidAt: new Date("2026-07-06T00:00:00.000Z"),
          method: "cash",
          invoiceNumber: numbers.invoiceNumber, // duplicate
          receiptNumber: uniquePaymentNumbers().receiptNumber,
          idempotencyKey: randomUUID(),
        },
        actor
      )
    ).rejects.toMatchObject({ code: "VALIDATION", fields: { invoiceNumber: expect.any(String) } });

    // The rejected attempt must not have partially applied.
    const updatedBilling = await MonthlyBillingModel.findById(billing._id).lean();
    expect(updatedBilling?.paidPaise).toBe(5_000_00);
  });

  it("rejects a duplicate receipt number with a clear per-field error (Task 2)", async () => {
    const owner = await seedUser({ name: "OwnerRcp", email: `payrcp-${Date.now()}@example.com`, password: PASSWORD, role: "owner" });
    const actor = actorFrom(owner);
    const { client, billing } = await setupClientAndBilling(actor, 40_000_00);
    const account = await seedAccount({ openingBalancePaise: 0, currentBalancePaise: 0 });
    const numbers = uniquePaymentNumbers();

    await recordPayment(
      {
        clientId: client._id.toString(),
        monthlyBillingId: billing._id.toString(),
        amountPaise: 5_000_00,
        accountId: account._id.toString(),
        paidAt: new Date("2026-07-05T00:00:00.000Z"),
        method: "cash",
        ...numbers,
        idempotencyKey: randomUUID(),
      },
      actor
    );

    await expect(
      recordPayment(
        {
          clientId: client._id.toString(),
          monthlyBillingId: billing._id.toString(),
          amountPaise: 5_000_00,
          accountId: account._id.toString(),
          paidAt: new Date("2026-07-06T00:00:00.000Z"),
          method: "cash",
          invoiceNumber: uniquePaymentNumbers().invoiceNumber,
          receiptNumber: numbers.receiptNumber, // duplicate
          idempotencyKey: randomUUID(),
        },
        actor
      )
    ).rejects.toMatchObject({ code: "VALIDATION", fields: { receiptNumber: expect.any(String) } });
  });

  it("sums exactly under 10 concurrent payments against the same billing/account (Section 15's concurrency test)", async () => {
    const owner = await seedUser({ name: "Owner6", email: `pay6-${Date.now()}@example.com`, password: PASSWORD, role: "owner" });
    const actor = actorFrom(owner);
    const { client, billing } = await setupClientAndBilling(actor, 100_000_00);
    const account = await seedAccount({ openingBalancePaise: 0, currentBalancePaise: 0 });

    const amounts = Array.from({ length: 10 }, (_, i) => (i + 1) * 100_00); // 100..1000 rupees
    const results = await Promise.all(
      amounts.map((amountPaise) =>
        recordPayment(
          {
            clientId: client._id.toString(),
            monthlyBillingId: billing._id.toString(),
            amountPaise,
            accountId: account._id.toString(),
            paidAt: new Date("2026-07-05T00:00:00.000Z"),
            method: "cash",
            ...uniquePaymentNumbers(),
            idempotencyKey: randomUUID(),
          },
          actor
        )
      )
    );

    const expectedTotal = amounts.reduce((s, a) => s + a, 0);
    const updatedAccount = await AccountModel.findById(account._id).lean();
    const updatedBilling = await MonthlyBillingModel.findById(billing._id).lean();

    expect(updatedAccount?.currentBalancePaise).toBe(expectedTotal);
    expect(updatedBilling?.paidPaise).toBe(expectedTotal);

    const invoiceNumbers = new Set(results.map((r) => r.payment.invoiceNumber));
    const receiptNumbers = new Set(results.map((r) => r.payment.receiptNumber));
    expect(invoiceNumbers.size).toBe(10);
    expect(receiptNumbers.size).toBe(10);
  }, 30_000);
});

describe("payments.service — reversePayment (Section 6.2)", () => {
  afterEach(async () => {
    await clearAllCollections();
  });

  it("restores the account balance and drops the billing status (Section 14 edge case 7)", async () => {
    const owner = await seedUser({ name: "Owner7", email: `rev-${Date.now()}@example.com`, password: PASSWORD, role: "owner" });
    const admin = await seedUser({ name: "Admin", email: `adm-${Date.now()}@example.com`, password: PASSWORD, role: "admin" });
    const ownerActor = actorFrom(owner);
    const adminActor = actorFrom(admin);
    const { client, billing } = await setupClientAndBilling(ownerActor);
    const account = await seedAccount({ openingBalancePaise: 0, currentBalancePaise: 0 });

    const recorded = await recordPayment(
      {
        clientId: client._id.toString(),
        monthlyBillingId: billing._id.toString(),
        amountPaise: 20_000_00,
        accountId: account._id.toString(),
        paidAt: new Date("2026-07-05T00:00:00.000Z"),
        method: "cash",
        ...uniquePaymentNumbers(),
        idempotencyKey: randomUUID(),
      },
      ownerActor
    );
    expect(recorded.newBillingStatus).toBe("FULLY_PAID");

    const reversed = await reversePayment(
      { paymentId: recorded.payment._id.toString(), reason: "Wrong account selected", idempotencyKey: randomUUID() },
      adminActor
    );

    expect(reversed.newBillingStatus).toBe("PENDING");
    expect(reversed.accountNewBalance).toBe(0);

    const updatedBilling = await MonthlyBillingModel.findById(billing._id).lean();
    expect(updatedBilling?.paidPaise).toBe(0);
    expect(updatedBilling?.status).toBe("PENDING");

    const updatedAccount = await AccountModel.findById(account._id).lean();
    expect(updatedAccount?.currentBalancePaise).toBe(0);

    const audit = await AuditLogModel.findOne({ action: "PAYMENT_REVERSED" }).lean();
    expect(audit?.summary).toContain("Wrong account selected");
  });

  it("reversing an already-reversed payment is a CONFLICT, not a double-reversal (Section 14 edge case 8)", async () => {
    const owner = await seedUser({ name: "Owner8", email: `rev2-${Date.now()}@example.com`, password: PASSWORD, role: "owner" });
    const actor = actorFrom(owner);
    const { client, billing } = await setupClientAndBilling(actor);
    const account = await seedAccount({ openingBalancePaise: 0, currentBalancePaise: 0 });

    const recorded = await recordPayment(
      {
        clientId: client._id.toString(),
        monthlyBillingId: billing._id.toString(),
        amountPaise: 5_000_00,
        accountId: account._id.toString(),
        paidAt: new Date("2026-07-05T00:00:00.000Z"),
        method: "cash",
        ...uniquePaymentNumbers(),
        idempotencyKey: randomUUID(),
      },
      actor
    );

    await reversePayment(
      { paymentId: recorded.payment._id.toString(), reason: "Duplicate entry", idempotencyKey: randomUUID() },
      actor
    );

    await expect(
      reversePayment(
        { paymentId: recorded.payment._id.toString(), reason: "Trying again", idempotencyKey: randomUUID() },
        actor
      )
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("account balance may legitimately go negative after a reversal if funds were already spent (Section 6.2 step 4)", async () => {
    const owner = await seedUser({ name: "Owner9", email: `rev3-${Date.now()}@example.com`, password: PASSWORD, role: "owner" });
    const actor = actorFrom(owner);
    const { client, billing } = await setupClientAndBilling(actor);
    const account = await seedAccount({ openingBalancePaise: 0, currentBalancePaise: 0 });

    const recorded = await recordPayment(
      {
        clientId: client._id.toString(),
        monthlyBillingId: billing._id.toString(),
        amountPaise: 10_000_00,
        accountId: account._id.toString(),
        paidAt: new Date("2026-07-05T00:00:00.000Z"),
        method: "cash",
        ...uniquePaymentNumbers(),
        idempotencyKey: randomUUID(),
      },
      actor
    );

    // Spend it all via a direct balance mutation simulating an expense
    // (expenses land in M4) — the account is now at 0 before the reversal.
    await AccountModel.findByIdAndUpdate(account._id, { $set: { currentBalancePaise: 0 } });

    const reversed = await reversePayment(
      { paymentId: recorded.payment._id.toString(), reason: "Client disputed charge", idempotencyKey: randomUUID() },
      actor
    );

    expect(reversed.accountNewBalance).toBe(-10_000_00);
  });
});
