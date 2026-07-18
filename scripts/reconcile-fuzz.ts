/**
 * Section 15/M8 hardening — 10,000 random VALID financial operations
 * (expenses, credits, transfers, payments, and their reversals), then
 * assert the ledger reconciles perfectly: every account's derived balance
 * equals its materialized balance, and every touched month's
 * getMonthOverview shows no internal ledger inconsistency.
 *
 * Runs against an ISOLATED scratch database (the configured MONGODB_URI's
 * database name with a `_fuzz` suffix) so this can never touch real dev
 * data, and drops that scratch database when done (pass --keep to skip
 * that for post-mortem debugging).
 *
 * Usage: `npx tsx scripts/reconcile-fuzz.ts [--ops 10000] [--keep]`
 */
import { randomUUID } from "node:crypto";
import { config as loadDotenv } from "dotenv";

loadDotenv({ path: ".env" });
loadDotenv({ path: ".env.local", override: true });

const originalUri = process.env.MONGODB_URI ?? "";
const fuzzUri = originalUri.replace(/\/([^/?]+)(\?|$)/, "/$1_fuzz$2");
process.env.MONGODB_URI = fuzzUri;

const args = process.argv.slice(2);
const opsFlagIndex = args.indexOf("--ops");
const TOTAL_OPS = opsFlagIndex >= 0 ? Number(args[opsFlagIndex + 1]) : 10_000;
const KEEP = args.includes("--keep");

function pick<T>(arr: T[]): T {
  const item = arr[Math.floor(Math.random() * arr.length)];
  if (item === undefined) throw new Error("pick() called on an empty array");
  return item;
}

function randomAmountPaise(maxRupees = 5000): number {
  return (Math.floor(Math.random() * maxRupees) + 1) * 100;
}

async function main() {
  console.log(`Scratch database: ${fuzzUri}`);
  console.log(`Running ${TOTAL_OPS} random valid operations...\n`);

  const mongoose = await import("mongoose");
  const { db } = await import("@/database/connection");
  const { UserModel } = await import("@/database/models/user.model");
  const accountsService = await import("@/server/services/accounts.service");
  const expensesService = await import("@/server/services/expenses.service");
  const creditsService = await import("@/server/services/credits.service");
  const transfersService = await import("@/server/services/transfers.service");
  const clientsService = await import("@/server/services/clients.service");
  const paymentsService = await import("@/server/services/payments.service");
  const financialEngine = await import("@/server/services/financial-engine");
  // Reused directly (not reimplemented) so this script's month bucketing
  // can never diverge from the app's canonical IST-boundary logic
  // (lib/dates.ts's own extensive IST-vs-UTC-midnight reasoning applies
  // here just as much as anywhere else — Law 10, no duplicated logic).
  const { toMonthKey } = await import("@/lib/dates");

  await db();

  const owner = await UserModel.create({
    name: "Fuzz Owner",
    email: `fuzz-owner-${Date.now()}@example.com`,
    emailVerified: true,
    role: "owner",
    isActive: true,
    failedLoginAttempts: 0,
    lockedUntil: null,
    lastLoginAt: null,
    mustChangePassword: false,
  });
  const actor = { id: owner._id.toString(), name: owner.name, email: owner.email, role: "owner" as const };

  console.log("Seeding 5 accounts and 20 clients...");
  const accounts = [];
  for (let i = 0; i < 5; i++) {
    const account = await accountsService.createAccount(
      { name: `Fuzz Account ${i}`, type: "bank", openingBalancePaise: 500_000_00 },
      actor
    );
    accounts.push(account);
  }

  const billings: Array<{ clientId: string; billingId: string }> = [];
  for (let i = 0; i < 20; i++) {
    const engagementType = i % 3 === 0 ? ("one_time" as const) : ("retainer" as const);
    const { client, billing } = await clientsService.createClient(
      {
        name: `Fuzz Client ${i}`,
        service: "Bookkeeping",
        engagementType,
        amountPaise: (i + 1) * 1_000_00,
        nextDueDate: new Date(),
      },
      actor
    );
    billings.push({ clientId: client._id.toString(), billingId: billing._id.toString() });
  }

  const activeExpenses: string[] = [];
  const activeCredits: string[] = [];
  const activeTransferGroups: string[] = [];

  let created = 0;
  let reversed = 0;
  let failed = 0;
  const failures: string[] = [];

  const touchedMonthKeys = new Set<string>();

  for (let i = 0; i < TOTAL_OPS; i++) {
    const roll = Math.random();
    try {
      if (roll < 0.25) {
        const account = pick(accounts);
        const spentAt = new Date();
        const result = await expensesService.createExpense(
          {
            amountPaise: randomAmountPaise(),
            reason: "Fuzz expense",
            paidToEntity: "Fuzz Vendor",
            category: "misc",
            accountId: account._id.toString(),
            spentAt,
            overrideNegativeBalance: true, // owner actor: always a VALID op regardless of balance
            idempotencyKey: `fuzz-exp-${i}-${randomUUID()}`,
          },
          actor
        );
        activeExpenses.push(result.expense._id.toString());
        touchedMonthKeys.add(toMonthKey(spentAt));
        created++;
      } else if (roll < 0.45) {
        const account = pick(accounts);
        const receivedAt = new Date();
        const result = await creditsService.createCredit(
          {
            amountPaise: randomAmountPaise(),
            source: "Fuzz Source",
            reason: "Fuzz credit",
            category: "other",
            accountId: account._id.toString(),
            receivedAt,
            idempotencyKey: `fuzz-cred-${i}-${randomUUID()}`,
          },
          actor
        );
        activeCredits.push(result.credit._id.toString());
        touchedMonthKeys.add(toMonthKey(receivedAt));
        created++;
      } else if (roll < 0.65) {
        const from = pick(accounts);
        let to = pick(accounts);
        while (to._id.toString() === from._id.toString()) to = pick(accounts);
        const occurredAt = new Date();
        const result = await transfersService.transferBetweenAccounts(
          {
            fromAccountId: from._id.toString(),
            toAccountId: to._id.toString(),
            amountPaise: randomAmountPaise(),
            occurredAt,
            overrideNegativeBalance: true,
            idempotencyKey: `fuzz-tr-${i}-${randomUUID()}`,
          },
          actor
        );
        activeTransferGroups.push(result.groupId);
        touchedMonthKeys.add(toMonthKey(occurredAt));
        created++;
      } else if (roll < 0.8) {
        const target = pick(billings);
        const paidAt = new Date();
        const result = await paymentsService.recordPayment(
          {
            clientId: target.clientId,
            monthlyBillingId: target.billingId,
            amountPaise: randomAmountPaise(2000),
            accountId: pick(accounts)._id.toString(),
            paidAt,
            method: "upi",
            invoiceNumber: `FUZZ-INV-${i}-${randomUUID()}`,
            receiptNumber: `FUZZ-RCP-${i}-${randomUUID()}`,
            idempotencyKey: `fuzz-pay-${i}-${randomUUID()}`,
          },
          actor
        );
        void result;
        // Approximation: a payment's real monthKey follows its BILLING
        // (Section 14 edge case 3), not paidAt directly. In practice this
        // fuzz run completes in well under a month, so billing.monthKey
        // (set at client-creation time, toMonthKey(nextDueDate)) and
        // toMonthKey(paidAt) coincide.
        touchedMonthKeys.add(toMonthKey(paidAt));
        created++;
      } else if (roll < 0.9 && activeExpenses.length > 0) {
        const idx = Math.floor(Math.random() * activeExpenses.length);
        const expenseId = activeExpenses.splice(idx, 1)[0];
        if (expenseId) {
          await expensesService.reverseExpense(
            { expenseId, reason: "Fuzz reversal", idempotencyKey: `fuzz-exp-rev-${i}-${randomUUID()}` },
            actor
          );
          reversed++;
        }
      } else if (roll < 0.95 && activeCredits.length > 0) {
        const idx = Math.floor(Math.random() * activeCredits.length);
        const creditId = activeCredits.splice(idx, 1)[0];
        if (creditId) {
          await creditsService.reverseCredit(
            { creditId, reason: "Fuzz reversal", idempotencyKey: `fuzz-cred-rev-${i}-${randomUUID()}` },
            actor
          );
          reversed++;
        }
      } else if (activeTransferGroups.length > 0) {
        const idx = Math.floor(Math.random() * activeTransferGroups.length);
        const groupId = activeTransferGroups.splice(idx, 1)[0];
        if (groupId) {
          await transfersService.reverseTransfer(
            { transactionGroupId: groupId, reason: "Fuzz reversal", idempotencyKey: `fuzz-tr-rev-${i}-${randomUUID()}` },
            actor
          );
          reversed++;
        }
      }
    } catch (error) {
      failed++;
      failures.push(error instanceof Error ? error.message : String(error));
    }

    if ((i + 1) % 1000 === 0) {
      console.log(`  ...${i + 1}/${TOTAL_OPS} ops (${created} created, ${reversed} reversed, ${failed} failed)`);
    }
  }

  console.log(`\nDone: ${created} created, ${reversed} reversed, ${failed} failed (unexpected errors).`);
  if (failed > 0) {
    console.log("Sample failures:", failures.slice(0, 5));
  }

  console.log("\nReconciling every account (derived vs materialized balance)...");
  const report = await financialEngine.reconcileAll();
  for (const account of report.accounts) {
    console.log(`  ${account.name}: drift = ${account.driftPaise} paise`);
  }

  console.log("\nChecking every touched month's ledger-internal consistency...");
  let monthErrors = 0;
  for (const monthKey of touchedMonthKeys) {
    const overview = await financialEngine.getMonthOverview(monthKey);
    if (overview.reconciliationError) {
      monthErrors++;
      console.error(`  ✗ ${monthKey}: reconciliationError`);
    }
  }
  if (monthErrors === 0) {
    console.log(`  ✓ all ${touchedMonthKeys.size} touched month(s) reconcile internally.`);
  }

  const ok = !report.hasDrift && monthErrors === 0 && failed === 0;
  console.log(`\n${ok ? "PASS" : "FAIL"}: reconcile-fuzz (${TOTAL_OPS} ops)`);

  if (!KEEP) {
    console.log("\nDropping scratch database...");
    await mongoose.default.connection.dropDatabase();
    console.log("Done.");
  } else {
    console.log(`\n--keep passed — scratch database "${fuzzUri}" left in place for inspection.`);
  }

  process.exitCode = ok ? 0 : 1;
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error) => {
    console.error("reconcile-fuzz failed:", error);
    process.exit(1);
  });
