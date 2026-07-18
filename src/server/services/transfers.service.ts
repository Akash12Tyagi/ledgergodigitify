import { Types } from "mongoose";

import { AppError } from "@/lib/errors";
import { withDbTransaction } from "@/lib/db-transaction";
import { runWithIdempotency } from "@/lib/idempotency";
import { isAfterTodayIST, toMonthKey } from "@/lib/dates";
import { formatINR } from "@/lib/money";
import { findAccountById, incrementAccountBalance } from "@/server/repositories/accounts.repository";
import {
  findTransactionByIdempotencyKey,
  findTransactionsByGroupId,
  insertTransaction,
  markTransactionReversed,
} from "@/server/repositories/transactions.repository";
import { logAudit } from "@/server/services/audit.service";
import type { AuthedUser } from "@/server/auth/guards";
import type { ReverseTransferInput, TransferInput } from "@/schemas/account.schema";

export type TransferResult = {
  groupId: string;
  fromAccountId: string;
  toAccountId: string;
  amountPaise: number;
  fromNewBalance: number;
  toNewBalance: number;
};

// Section 6.5 — transferBetweenAccounts. A transfer has no standalone
// document — it's exactly two Transaction rows (OUT on `from`, IN on
// `to`) sharing a transactionGroupId, inserted and balance-applied
// atomically (Law 4). Role: admin+ (enforced by the action wrapper).
export async function transferBetweenAccounts(input: TransferInput, actor: AuthedUser): Promise<TransferResult> {
  // Each leg needs its own unique idempotencyKey (the transactions
  // collection enforces uniqueness per-document), derived deterministically
  // from the caller's key so a replay finds the same pair every time.
  const outKey = `${input.idempotencyKey}:out`;
  const inKey = `${input.idempotencyKey}:in`;

  return runWithIdempotency({
    fetchExisting: async () => {
      const outTx = await findTransactionByIdempotencyKey(outKey);
      if (!outTx || !outTx.transactionGroupId) return null;
      const legs = await findTransactionsByGroupId(outTx.transactionGroupId.toString());
      const inTx = legs.find((t) => t.direction === "IN");
      const fromAccount = await findAccountById(outTx.accountId.toString());
      const toAccount = inTx ? await findAccountById(inTx.accountId.toString()) : null;
      return {
        groupId: outTx.transactionGroupId.toString(),
        fromAccountId: outTx.accountId.toString(),
        toAccountId: inTx ? inTx.accountId.toString() : "",
        amountPaise: outTx.amountPaise,
        fromNewBalance: fromAccount?.currentBalancePaise ?? 0,
        toNewBalance: toAccount?.currentBalancePaise ?? 0,
      };
    },
    run: () =>
      withDbTransaction(async (session) => {
        const fromAccount = await findAccountById(input.fromAccountId);
        if (!fromAccount || fromAccount.status !== "active") {
          throw new AppError("VALIDATION", "Source account is not active");
        }
        if (fromAccount.reconcileLock) {
          throw new AppError(
            "LOCKED",
            "The source account is locked pending reconciliation. Resolve it in Settings before transferring."
          );
        }
        const toAccount = await findAccountById(input.toAccountId);
        if (!toAccount || toAccount.status !== "active") {
          throw new AppError("VALIDATION", "Destination account is not active");
        }
        if (toAccount.reconcileLock) {
          throw new AppError(
            "LOCKED",
            "The destination account is locked pending reconciliation. Resolve it in Settings before transferring."
          );
        }
        if (isAfterTodayIST(input.occurredAt)) {
          throw new AppError("VALIDATION", "Transfer date cannot be in the future.");
        }

        // Section 6.3's insufficient-balance rule applies to the `from`
        // leg, owner override honored the same way as createExpense.
        const wouldBePaise = fromAccount.currentBalancePaise - input.amountPaise;
        const effectiveOverride = input.overrideNegativeBalance === true && actor.role === "owner";
        if (wouldBePaise < 0 && !effectiveOverride) {
          throw new AppError(
            "INSUFFICIENT_BALANCE",
            `${fromAccount.name} has ${formatINR(fromAccount.currentBalancePaise)}. This transfer needs ${formatINR(-wouldBePaise)} more.`,
            { data: { balancePaise: fromAccount.currentBalancePaise, shortfallPaise: -wouldBePaise } }
          );
        }

        const groupId = new Types.ObjectId();
        const monthKey = toMonthKey(input.occurredAt);

        await insertTransaction(
          {
            type: "TRANSFER",
            direction: "OUT",
            amountPaise: input.amountPaise,
            accountId: input.fromAccountId,
            occurredAt: input.occurredAt,
            monthKey,
            counterpartyLabel: toAccount.name,
            transactionGroupId: groupId,
            note: input.note ?? null,
            idempotencyKey: outKey,
            createdBy: actor.id,
          },
          session
        );

        await insertTransaction(
          {
            type: "TRANSFER",
            direction: "IN",
            amountPaise: input.amountPaise,
            accountId: input.toAccountId,
            occurredAt: input.occurredAt,
            monthKey,
            counterpartyLabel: fromAccount.name,
            transactionGroupId: groupId,
            note: input.note ?? null,
            idempotencyKey: inKey,
            createdBy: actor.id,
          },
          session
        );

        const updatedFrom = await incrementAccountBalance(input.fromAccountId, -input.amountPaise, session);
        if (!updatedFrom) throw new AppError("VALIDATION", "Source account is not active");
        const updatedTo = await incrementAccountBalance(input.toAccountId, input.amountPaise, session);
        if (!updatedTo) throw new AppError("VALIDATION", "Destination account is not active");

        await logAudit(
          {
            actorUserId: actor.id,
            actorName: actor.name,
            action: "TRANSFER_CREATED",
            entity: { kind: "transfer", id: groupId },
            after: {
              fromAccountId: input.fromAccountId,
              toAccountId: input.toAccountId,
              amountPaise: input.amountPaise,
              fromNewBalance: updatedFrom.currentBalancePaise,
              toNewBalance: updatedTo.currentBalancePaise,
            },
            summary: `${actor.name} transferred ${formatINR(input.amountPaise)} from ${fromAccount.name} to ${toAccount.name}${effectiveOverride ? " (balance override)" : ""}`,
          },
          session
        );

        return {
          groupId: groupId.toString(),
          fromAccountId: input.fromAccountId,
          toAccountId: input.toAccountId,
          amountPaise: input.amountPaise,
          fromNewBalance: updatedFrom.currentBalancePaise,
          toNewBalance: updatedTo.currentBalancePaise,
        };
      }),
  });
}

// Section 6.5 — reversal undoes BOTH legs atomically. Role: admin+.
export async function reverseTransfer(input: ReverseTransferInput, actor: AuthedUser): Promise<TransferResult> {
  const outKey = `${input.idempotencyKey}:out`;
  const inKey = `${input.idempotencyKey}:in`;

  return runWithIdempotency({
    fetchExisting: async () => {
      const outTx = await findTransactionByIdempotencyKey(outKey);
      if (!outTx) return null;
      const legs = await findTransactionsByGroupId(input.transactionGroupId);
      const original = legs.find((t) => t.type === "TRANSFER" && t.direction === "OUT");
      const originalIn = legs.find((t) => t.type === "TRANSFER" && t.direction === "IN");
      if (!original || !originalIn) return null;
      const fromAccount = await findAccountById(original.accountId.toString());
      const toAccount = await findAccountById(originalIn.accountId.toString());
      return {
        groupId: input.transactionGroupId,
        fromAccountId: original.accountId.toString(),
        toAccountId: originalIn.accountId.toString(),
        amountPaise: original.amountPaise,
        fromNewBalance: fromAccount?.currentBalancePaise ?? 0,
        toNewBalance: toAccount?.currentBalancePaise ?? 0,
      };
    },
    run: () =>
      withDbTransaction(async (session) => {
        const legs = await findTransactionsByGroupId(input.transactionGroupId);
        const outLeg = legs.find((t) => t.type === "TRANSFER" && t.direction === "OUT");
        const inLeg = legs.find((t) => t.type === "TRANSFER" && t.direction === "IN");
        if (!outLeg || !inLeg) throw new AppError("NOT_FOUND", "Transfer not found");
        if (outLeg.status !== "active" || inLeg.status !== "active") {
          throw new AppError("CONFLICT", "Already reversed. Record a fresh transfer instead.");
        }

        const groupId = new Types.ObjectId();

        // Undo the OUT leg with a reversal IN on the same (from) account,
        // and the IN leg with a reversal OUT on the same (to) account —
        // each keeps the original leg's own monthKey (Section 14 edge
        // case 3's rule).
        await insertTransaction(
          {
            type: "REVERSAL",
            direction: "IN",
            amountPaise: outLeg.amountPaise,
            accountId: outLeg.accountId.toString(),
            occurredAt: new Date(),
            monthKey: outLeg.monthKey,
            transactionGroupId: groupId,
            reversesTransactionId: outLeg._id.toString(),
            counterpartyLabel: null,
            idempotencyKey: outKey,
            createdBy: actor.id,
          },
          session
        );
        await insertTransaction(
          {
            type: "REVERSAL",
            direction: "OUT",
            amountPaise: inLeg.amountPaise,
            accountId: inLeg.accountId.toString(),
            occurredAt: new Date(),
            monthKey: inLeg.monthKey,
            transactionGroupId: groupId,
            reversesTransactionId: inLeg._id.toString(),
            counterpartyLabel: null,
            idempotencyKey: inKey,
            createdBy: actor.id,
          },
          session
        );

        await markTransactionReversed(outLeg._id.toString(), session);
        await markTransactionReversed(inLeg._id.toString(), session);

        const updatedFrom = await incrementAccountBalance(outLeg.accountId.toString(), outLeg.amountPaise, session);
        if (!updatedFrom) throw new AppError("VALIDATION", "Source account is not active");
        const updatedTo = await incrementAccountBalance(inLeg.accountId.toString(), -inLeg.amountPaise, session);
        if (!updatedTo) throw new AppError("VALIDATION", "Destination account is not active");

        await logAudit(
          {
            actorUserId: actor.id,
            actorName: actor.name,
            action: "TRANSFER_REVERSED",
            entity: { kind: "transfer", id: input.transactionGroupId },
            before: { status: "active" },
            after: { status: "reversed" },
            summary: `${actor.name} reversed a ${formatINR(outLeg.amountPaise)} transfer (${input.reason})`,
          },
          session
        );

        return {
          groupId: input.transactionGroupId,
          fromAccountId: outLeg.accountId.toString(),
          toAccountId: inLeg.accountId.toString(),
          amountPaise: outLeg.amountPaise,
          fromNewBalance: updatedFrom.currentBalancePaise,
          toNewBalance: updatedTo.currentBalancePaise,
        };
      }),
  });
}
