import type { ClientSession } from "mongoose";
import { Types } from "mongoose";

import { db } from "@/database/connection";
import { AccountModel } from "@/database/models/account.model";
import { assertCreated } from "@/server/repositories/assert-created";
import type { AccountType } from "@/constants/domain";

export async function findAccountById(id: string) {
  await db();
  if (!Types.ObjectId.isValid(id)) return null;
  return AccountModel.findById(id).lean();
}

export async function findAccountsByIds(ids: string[]) {
  await db();
  const validIds = ids.filter((id) => Types.ObjectId.isValid(id));
  return AccountModel.find({ _id: { $in: validIds } }).lean();
}

export async function findAllActiveAccounts() {
  await db();
  return AccountModel.find({ status: "active" }).sort({ name: 1 }).lean();
}

export async function findAllAccounts() {
  await db();
  return AccountModel.find({}).sort({ name: 1 }).lean();
}

/**
 * Section 6.1 step 5 / 6.3 step 4 / 6.5 step 3 — the ONE balance-mutating
 * update. Requires status:"active" in the filter (an archived/just-
 * archived account can't silently receive a balance change); a null
 * result means the account isn't active right now, which the service
 * layer treats as a failure.
 */
export async function incrementAccountBalance(
  accountId: string,
  deltaPaise: number,
  session: ClientSession
) {
  await db();
  return AccountModel.findOneAndUpdate(
    { _id: new Types.ObjectId(accountId), status: "active" },
    { $inc: { currentBalancePaise: deltaPaise } },
    { session, returnDocument: "after" }
  ).lean();
}

export type InsertAccountInput = {
  name: string;
  type: AccountType;
  openingBalancePaise: number;
  bankName?: string | null;
  last4?: string | null;
  lowBalanceThresholdPaise?: number | null;
  isDefault: boolean;
};

// Section 6.9 — createAccount. currentBalancePaise starts equal to the
// opening balance (Section 4.3: accountBalance = opening + ΣIN − ΣOUT,
// and there are zero transactions yet).
export async function insertAccount(input: InsertAccountInput, session: ClientSession) {
  await db();
  const [doc] = await AccountModel.create(
    [
      {
        name: input.name,
        type: input.type,
        openingBalancePaise: input.openingBalancePaise,
        currentBalancePaise: input.openingBalancePaise,
        bankName: input.bankName ?? null,
        last4: input.last4 ?? null,
        lowBalanceThresholdPaise: input.lowBalanceThresholdPaise ?? null,
        isDefault: input.isDefault,
      },
    ],
    { session }
  );
  return assertCreated(doc, "account");
}

/** Section 6.9 — exactly one account may be default; unsetting every
 * other account's flag in the same transaction as setting the new one
 * keeps that invariant atomic. */
export async function unsetAllDefaultAccounts(session: ClientSession) {
  await db();
  await AccountModel.updateMany({ isDefault: true }, { $set: { isDefault: false } }, { session });
}

export type AccountPatch = Partial<{
  name: string;
  type: AccountType;
  bankName: string | null;
  last4: string | null;
  lowBalanceThresholdPaise: number | null;
  isDefault: boolean;
}>;

/** Section 6.9 — optimistic-lock update for every field EXCEPT
 * openingBalancePaise (that one is owner-only and re-derives
 * currentBalancePaise too — see setAccountOpeningBalance). */
export async function updateAccountOptimistic(
  accountId: string,
  version: number,
  patch: AccountPatch,
  session?: ClientSession
) {
  await db();
  return AccountModel.findOneAndUpdate(
    { _id: new Types.ObjectId(accountId), version },
    { $set: patch, $inc: { version: 1 } },
    { returnDocument: "after", ...(session ? { session } : {}) }
  ).lean();
}

/**
 * Section 6.9/14 edge case 23 — owner-only opening-balance edit.
 * currentBalancePaise must move by the exact same delta so the Section
 * 4.3 invariant (balance = opening + ΣIN − ΣOUT) stays true without
 * touching a single ledger transaction (Law 3 — the ledger is
 * immutable; only the account's own opening figure changes).
 */
export async function setAccountOpeningBalance(
  accountId: string,
  version: number,
  newOpeningBalancePaise: number,
  deltaPaise: number,
  session: ClientSession
) {
  await db();
  return AccountModel.findOneAndUpdate(
    { _id: new Types.ObjectId(accountId), version },
    {
      $set: { openingBalancePaise: newOpeningBalancePaise },
      $inc: { currentBalancePaise: deltaPaise, version: 1 },
    },
    { session, returnDocument: "after" }
  ).lean();
}

/**
 * Section 6.9/14 edge case 18 — archive is only permitted at exactly
 * zero balance; filtering on currentBalancePaise:0 makes the check and
 * the write atomic against a concurrent mutation instead of a separate
 * read-then-write race.
 */
export async function setAccountArchived(accountId: string, version: number, session: ClientSession) {
  await db();
  return AccountModel.findOneAndUpdate(
    { _id: new Types.ObjectId(accountId), version, status: "active", currentBalancePaise: 0 },
    { $set: { status: "archived", archivedAt: new Date(), isDefault: false }, $inc: { version: 1 } },
    { session, returnDocument: "after" }
  ).lean();
}

/**
 * Section 6.8D/14 edge case 24 — reconciliation-drift lock. Locking sets
 * status quo mutations to reject (every money-mutating service already
 * checks `account.reconcileLock`, M3/M4); unlocking is the owner's
 * resolve step (reconciliation.service.ts#resolveReconciliation).
 */
export async function setAccountReconcileLock(accountId: string, locked: boolean) {
  await db();
  return AccountModel.findOneAndUpdate(
    { _id: new Types.ObjectId(accountId) },
    { $set: { reconcileLock: locked } },
    { returnDocument: "after" }
  ).lean();
}

/** Section 14 edge case 19 — an archived account with a name collision
 * against an active one is fine (the unique index is partial on
 * status:"active"); this only checks for an EXISTING active collision,
 * used to surface a friendly VALIDATION error instead of a raw E11000. */
export async function findActiveAccountByName(name: string) {
  await db();
  return AccountModel.findOne({ name, status: "active" }).lean();
}
