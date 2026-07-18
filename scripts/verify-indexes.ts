/**
 * Section 9/15 — M8 hardening gate: every hot query named in a Section 5
 * index-justification comment must actually use an index, never a
 * COLLSCAN. Run with: `npx tsx scripts/verify-indexes.ts`.
 *
 * This connects to whatever MONGODB_URI is configured (the local Docker
 * replica set in dev) and runs `.explain("executionStats")` against a
 * representative query for every declared index, walking the winning
 * plan's `inputStage` chain (aggregation/sort pipelines nest stages) to
 * confirm a COLLSCAN never appears anywhere in it.
 *
 * Caveat: on a near-empty collection, MongoDB's cost-based multi-plan
 * trial can pick COLLSCAN vs IXSCAN close to arbitrarily (both examine ~0
 * docs, so neither "wins" meaningfully) — this genuinely happened while
 * authoring this script against a near-empty dev DB. For a trustworthy
 * signal, run this AFTER `scripts/reconcile-fuzz.ts` has populated
 * realistic data volume, not against a freshly-seeded database.
 */
import { config as loadDotenv } from "dotenv";
loadDotenv({ path: ".env" });
loadDotenv({ path: ".env.local", override: true });

type PlanStage = {
  stage?: string;
  inputStage?: PlanStage;
  inputStages?: PlanStage[];
  queryPlanner?: { winningPlan?: PlanStage };
  winningPlan?: PlanStage;
  executionStats?: { executionStages?: PlanStage };
};

function collectStages(stage: PlanStage | undefined, acc: string[] = []): string[] {
  if (!stage) return acc;
  if (stage.stage) acc.push(stage.stage);
  if (stage.inputStage) collectStages(stage.inputStage, acc);
  if (stage.inputStages) for (const s of stage.inputStages) collectStages(s, acc);
  return acc;
}

/** Mongoose's `.explain()` return type is tied to the query's document
 * type, not the actual explain-output shape it returns at runtime — this
 * narrows it back to `PlanStage` in one place instead of casting at
 * every call site. */
function explainOf(query: { explain: (verbosity: string) => Promise<unknown> }): Promise<PlanStage> {
  return query.explain("executionStats") as Promise<PlanStage>;
}

type Check = {
  label: string;
  run: () => Promise<PlanStage>;
};

async function main() {
  const { db } = await import("@/database/connection");
  const { ClientModel } = await import("@/database/models/client.model");
  const { MonthlyBillingModel } = await import("@/database/models/monthly-billing.model");
  const { PaymentModel } = await import("@/database/models/payment.model");
  const { AccountModel } = await import("@/database/models/account.model");
  const { TransactionModel } = await import("@/database/models/transaction.model");
  const { ExpenseModel } = await import("@/database/models/expense.model");
  const { CreditModel } = await import("@/database/models/credit.model");
  const { NotificationModel } = await import("@/database/models/notification.model");
  const { AuditLogModel } = await import("@/database/models/audit-log.model");
  const { UserModel } = await import("@/database/models/user.model");
  const { Types } = await import("mongoose");

  await db();

  const oid = new Types.ObjectId();

  const checks: Check[] = [
    {
      label: "users {email:1} — findUserByEmail",
      run: () => explainOf(UserModel.find({ email: "nobody@example.com" })),
    },
    {
      label: "clients {status:1,nextDueDate:1} — /clients default list + rollover scan",
      run: () => explainOf(ClientModel.find({ status: "active" }).sort({ nextDueDate: 1 })),
    },
    {
      label: "clients {engagementType:1,status:1} — rollover cron filter",
      run: () =>
        explainOf(ClientModel.find({ status: "active", engagementType: "retainer" })),
    },
    {
      label: "monthlybillings {clientId:1,monthKey:1} — findBillingByClientAndMonth",
      run: () => explainOf(MonthlyBillingModel.find({ clientId: oid, monthKey: "2026-07" })),
    },
    {
      label: "monthlybillings {monthKey:1,status:1} — getMonthOverview aggregation",
      run: () => explainOf(MonthlyBillingModel.find({ monthKey: "2026-07" })),
    },
    {
      label: "monthlybillings {status:1,dueDate:1} — getDuesList / due-reminder scan",
      run: () =>
        explainOf(MonthlyBillingModel.find({ status: { $in: ["PENDING", "PARTIALLY_PAID"] } })),
    },
    {
      label: "payments {clientId:1,paidAt:-1} — client payment trail",
      run: () => explainOf(PaymentModel.find({ clientId: oid }).sort({ paidAt: -1 })),
    },
    {
      label: "payments {accountId:1,paidAt:-1} — account activity filtered to payments",
      run: () => explainOf(PaymentModel.find({ accountId: oid }).sort({ paidAt: -1 })),
    },
    {
      label: "accounts {status:1,name:1} — /ledger/accounts listing",
      run: () => explainOf(AccountModel.find({ status: "active" }).sort({ name: 1 })),
    },
    {
      label: "transactions {accountId:1,occurredAt:-1} — account activity",
      run: () => explainOf(TransactionModel.find({ accountId: oid }).sort({ occurredAt: -1 })),
    },
    {
      label: "transactions {monthKey:1,type:1,status:1} — sumByTypeAndMonth",
      run: () =>
        explainOf(TransactionModel.find({ monthKey: "2026-07", type: { $in: ["PAYMENT_IN"] }, status: "active" })),
    },
    {
      label: "transactions {clientId:1,occurredAt:-1} — client-scoped ledger reads",
      run: () => explainOf(TransactionModel.find({ clientId: oid }).sort({ occurredAt: -1 })),
    },
    {
      label: "transactions {transactionGroupId:1} — transfer leg lookup",
      run: () => explainOf(TransactionModel.find({ transactionGroupId: oid })),
    },
    {
      label: "expenses {category:1,spentAt:-1} — /ledger/expenses filtered list",
      run: () => explainOf(ExpenseModel.find({ category: "misc" }).sort({ spentAt: -1 })),
    },
    {
      label: "expenses {accountId:1,spentAt:-1} — account activity filtered to expenses",
      run: () => explainOf(ExpenseModel.find({ accountId: oid }).sort({ spentAt: -1 })),
    },
    {
      label: "credits {category:1,receivedAt:-1} — /ledger/credits filtered list",
      run: () => explainOf(CreditModel.find({ category: "interest" }).sort({ receivedAt: -1 })),
    },
    {
      label: "notifications {isRead:1,createdAt:-1} — /notifications + bell feed",
      run: () => explainOf(NotificationModel.find({ isRead: false }).sort({ createdAt: -1 })),
    },
    {
      label: "auditlogs {entity.kind:1,entity.id:1,createdAt:-1} — entity activity tab",
      run: () =>
        explainOf(
          AuditLogModel.find({ "entity.kind": "client", "entity.id": oid }).sort({ createdAt: -1 })
        ),
    },
    {
      label: "auditlogs {action:1,createdAt:-1} — /audit filtered list",
      run: () => explainOf(AuditLogModel.find({ action: "PAYMENT_RECORDED" }).sort({ createdAt: -1 })),
    },
  ];

  let failed = 0;
  for (const check of checks) {
    const explanation = await check.run();
    const winningPlan = explanation.queryPlanner?.winningPlan ?? explanation.winningPlan;
    const stages = collectStages(winningPlan);
    const hasCollscan = stages.includes("COLLSCAN");
    if (hasCollscan) {
      failed += 1;
      console.error(`✗ COLLSCAN: ${check.label}\n    stages: ${stages.join(" -> ")}`);
    } else {
      console.log(`✓ ${check.label} (${stages.join(" -> ") || "no stages"})`);
    }
  }

  console.log(`\n${checks.length - failed}/${checks.length} queries use an index; ${failed} COLLSCAN(s).`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error) => {
    console.error("verify-indexes failed:", error);
    process.exit(1);
  });
