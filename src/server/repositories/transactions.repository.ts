import type { ClientSession } from "mongoose";
import { Types } from "mongoose";

import { db } from "@/database/connection";
import { TransactionModel } from "@/database/models/transaction.model";
import { assertCreated } from "@/server/repositories/assert-created";
import type { TransactionDirection, TransactionType } from "@/constants/domain";
import type { TxFilter } from "@/types/engine";

const oid = (id: string) => new Types.ObjectId(id);

export type InsertTransactionInput = {
  /** Optional pre-generated id — needed when a Payment/Expense/Credit and
   * its Transaction mutually reference each other's id (see
   * payments.service.ts#recordPayment). */
  _id?: Types.ObjectId;
  type: TransactionType;
  direction: TransactionDirection;
  amountPaise: number;
  accountId: string;
  occurredAt: Date;
  monthKey: string;
  clientId?: string | null;
  paymentId?: string | null;
  expenseId?: string | null;
  creditId?: string | null;
  invoiceNumber?: string | null;
  receiptNumber?: string | null;
  counterpartyLabel?: string | null;
  transactionGroupId?: Types.ObjectId | null;
  reversesTransactionId?: string | null;
  note?: string | null;
  idempotencyKey: string;
  createdBy: string;
};

/** Section 5.6 — the ledger is append-only; this is the ONE insert path
 * every mutation (payment/expense/credit/transfer/reversal) uses. */
export async function insertTransaction(input: InsertTransactionInput, session: ClientSession) {
  await db();
  const [doc] = await TransactionModel.create(
    [
      {
        ...(input._id ? { _id: input._id } : {}),
        type: input.type,
        direction: input.direction,
        amountPaise: input.amountPaise,
        accountId: oid(input.accountId),
        occurredAt: input.occurredAt,
        monthKey: input.monthKey,
        clientId: input.clientId ? oid(input.clientId) : null,
        paymentId: input.paymentId ? oid(input.paymentId) : null,
        expenseId: input.expenseId ? oid(input.expenseId) : null,
        creditId: input.creditId ? oid(input.creditId) : null,
        invoiceNumber: input.invoiceNumber ?? null,
        receiptNumber: input.receiptNumber ?? null,
        counterpartyLabel: input.counterpartyLabel ?? null,
        transactionGroupId: input.transactionGroupId ?? null,
        reversesTransactionId: input.reversesTransactionId ? oid(input.reversesTransactionId) : null,
        note: input.note ?? null,
        idempotencyKey: input.idempotencyKey,
        createdBy: oid(input.createdBy),
      },
    ],
    { session }
  );
  return assertCreated(doc, "transaction");
}

export async function findTransactionByIdempotencyKey(idempotencyKey: string) {
  await db();
  return TransactionModel.findOne({ idempotencyKey }).lean();
}

/** Section 6.5 — a transfer is two Transaction rows sharing a
 * transactionGroupId (no standalone "Transfer" collection); this is how
 * both legs are found together for display and for reverseTransfer. */
export async function findTransactionsByGroupId(groupId: string) {
  await db();
  if (!Types.ObjectId.isValid(groupId)) return [];
  return TransactionModel.find({ transactionGroupId: oid(groupId) }).lean();
}

/** Section 6.2 step 3 — the only permitted update to a ledger row (Law 3). */
export async function markTransactionReversed(id: string, session: ClientSession) {
  await db();
  await TransactionModel.updateOne({ _id: oid(id) }, { $set: { status: "reversed" } }, { session });
}

/**
 * Section 4.3 — Σ IN/OUT for an account, up to (and including) `asOf`.
 * The base of accountBalance(asOf).
 *
 * Deliberately NOT filtered to status:"active". A reversal doesn't erase
 * the original transaction's history (Law 3 — the ledger is immutable;
 * `markTransactionReversed` only flips a display/gating flag) — it adds
 * a SEPARATE, later transaction that moves the money back. Both the
 * original (now status:"reversed") and its reversal are real amounts
 * that really moved and must both count, or the balance overcounts by
 * the reversed amount every time (caught by scripts/reconcile-fuzz.ts —
 * excluding the original while including its reversal double-counts the
 * "money came back" side without ever counting the "money left" side).
 * Contrast with sumByTypeAndMonth, which correctly stays active-only
 * because it answers a different question ("how much genuine NEW
 * PAYMENT_IN/CREDIT_IN/EXPENSE_OUT activity happened this period," where
 * a reversed original correctly shouldn't count).
 */
export async function sumInOutForAccountAsOf(
  accountId: string,
  asOf?: Date
): Promise<{ inPaise: number; outPaise: number }> {
  await db();
  const match: Record<string, unknown> = { accountId: oid(accountId) };
  if (asOf) match.occurredAt = { $lte: asOf };

  const rows = await TransactionModel.aggregate<{ _id: "IN" | "OUT"; total: number }>([
    { $match: match },
    { $group: { _id: "$direction", total: { $sum: "$amountPaise" } } },
  ]);
  const inPaise = rows.find((r) => r._id === "IN")?.total ?? 0;
  const outPaise = rows.find((r) => r._id === "OUT")?.total ?? 0;
  return { inPaise, outPaise };
}

/**
 * Same shape as sumInOutForAccountAsOf, but for every account at once
 * (Section 9 — batch via $in, no N+1), filtered by the transaction's
 * stored `monthKey` — NOT an occurredAt date range.
 *
 * This must use the same filter dimension as sumByTypeAndMonth (collected/
 * credits/expenses), or the Section 4.3 "closing == opening + net" assert
 * becomes a false alarm: a payment whose monthKey follows its BILLING
 * (Section 5.4/14 edge case 3) can have an occurredAt in a different
 * calendar month than its monthKey. If perAccount in/out were date-range
 * based while collected/credits/expenses are monthKey-based, an entirely
 * correct, expected cross-month payment would trip reconciliationError on
 * every single occurrence. Keeping both aggregates on the monthKey
 * dimension makes the assert a pure ledger-consistency check (only fails
 * on genuine corruption, e.g. an unmatched transfer leg) instead of a
 * cash-timing check.
 *
 * Also deliberately NOT filtered to status:"active" — same reasoning as
 * sumInOutForAccountAsOf: a reversed original and its reversal are both
 * real balance-affecting events and must both count, or this overcounts
 * by the reversed amount (scripts/reconcile-fuzz.ts).
 */
export async function sumInOutByAccountForMonth(
  accountIds: string[],
  monthKey: string
): Promise<Map<string, { inPaise: number; outPaise: number }>> {
  await db();
  const validIds = accountIds.map(oid);
  const rows = await TransactionModel.aggregate<{
    _id: { accountId: Types.ObjectId; direction: "IN" | "OUT" };
    total: number;
  }>([
    {
      $match: {
        accountId: { $in: validIds },
        monthKey,
      },
    },
    {
      $group: {
        _id: { accountId: "$accountId", direction: "$direction" },
        total: { $sum: "$amountPaise" },
      },
    },
  ]);

  const result = new Map<string, { inPaise: number; outPaise: number }>();
  for (const id of accountIds) result.set(id, { inPaise: 0, outPaise: 0 });
  for (const row of rows) {
    const key = row._id.accountId.toString();
    const entry = result.get(key) ?? { inPaise: 0, outPaise: 0 };
    if (row._id.direction === "IN") entry.inPaise = row.total;
    else entry.outPaise = row.total;
    result.set(key, entry);
  }
  return result;
}

/**
 * Per-account net IN/OUT for every transaction with monthKey strictly
 * before `monthKey` — the monthKey-dimension equivalent of "account
 * balance as of the start of this month". "YYYY-MM" sorts correctly under
 * a plain string `$lt` comparison, so no date parsing is needed.
 *
 * Also deliberately NOT filtered to status:"active" — see
 * sumInOutForAccountAsOf's comment.
 */
export async function sumInOutByAccountBeforeMonth(
  accountIds: string[],
  monthKey: string
): Promise<Map<string, { inPaise: number; outPaise: number }>> {
  await db();
  const validIds = accountIds.map(oid);
  const rows = await TransactionModel.aggregate<{
    _id: { accountId: Types.ObjectId; direction: "IN" | "OUT" };
    total: number;
  }>([
    {
      $match: {
        accountId: { $in: validIds },
        monthKey: { $lt: monthKey },
      },
    },
    {
      $group: {
        _id: { accountId: "$accountId", direction: "$direction" },
        total: { $sum: "$amountPaise" },
      },
    },
  ]);

  const result = new Map<string, { inPaise: number; outPaise: number }>();
  for (const id of accountIds) result.set(id, { inPaise: 0, outPaise: 0 });
  for (const row of rows) {
    const key = row._id.accountId.toString();
    const entry = result.get(key) ?? { inPaise: 0, outPaise: 0 };
    if (row._id.direction === "IN") entry.inPaise = row.total;
    else entry.outPaise = row.total;
    result.set(key, entry);
  }
  return result;
}

/** Section 4.3 — Σ amountPaise for active transactions of the given
 * type(s) in a given monthKey (uses the stored monthKey field, matching
 * the {monthKey:1,type:1,status:1} index — Section 9: no date-range scan
 * needed for this aggregate). */
export async function sumByTypeAndMonth(
  monthKey: string,
  types: TransactionType[]
): Promise<number> {
  await db();
  const [result] = await TransactionModel.aggregate<{ total: number }>([
    { $match: { monthKey, type: { $in: types }, status: "active" } },
    { $group: { _id: null, total: { $sum: "$amountPaise" } } },
  ]);
  return result?.total ?? 0;
}

/** Grouped version of sumByTypeAndMonth for the 6-month sparkline — one
 * query instead of 12 (Section 9: zero N+1). */
export async function sumByTypeGroupedByMonth(
  monthKeys: string[],
  types: TransactionType[]
): Promise<Map<string, number>> {
  await db();
  const rows = await TransactionModel.aggregate<{ _id: string; total: number }>([
    { $match: { monthKey: { $in: monthKeys }, type: { $in: types }, status: "active" } },
    { $group: { _id: "$monthKey", total: { $sum: "$amountPaise" } } },
  ]);
  const result = new Map<string, number>();
  for (const mk of monthKeys) result.set(mk, 0);
  for (const row of rows) result.set(row._id, row.total);
  return result;
}

/** Expense-by-category needs the `expenses` collection (category lives
 * there, not on the transaction) — see expenses.repository.ts. This file
 * only aggregates the ledger itself. */

/** Dashboard "Recent Activity" — scoped to the selected monthKey so
 * navigating to a historical month doesn't silently keep showing today's
 * transactions (Task 2: every dashboard widget must refresh for the
 * selected month). */
export async function findRecentTransactions(monthKey: string, limit: number) {
  await db();
  return TransactionModel.find({ status: "active", monthKey })
    .sort({ occurredAt: -1, _id: -1 })
    .limit(limit)
    .lean();
}

/** Range-scoped sibling of findRecentTransactions, for the Dashboard's
 * From–To picker. "YYYY-MM" sorts correctly under plain string comparison
 * (same convention as sumInOutByAccountBeforeMonth), so no date parsing. */
export async function findRecentTransactionsInRange(fromMonthKey: string, toMonthKey: string, limit: number) {
  await db();
  return TransactionModel.find({
    status: "active",
    monthKey: { $gte: fromMonthKey, $lte: toMonthKey },
  })
    .sort({ occurredAt: -1, _id: -1 })
    .limit(limit)
    .lean();
}

function buildTxMatch(filter: TxFilter): Record<string, unknown> {
  const match: Record<string, unknown> = {};
  if (filter.accountId) match.accountId = oid(filter.accountId);
  if (filter.clientId) match.clientId = oid(filter.clientId);
  if (filter.type?.length) match.type = { $in: filter.type };
  if (filter.monthKey) match.monthKey = filter.monthKey;
  if (filter.from || filter.to) {
    const range: Record<string, Date> = {};
    if (filter.from) range.$gte = filter.from;
    if (filter.to) range.$lt = filter.to;
    match.occurredAt = range;
  }
  if (!filter.status || filter.status === "active") match.status = "active";
  else if (filter.status === "reversed") match.status = "reversed";
  // status === "all" -> no status filter
  return match;
}

/** Section 4.6 — the sibling-list function. Same TxFilter shape backs both
 * an aggregate card and its drill-down list, so card === sum(rows) by
 * construction. */
export async function findTransactionsPaginated(filter: TxFilter) {
  await db();
  const page = filter.page ?? 1;
  const pageSize = filter.pageSize ?? 20;
  const match = buildTxMatch(filter);

  const [rows, total] = await Promise.all([
    TransactionModel.find(match)
      .sort({ occurredAt: -1, _id: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean(),
    TransactionModel.countDocuments(match),
  ]);

  return { rows, total, page, pageSize };
}

export async function sumTransactionsMatchingFilter(filter: TxFilter): Promise<number> {
  await db();
  const match = buildTxMatch(filter);
  const [result] = await TransactionModel.aggregate<{ total: number }>([
    { $match: match },
    { $group: { _id: null, total: { $sum: "$amountPaise" } } },
  ]);
  return result?.total ?? 0;
}

/**
 * Section 7.8 — account activity with a running balance, computed
 * server-side via $setWindowFields (Section 14 edge case 33: server
 * pagination only, never a full-collection fetch into the app). Returns
 * rows newest-first with a `cumulativeDelta` per row; the caller adds the
 * account's balance as of just before the filtered range to get the true
 * running balance (kept out of this query so the repository stays pure
 * data access — see financial-engine.ts#getAccountActivity).
 *
 * Not filtered to status:"active" — a reversed original and its reversal
 * are BOTH shown (the UI renders reversed rows struck through, matching
 * the payment-trail precedent, Section 6.2), and both must be included
 * for the cumulative running balance to match the account's true balance
 * (same reasoning as sumInOutForAccountAsOf; excluding one side of a
 * reversal pair while including the other double-counts it).
 */
export async function findAccountActivityPage(
  accountId: string,
  options: { startUTC?: Date; endUTC?: Date; page: number; pageSize: number }
) {
  await db();
  const match: Record<string, unknown> = { accountId: oid(accountId) };
  if (options.startUTC || options.endUTC) {
    const range: Record<string, Date> = {};
    if (options.startUTC) range.$gte = options.startUTC;
    if (options.endUTC) range.$lt = options.endUTC;
    match.occurredAt = range;
  }

  const skip = (options.page - 1) * options.pageSize;

  const [facetResult] = await TransactionModel.aggregate<{
    rows: Array<Record<string, unknown> & { cumulativeDelta: number }>;
    totalCount: [{ count: number }] | [];
  }>([
    { $match: match },
    { $sort: { occurredAt: 1, _id: 1 } },
    {
      $setWindowFields: {
        sortBy: { occurredAt: 1, _id: 1 },
        output: {
          cumulativeDelta: {
            $sum: {
              $cond: [{ $eq: ["$direction", "IN"] }, "$amountPaise", { $multiply: ["$amountPaise", -1] }],
            },
            window: { documents: ["unbounded", "current"] },
          },
        },
      },
    },
    { $sort: { occurredAt: -1, _id: -1 } },
    {
      $facet: {
        rows: [{ $skip: skip }, { $limit: options.pageSize }],
        totalCount: [{ $count: "count" }],
      },
    },
  ]);

  return {
    rows: facetResult?.rows ?? [],
    total: facetResult?.totalCount[0]?.count ?? 0,
  };
}
