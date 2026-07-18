// Section 2.7 — the one place numeric/money-adjacent constants live (Law 10:
// no magic numbers). Values marked ★ in the spec are owner-editable defaults
// in /settings (Section 5.13); everything else here is fixed.

export const PAISE_PER_RUPEE = 100;

/** ₹10 crore hard cap per entry. */
export const MAX_ENTRY_PAISE = 1_00_00_00_000_00;

/** ≥ ₹10,00,000 — extra confirm dialog before submit. */
export const LARGE_ENTRY_CONFIRM_PAISE = 10_00_000_00;

/** ★ ≥ ₹50,000 — LARGE_EXPENSE notification. Default; owner-editable in /settings. */
export const LARGE_EXPENSE_ALERT_PAISE_DEFAULT = 50_000_00;

/** ★ per-account override allowed. Default; owner-editable in /settings. */
export const LOW_BALANCE_DEFAULT_PAISE_DEFAULT = 10_000_00;

/** ★ Default; owner-editable in /settings. */
export const DUE_SOON_DAYS_DEFAULT = 3;

export const PAGE_SIZE_DEFAULT = 20;
export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;
export const PAGE_SIZE_MAX = 100;

export const SEARCH_DEBOUNCE_MS = 300;
export const NOTIFICATION_POLL_MS = 60_000;

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const ALLOWED_UPLOAD_MIME = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

/** Cap on attachments per entity — not specified by the spec; see
 * docs/IMPLEMENTATION_PLAN.md "Open Assumptions" #1. */
export const MAX_ATTACHMENTS_PER_ENTITY = 5;

export const SESSION_MAX_AGE_S = 60 * 60 * 24 * 30; // 30 days
export const SESSION_UPDATE_AGE_S = 60 * 60 * 24; // roll daily
export const SESSION_COOKIE_CACHE_MAX_AGE_S = 60 * 5; // 5 minutes

export const RATE_MUTATIONS_PER_MIN = 30;
export const RATE_AUTH_PER_MIN = 5;
export const RATE_EXPORT_PER_MIN = 5;

/** Section 10.2 — 5 failed attempts locks the account for 15 minutes. */
export const LOGIN_MAX_FAILED_ATTEMPTS = 5;
export const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;

/** Section 10.1 — min length 10, zxcvbn score ≥ 3 for new passwords. */
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;
export const PASSWORD_MIN_ZXCVBN_SCORE = 3;

/** Section 10.11 — actions reject serialized input over this size. */
export const MAX_ACTION_PAYLOAD_BYTES = 100 * 1024;
