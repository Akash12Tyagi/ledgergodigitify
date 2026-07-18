import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import { createCredit, reverseCredit } from "@/server/services/credits.service";
import { AccountModel } from "@/database/models/account.model";
import { CreditModel } from "@/database/models/credit.model";
import { AuditLogModel } from "@/database/models/audit-log.model";
import { seedAccount } from "../../helpers/seed-financial";
import { seedUser, clearAllCollections } from "../../helpers/seed-user";
import type { AuthedUser } from "@/server/auth/guards";

const PASSWORD = "Correct-Horse-Battery-Staple-9";

function actorFrom(user: { _id: unknown; name: string; email: string; role: string }): AuthedUser {
  return { id: String(user._id), name: user.name, email: user.email, role: user.role as AuthedUser["role"] };
}

describe("credits.service — createCredit (Section 6.4)", () => {
  afterEach(async () => {
    await clearAllCollections();
  });

  it("increments the account balance and records the credit + ledger entry", async () => {
    const staff = await seedUser({ name: "Staff", email: `cred1-${Date.now()}@example.com`, password: PASSWORD, role: "staff" });
    const actor = actorFrom(staff);
    const account = await seedAccount({ openingBalancePaise: 0, currentBalancePaise: 0 });

    const result = await createCredit(
      {
        amountPaise: 10_000_00,
        source: "Owner",
        reason: "Capital injection",
        category: "owner_capital",
        accountId: account._id.toString(),
        receivedAt: new Date("2026-07-05T00:00:00.000Z"),
        idempotencyKey: randomUUID(),
      },
      actor
    );

    expect(result.accountNewBalance).toBe(10_000_00);
    const updatedAccount = await AccountModel.findById(account._id).lean();
    expect(updatedAccount?.currentBalancePaise).toBe(10_000_00);

    const audit = await AuditLogModel.findOne({ action: "CREDIT_CREATED" }).lean();
    expect(audit).not.toBeNull();
  });

  it("a double-submit with the same idempotencyKey replays instead of double-applying", async () => {
    const staff = await seedUser({ name: "Staff2", email: `cred2-${Date.now()}@example.com`, password: PASSWORD, role: "staff" });
    const actor = actorFrom(staff);
    const account = await seedAccount({ openingBalancePaise: 0, currentBalancePaise: 0 });
    const idempotencyKey = randomUUID();

    const input = {
      amountPaise: 2_000_00,
      source: "Bank",
      reason: "Interest",
      category: "interest" as const,
      accountId: account._id.toString(),
      receivedAt: new Date("2026-07-05T00:00:00.000Z"),
      idempotencyKey,
    };

    await createCredit(input, actor);
    await expect(createCredit(input, actor)).rejects.toMatchObject({ code: "IDEMPOTENT_REPLAY" });

    const updatedAccount = await AccountModel.findById(account._id).lean();
    expect(updatedAccount?.currentBalancePaise).toBe(2_000_00);
  });
});

describe("credits.service — reverseCredit", () => {
  afterEach(async () => {
    await clearAllCollections();
  });

  it("restores the account balance (subtracts) and marks the credit reversed", async () => {
    const owner = await seedUser({ name: "Owner", email: `cred3-${Date.now()}@example.com`, password: PASSWORD, role: "owner" });
    const actor = actorFrom(owner);
    const account = await seedAccount({ openingBalancePaise: 0, currentBalancePaise: 0 });

    const created = await createCredit(
      {
        amountPaise: 5_000_00,
        source: "Loan",
        reason: "Short-term loan",
        category: "loan",
        accountId: account._id.toString(),
        receivedAt: new Date("2026-07-05T00:00:00.000Z"),
        idempotencyKey: randomUUID(),
      },
      actor
    );

    const reversed = await reverseCredit(
      { creditId: created.credit._id.toString(), reason: "Loan cancelled", idempotencyKey: randomUUID() },
      actor
    );

    expect(reversed.accountNewBalance).toBe(0);
    const updatedCredit = await CreditModel.findById(created.credit._id).lean();
    expect(updatedCredit?.status).toBe("reversed");
  });

  it("reversing an already-reversed credit is a CONFLICT", async () => {
    const owner = await seedUser({ name: "Owner2", email: `cred4-${Date.now()}@example.com`, password: PASSWORD, role: "owner" });
    const actor = actorFrom(owner);
    const account = await seedAccount({ openingBalancePaise: 0, currentBalancePaise: 0 });

    const created = await createCredit(
      {
        amountPaise: 1_000_00,
        source: "Refund",
        reason: "Vendor refund",
        category: "refund",
        accountId: account._id.toString(),
        receivedAt: new Date("2026-07-05T00:00:00.000Z"),
        idempotencyKey: randomUUID(),
      },
      actor
    );

    await reverseCredit(
      { creditId: created.credit._id.toString(), reason: "First reversal", idempotencyKey: randomUUID() },
      actor
    );

    await expect(
      reverseCredit(
        { creditId: created.credit._id.toString(), reason: "Second attempt", idempotencyKey: randomUUID() },
        actor
      )
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
