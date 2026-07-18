import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import { reverseTransfer, transferBetweenAccounts } from "@/server/services/transfers.service";
import { AccountModel } from "@/database/models/account.model";
import { TransactionModel } from "@/database/models/transaction.model";
import { AuditLogModel } from "@/database/models/audit-log.model";
import { seedAccount } from "../../helpers/seed-financial";
import { seedUser, clearAllCollections } from "../../helpers/seed-user";
import type { AuthedUser } from "@/server/auth/guards";

const PASSWORD = "Correct-Horse-Battery-Staple-9";

function actorFrom(user: { _id: unknown; name: string; email: string; role: string }): AuthedUser {
  return { id: String(user._id), name: user.name, email: user.email, role: user.role as AuthedUser["role"] };
}

describe("transfers.service — transferBetweenAccounts (Section 6.5)", () => {
  afterEach(async () => {
    await clearAllCollections();
  });

  it("moves money atomically — both legs recorded, both balances updated", async () => {
    const admin = await seedUser({ name: "Admin", email: `tr1-${Date.now()}@example.com`, password: PASSWORD, role: "admin" });
    const actor = actorFrom(admin);
    const from = await seedAccount({ openingBalancePaise: 20_000_00, currentBalancePaise: 20_000_00 });
    const to = await seedAccount({ openingBalancePaise: 0, currentBalancePaise: 0 });

    const result = await transferBetweenAccounts(
      {
        fromAccountId: from._id.toString(),
        toAccountId: to._id.toString(),
        amountPaise: 5_000_00,
        occurredAt: new Date("2026-07-05T00:00:00.000Z"),
        idempotencyKey: randomUUID(),
      },
      actor
    );

    expect(result.fromNewBalance).toBe(15_000_00);
    expect(result.toNewBalance).toBe(5_000_00);

    const legs = await TransactionModel.find({ transactionGroupId: result.groupId }).lean();
    expect(legs).toHaveLength(2);
    expect(legs.find((l) => l.direction === "OUT")?.accountId.toString()).toBe(from._id.toString());
    expect(legs.find((l) => l.direction === "IN")?.accountId.toString()).toBe(to._id.toString());

    const audit = await AuditLogModel.findOne({ action: "TRANSFER_CREATED" }).lean();
    expect(audit).not.toBeNull();
  });

  it("blocks a transfer that would push the source account negative, unless the owner overrides it", async () => {
    const admin = await seedUser({ name: "Admin2", email: `tr2-${Date.now()}@example.com`, password: PASSWORD, role: "admin" });
    const adminActor = actorFrom(admin);
    const from = await seedAccount({ openingBalancePaise: 1_000_00, currentBalancePaise: 1_000_00 });
    const to = await seedAccount({ openingBalancePaise: 0, currentBalancePaise: 0 });

    await expect(
      transferBetweenAccounts(
        {
          fromAccountId: from._id.toString(),
          toAccountId: to._id.toString(),
          amountPaise: 5_000_00,
          occurredAt: new Date("2026-07-05T00:00:00.000Z"),
          idempotencyKey: randomUUID(),
        },
        adminActor
      )
    ).rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE" });

    const owner = await seedUser({ name: "Owner", email: `tr3-${Date.now()}@example.com`, password: PASSWORD, role: "owner" });
    const ownerActor = actorFrom(owner);

    const overridden = await transferBetweenAccounts(
      {
        fromAccountId: from._id.toString(),
        toAccountId: to._id.toString(),
        amountPaise: 5_000_00,
        occurredAt: new Date("2026-07-05T00:00:00.000Z"),
        overrideNegativeBalance: true,
        idempotencyKey: randomUUID(),
      },
      ownerActor
    );

    expect(overridden.fromNewBalance).toBe(-4_000_00);
    expect(overridden.toNewBalance).toBe(5_000_00);
  });

  it("a double-submit with the same idempotencyKey replays instead of double-applying both legs", async () => {
    const admin = await seedUser({ name: "Admin3", email: `tr4-${Date.now()}@example.com`, password: PASSWORD, role: "admin" });
    const actor = actorFrom(admin);
    const from = await seedAccount({ openingBalancePaise: 10_000_00, currentBalancePaise: 10_000_00 });
    const to = await seedAccount({ openingBalancePaise: 0, currentBalancePaise: 0 });
    const idempotencyKey = randomUUID();

    const input = {
      fromAccountId: from._id.toString(),
      toAccountId: to._id.toString(),
      amountPaise: 3_000_00,
      occurredAt: new Date("2026-07-05T00:00:00.000Z"),
      idempotencyKey,
    };

    await transferBetweenAccounts(input, actor);
    await expect(transferBetweenAccounts(input, actor)).rejects.toMatchObject({ code: "IDEMPOTENT_REPLAY" });

    const updatedFrom = await AccountModel.findById(from._id).lean();
    const updatedTo = await AccountModel.findById(to._id).lean();
    expect(updatedFrom?.currentBalancePaise).toBe(7_000_00);
    expect(updatedTo?.currentBalancePaise).toBe(3_000_00);
  });

  it("sums exactly under 8 concurrent transfers between the same pair of accounts (Section 15 concurrency)", async () => {
    const admin = await seedUser({ name: "Admin4", email: `tr5-${Date.now()}@example.com`, password: PASSWORD, role: "admin" });
    const actor = actorFrom(admin);
    const from = await seedAccount({ openingBalancePaise: 100_000_00, currentBalancePaise: 100_000_00 });
    const to = await seedAccount({ openingBalancePaise: 0, currentBalancePaise: 0 });

    const amounts = Array.from({ length: 8 }, (_, i) => (i + 1) * 100_00);
    await Promise.all(
      amounts.map((amountPaise) =>
        transferBetweenAccounts(
          {
            fromAccountId: from._id.toString(),
            toAccountId: to._id.toString(),
            amountPaise,
            occurredAt: new Date("2026-07-05T00:00:00.000Z"),
            idempotencyKey: randomUUID(),
          },
          actor
        )
      )
    );

    const expectedTotal = amounts.reduce((s, a) => s + a, 0);
    const updatedFrom = await AccountModel.findById(from._id).lean();
    const updatedTo = await AccountModel.findById(to._id).lean();
    expect(updatedFrom?.currentBalancePaise).toBe(100_000_00 - expectedTotal);
    expect(updatedTo?.currentBalancePaise).toBe(expectedTotal);
  }, 30_000);
});

describe("transfers.service — reverseTransfer", () => {
  afterEach(async () => {
    await clearAllCollections();
  });

  it("undoes both legs atomically", async () => {
    const admin = await seedUser({ name: "Admin5", email: `tr6-${Date.now()}@example.com`, password: PASSWORD, role: "admin" });
    const actor = actorFrom(admin);
    const from = await seedAccount({ openingBalancePaise: 10_000_00, currentBalancePaise: 10_000_00 });
    const to = await seedAccount({ openingBalancePaise: 0, currentBalancePaise: 0 });

    const created = await transferBetweenAccounts(
      {
        fromAccountId: from._id.toString(),
        toAccountId: to._id.toString(),
        amountPaise: 4_000_00,
        occurredAt: new Date("2026-07-05T00:00:00.000Z"),
        idempotencyKey: randomUUID(),
      },
      actor
    );

    const reversed = await reverseTransfer(
      { transactionGroupId: created.groupId, reason: "Wrong destination account", idempotencyKey: randomUUID() },
      actor
    );

    expect(reversed.fromNewBalance).toBe(10_000_00);
    expect(reversed.toNewBalance).toBe(0);

    const legs = await TransactionModel.find({}).lean();
    expect(legs.every((l) => l.status === "reversed" || l.type === "REVERSAL")).toBe(true);

    const audit = await AuditLogModel.findOne({ action: "TRANSFER_REVERSED" }).lean();
    expect(audit).not.toBeNull();
  });

  it("reversing an already-reversed transfer is a CONFLICT", async () => {
    const admin = await seedUser({ name: "Admin6", email: `tr7-${Date.now()}@example.com`, password: PASSWORD, role: "admin" });
    const actor = actorFrom(admin);
    const from = await seedAccount({ openingBalancePaise: 5_000_00, currentBalancePaise: 5_000_00 });
    const to = await seedAccount({ openingBalancePaise: 0, currentBalancePaise: 0 });

    const created = await transferBetweenAccounts(
      {
        fromAccountId: from._id.toString(),
        toAccountId: to._id.toString(),
        amountPaise: 2_000_00,
        occurredAt: new Date("2026-07-05T00:00:00.000Z"),
        idempotencyKey: randomUUID(),
      },
      actor
    );

    await reverseTransfer(
      { transactionGroupId: created.groupId, reason: "First reversal", idempotencyKey: randomUUID() },
      actor
    );

    await expect(
      reverseTransfer(
        { transactionGroupId: created.groupId, reason: "Second attempt", idempotencyKey: randomUUID() },
        actor
      )
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
