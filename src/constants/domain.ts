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

export const TRANSACTION_TYPES = [
  "PAYMENT_IN",
  "CREDIT_IN",
  "EXPENSE_OUT",
  "TRANSFER",
  "REVERSAL",
] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const TRANSACTION_DIRECTIONS = ["IN", "OUT"] as const;
export type TransactionDirection = (typeof TRANSACTION_DIRECTIONS)[number];

export const ACTIVE_REVERSED_STATUSES = ["active", "reversed"] as const;
export type ActiveReversedStatus = (typeof ACTIVE_REVERSED_STATUSES)[number];

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
  "system",
] as const;
export type NotificationEntityKind = (typeof NOTIFICATION_ENTITY_KINDS)[number];
