// Section 5 — every closed enum list in the data model, defined once so
// Mongoose schemas (database/models/*), the financial engine
// (types/engine.ts, server/services/financial-engine.ts), and Zod schemas
// (schemas/*.schema.ts) all reference the exact same literal set instead of
// re-declaring it three times (Law 10 — no duplicated logic).

export const CLIENT_ENGAGEMENT_TYPES = ["retainer", "one_time"] as const;
export type ClientEngagementType = (typeof CLIENT_ENGAGEMENT_TYPES)[number];

export const CLIENT_STATUSES = ["active", "paused", "archived"] as const;
export type ClientStatus = (typeof CLIENT_STATUSES)[number];

export const BILLING_GENERATED_BY = ["manual", "rollover", "client_create"] as const;
export type BillingGeneratedBy = (typeof BILLING_GENERATED_BY)[number];

// Section 4.1 — PayStatus, materialized on MonthlyBilling.status.
export const PAY_STATUSES = ["PENDING", "PARTIALLY_PAID", "FULLY_PAID", "OVERPAID"] as const;
export type PayStatus = (typeof PAY_STATUSES)[number];

export const PAYMENT_METHODS = ["cash", "upi", "bank_transfer", "cheque", "card", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const ACCOUNT_TYPES = ["bank", "cash", "upi_wallet", "other"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const ACCOUNT_STATUSES = ["active", "archived"] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

// ADJUSTMENT — a manual correction to an account's balance (cash recount,
// bank charge, opening-balance error found later). Direction IN or OUT.
// It is a real transaction rather than an edit of the stored balance so the
// audit trail stays truthful and history never changes retroactively; the
// month overview counts it in netCashFlow for the same reason.
// LOAN_OUT / LOAN_REPAY_IN — money lent to a person and paid back.
//
// These are NOT an expense and a credit, though it is tempting to reuse
// those: lending is not a cost, it is cash converted into a receivable, and
// filing it under expenses would inflate every expense total and pollute the
// category chart with money that was never spent.
//
// Adding a type carries an obligation. Any type outside the netCashFlow
// formula must NET TO ZERO across all accounts, which is why TRANSFER (two
// legs) and REVERSAL (against its original) can sit outside it. Lending does
// not net to zero — the cash genuinely leaves — so financial-engine.ts counts
// both of these explicitly. Skipping that would fail closing == opening + net
// and blank the Overview behind the reconciliation banner.
export const TRANSACTION_TYPES = [
  "PAYMENT_IN",
  "CREDIT_IN",
  "EXPENSE_OUT",
  "TRANSFER",
  "REVERSAL",
  "ADJUSTMENT",
  "LOAN_OUT",
  "LOAN_REPAY_IN",
] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const TRANSACTION_DIRECTIONS = ["IN", "OUT"] as const;
export type TransactionDirection = (typeof TRANSACTION_DIRECTIONS)[number];

export const ACTIVE_REVERSED_STATUSES = ["active", "reversed"] as const;
export type ActiveReversedStatus = (typeof ACTIVE_REVERSED_STATUSES)[number];

/**
 * Expense lifecycle. Deliberately NOT ACTIVE_REVERSED_STATUSES (which
 * payments, credits and transactions share) because an expense has two
 * extra states those don't:
 *
 *   pending   — raised but no money has moved. No Transaction exists, no
 *               balance was touched. This is the ONLY state in which an
 *               expense may be edited (Section 6.3.3): there is nothing
 *               posted to contradict. Recurring expenses land here.
 *   active    — approved and posted. A Transaction exists and the account
 *               balance has been decremented. Immutable from here on;
 *               corrections go through a reversal, never an edit.
 *   reversed  — was posted, then reversed by a compensating Transaction.
 *   cancelled — was pending and dismissed. No money ever moved, so there is
 *               nothing to reverse; the row is kept rather than deleted so
 *               "why did this month's rent never get paid?" stays answerable.
 */
export const EXPENSE_STATUSES = ["pending", "active", "reversed", "cancelled"] as const;
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];

/** Recurring-expense template lifecycle. `paused` stops future generation
 * without destroying the template or any expense it already raised. */
export const EXPENSE_TEMPLATE_STATUSES = ["active", "paused"] as const;
export type ExpenseTemplateStatus = (typeof EXPENSE_TEMPLATE_STATUSES)[number];

/** How an expense came into being — mirrors BILLING_GENERATED_BY. */
export const EXPENSE_GENERATED_BY = ["manual", "rollover"] as const;
export type ExpenseGeneratedBy = (typeof EXPENSE_GENERATED_BY)[number];

/**
 * Money LENT OUT to a person, and its repayment — "udhaar diya".
 *
 * Named from the borrower's side because that is how the team refers to it
 * ("the borrowers list"), but read the direction carefully: every Borrowing
 * document is money this business handed over and expects back. Nothing here
 * models money borrowed FROM someone — that arrives as a Credit with
 * category "loan".
 *
 *   open        — some principal is still outstanding.
 *   settled     — repaid in full. Reached by repayment, never set by hand.
 *   written_off — given up on. The cash already left when it was lent, so
 *                 this moves no money; it only stops the row counting as
 *                 recoverable.
 */
export const BORROWING_STATUSES = ["open", "settled", "written_off"] as const;
export type BorrowingStatus = (typeof BORROWING_STATUSES)[number];

export const EXPENSE_CATEGORIES = [
  "salary",
  "incentive",
  "rent",
  "software",
  "vendor",
  "tax",
  "utilities",
  "marketing",
  "travel",
  "misc",
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const CREDIT_CATEGORIES = [
  "owner_capital",
  "loan",
  "refund",
  "interest",
  "grant",
  "other",
] as const;
export type CreditCategory = (typeof CREDIT_CATEGORIES)[number];

export const NOTIFICATION_TYPES = [
  "DUE_UPCOMING",
  "DUE_OVERDUE",
  "LARGE_EXPENSE",
  "EXPENSE_PENDING_APPROVAL",
  "LOW_BALANCE",
  "PAYMENT_RECEIVED",
  "MONTH_SUMMARY",
  "RECONCILIATION_DRIFT",
  "UPLOAD_FAILED",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_SEVERITIES = ["info", "warning", "critical"] as const;
export type NotificationSeverity = (typeof NOTIFICATION_SEVERITIES)[number];

export const NOTIFICATION_AUDIENCES = ["all", "owner"] as const;
export type NotificationAudience = (typeof NOTIFICATION_AUDIENCES)[number];

export const NOTIFICATION_ENTITY_KINDS = [
  "client",
  "account",
  "expense",
  "payment",
  "credit",
  "borrowing",
  "system",
] as const;
export type NotificationEntityKind = (typeof NOTIFICATION_ENTITY_KINDS)[number];
