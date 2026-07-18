# Company Finance & Ledger Management System — Phase 0 Implementation Roadmap

Source of truth: `MASTER_PROMPT_Finance_Ledger_System.md` (repo root). This document is the
Phase 0 planning deliverable required by that spec's final section. No application code has
been written. Every design choice below traces back to a specific section of the master
prompt; where a section number is cited, that section governs and this document must not
diverge from it. Precedence on conflicts: Section 0 Laws > formulas (4.3) > algorithms (6) >
schemas (5) > screens (7) > everything else, per the master prompt's own closing rule.

---

## ARTIFACT 1 — Architecture Confirmation

### 1.1 Layer map (Section 3, restated as enforced dependency direction)

```
app/ (RSC pages, layouts)
  -> features/*/components (client components: forms, sheets, tables)
  -> features/*/actions.ts (Server Actions)  |  app/api/* (route handlers)
       -> server/services/*.ts   (business logic, owns DB transactions)
            -> server/repositories/*.ts   (ONLY files touching Mongoose models)
                 -> database/models/*.ts  (schemas)
            -> other services (e.g. payments.service -> financial-engine, audit.service)
  -> lib/*, constants/*, schemas/* (pure, importable from any layer above)
```

Enforced via ESLint `no-restricted-imports`:
- `components/**`, `app/**` MUST NOT import `server/services/**`, `server/repositories/**`,
  `database/models/**` directly — only through `features/*/actions.ts` or a Server Component
  calling a service function (RSC pages are the one exception permitted by Law 6 / Section 9:
  they call services in-process, never through the actions layer, never through fetch).
- `features/<a>/**` MUST NOT import `features/<b>/**` — cross-feature reuse goes through
  `components/shared/**` or `server/services/**`.
- `server/services/**` MUST NOT import `react`, `next/navigation`, or any client-only module.
- `server/repositories/**` MUST NOT contain conditional business logic — pure CRUD/query only.

### 1.2 Flow A — `recordPayment`, click to success panel

1. **UI trigger**: `features/payments/components/RecordPaymentSheet.tsx` (client component)
   opened from `[+ Record Payment]` on `app/(app)/clients/[id]/page.tsx` (Section 7.4).
   Idempotency key generated client-side on sheet mount (`crypto.randomUUID()`), stored in
   React state so retries reuse it.
2. **Form**: React Hook Form + `schemas/payment.schema.ts` (Zod) for client-side validation
   (Law 8). Fields per Section 7.4 (`amount`, `paidAt`, `method`, `accountId`, `reference`,
   `note`, `attachments`). Amount input uses `lib/money.ts#toPaise` on blur/submit.
3. **Submit**: calls `features/payments/actions.ts#recordPaymentAction(formData)` — a Server
   Action.
4. **Action wrapper** (the 8-line skeleton, Section 8.2):
   `rateLimit(userId, 'mutation')` → `requireUser(['owner','admin','staff'])`
   (`server/auth/guards.ts`) → `paymentSchema.parse(input)` (same schema as step 2, re-run
   server-side per Law 8) → `paymentsService.recordPayment(input, ctx)` → the service performs
   its own `revalidatePath` calls → returns `ApiResult<T>` envelope (`lib/result.ts`).
5. **Service** `server/services/payments.service.ts#recordPayment` opens
   `session.withTransaction()` (Law 4) and executes Section 6.1 steps 1–11 verbatim:
   loads client/billing/account via `clientsRepository`, `billingRepository`,
   `accountsRepository`; issues invoice/receipt numbers via `countersRepository`
   (Section 5.12 atomic `findOneAndUpdate`); inserts the `Payment` doc
   (`paymentsRepository.insert`); inserts the ledger `Transaction`
   (`transactionsRepository.insert`, Section 5.6); `$inc`s `Account.currentBalancePaise`
   (`accountsRepository.incBalance`); `$inc`s + recomputes `MonthlyBilling.paidPaise/status`
   using the post-inc value per formula 4.3 (`billingRepository.applyPayment`); writes a
   `PAYMENT_RECEIVED` `Notification` (`notificationsService.create`, dedupeKey
   `PAY:{paymentId}`); conditionally clears a prior `DUE_OVERDUE` notification; writes the
   `AuditLog` entry `PAYMENT_RECORDED` (`auditService.log`) **inside the same transaction**
   (Law 9). All of this is one atomic unit (Law 4) — if anything throws, `withTransaction`
   rolls back everything (Law 3: nothing partially written).
6. **Idempotency**: before step 5's inserts, `lib/idempotency.ts` attempts to insert a
   doc keyed on `idempotencyKey`; on `E11000` it fetches and returns the prior result as
   `IDEMPOTENT_REPLAY` success (Section 14 edge case 5) instead of re-running the transaction.
7. **Post-transaction** (outside the DB tx, per Section 6.1's closing line): the action calls
   `revalidatePath('/clients')`, `/clients/[id]`, `/ledger/*`, `/dashboard`, `/notifications`.
8. **Response**: `recordPaymentAction` returns `{ success, data: { payment, newBillingStatus,
   accountNewBalance } }`. The sheet renders the in-sheet success panel (Section 7.4): receipt
   number, new account balance, `[Done]` / `[Record another]`.
9. **Client refresh**: `router.refresh()` fires from the sheet's submit handler so the RSC
   parent re-fetches via `getClientMonthStatus`/`getDashboardData` on next paint — no client
   money math occurs anywhere in this flow (Law 1).

### 1.3 Flow B — Dashboard render

1. Request hits `app/(app)/dashboard/page.tsx`, an RSC. `middleware.ts` has already confirmed
   a session cookie is present (presence-level check only, Section 10.4); the `(app)/layout.tsx`
   server-side guard re-validates the session authoritatively and redirects to `/login` if
   invalid.
2. The page reads `activeMonthKey` from the month-context Zustand store's SSR-hydrated cookie
   value (or defaults to `toMonthKey(nowIST())` via `lib/dates.ts`).
3. **Exactly one composed call**: `getDashboardData(monthKey)` in
   `server/services/financial-engine.ts` (Section 4.2/9). Internally it fires, in parallel via
   `Promise.all`: `getMonthOverview(monthKey)`, `getDuesList(todayIST())`,
   `getAccountBalance` for every active account (batched, one `$in` query — no N+1, Section 9),
   last-8-transactions `listTransactions({ page:1, pageSize:8 })`, and the 6-month sparkline
   aggregation. Each sub-call reads from `repositories/*` using `.lean()` + explicit
   projections over indexes named in Section 5 (verified by `scripts/verify-indexes.ts`).
4. Page is `export const dynamic = 'force-dynamic'` (Section 9 — financial reads never
   cached). `app/(app)/dashboard/loading.tsx` streams an instant skeleton matching final
   layout (KPI row, account strip, two-column row, sparkline) while `getDashboardData`
   resolves; React Suspense boundaries around each row let rows paint independently.
5. Rendered with shared components: `KpiCard`/`DrilldownCard` (Row 1, each `href` built from
   the same `TxFilter` the sibling list will consume — Section 4.6), `AmountText` for all
   figures, `DataTable`-less mini-tables for dues/activity (plain server-rendered rows, no
   client table needed since no pagination on the dashboard), `dynamic(() => import(...))`
   for the Recharts sparkline (client component, below the fold, Section 9).
6. No `fetch('/api/...')` occurs — RSC calls the service in-process (Section 9's explicit
   prohibition). The only client-side network calls on this page are the notification bell's
   `GET /api/notifications/poll` (TanStack Query, 60s) and the month-picker's navigation
   (a normal Link/router.push that triggers a fresh RSC render, not a fetch).

---

## ARTIFACT 2 — Schema Drafts (12 collections + 1 embedded subdocument) and Index Justifications

All field definitions below are exactly as specified in Section 5 — restated here in draft-schema
form (not code) with an index justification column added, since the master prompt requires each
index to name the exact query it serves. Money fields are always `int, paise, >= 0` unless noted
`> 0`. All collections have `timestamps: true`.

### 5.1 `users`
| Field | Type/Rule |
|---|---|
| name | string, 2–80 |
| email | string, unique, lowercase, trimmed |
| passwordHash | string (argon2id, Better Auth) |
| role | enum owner\|admin\|staff\|viewer, default staff |
| isActive | bool, default true |
| failedLoginAttempts | int, default 0 |
| lockedUntil | Date\|null |
| lastLoginAt | Date\|null |
| mustChangePassword | bool, default false |

Index: `{email:1} unique` — justifies login lookup (`findOne({email})`) and enforces one
account per email at the DB layer, not just app layer.

### 5.2 `clients`
| Field | Type/Rule |
|---|---|
| name* | string 2–120 |
| service* | string 2–120 |
| engagementType* | enum retainer\|one_time |
| amountPaise* | int > 0 |
| nextDueDate* | Date |
| billingDay | int 1–31\|null |
| email/phone/company/address/gstin/notes | optional, per Section 5.2 rules |
| status | enum active\|paused\|archived, default active |
| archivedAt/archiveReason | Date\|null / string\|null |
| version | int, default 0 (optimistic lock) |
| createdBy | ObjectId → users |

Indexes:
- `{name:"text", company:"text", service:"text"}` — serves `/clients` search box (debounced
  free-text query across name/company/service, Section 7.2) and ⌘K palette lookup.
- `{status:1, nextDueDate:1}` — serves the default `/clients` list (status=active) sorted/
  filtered by due date, and the rollover cron's active-client scan (Section 6.8A).
- `{engagementType:1, status:1}` — serves the rollover cron's `retainer + active` filter and
  the `/clients` Type filter combined with Status filter.

### 5.3 `monthlybillings`
| Field | Type/Rule |
|---|---|
| clientId* | ObjectId |
| monthKey* | string "YYYY-MM" |
| billedPaise* | int ≥ 0 |
| carriedInPaise | int, default 0 |
| carriedOutPaise | int, default 0 (added per Section 6.8A carry-as-move requirement) |
| paidPaise | int, default 0 (materialized) |
| status | enum PENDING\|PARTIALLY_PAID\|FULLY_PAID\|OVERPAID (materialized) |
| dueDate* | Date |
| generatedBy* | enum manual\|rollover\|client_create |
| version | int, default 0 |

Indexes:
- `{clientId:1, monthKey:1} UNIQUE` — enforces one billing per client per month (makes cron
  re-runs no-ops, Section 6.8A) and serves `getClientMonthStatus(clientId, monthKey)`.
- `{monthKey:1, status:1}` — serves `getMonthOverview(monthKey)` billed/outstanding
  aggregation and the `/clients` "This Month" status filter.
- `{status:1, dueDate:1}` — serves `getDuesList`/the due-reminder cron's `findBillingsByStatus`
  scan, which filters ONLY on status (dueDate bucketing happens in application code); status
  must lead since a compound index requires a matching prefix (corrected at M8 hardening —
  `{dueDate:1, status:1}` was silently COLLSCANning this exact query, caught by
  `scripts/verify-indexes.ts`).

### 5.4 `payments`
| Field | Type/Rule |
|---|---|
| clientId, monthlyBillingId, accountId* | ObjectId |
| amountPaise* | int > 0 |
| paidAt* | Date, ≤ today IST |
| monthKey* | string (from billing, not paidAt) |
| method* | enum cash\|upi\|bank_transfer\|cheque\|card\|other |
| invoiceNumber*, receiptNumber* | string, unique each |
| reference, note | optional |
| attachments | [AttachmentMeta] |
| transactionId* | ObjectId → transactions |
| status | enum active\|reversed, default active |
| reversedBy, reversedReason | ObjectId\|null, string\|null |
| idempotencyKey* | string, unique |
| createdBy* | ObjectId |

Indexes:
- `{clientId:1, paidAt:-1}` — serves the client-detail payment trail (7.4 "current"/"history"
  tabs).
- `{accountId:1, paidAt:-1}` — serves account activity filtered to payments.
- `{monthKey:1, status:1}` — serves `collected(monthKey)` aggregation (formula 4.3).
- `{invoiceNumber:1} unique`, `{receiptNumber:1} unique` — uniqueness contract from 5.12's
  counter issuance; also serves receipt/invoice lookup on export and audit drill-in.
- `{idempotencyKey:1} unique` — serves the idempotent-replay check (Section 6 preamble).

### 5.5 `accounts`
| Field | Type/Rule |
|---|---|
| name* | string 2–80, unique among status=active |
| type* | enum bank\|cash\|upi_wallet\|other |
| openingBalancePaise* | int ≥ 0 |
| currentBalancePaise | int (materialized) |
| bankName, last4 | optional |
| isDefault | bool, default false (exactly one true, enforced in service) |
| lowBalanceThresholdPaise | int\|null |
| reconcileLock | bool, default false |
| status | enum active\|archived, default active; archivedAt |
| version | int, default 0 |

Index: `{status:1, name:1}` — serves the account grid (`/ledger/accounts`, active accounts
sorted by name) and `AccountSelect` dropdown population, excluding archived.

### 5.6 `transactions` (the ledger — append-only)
| Field | Type/Rule |
|---|---|
| type* | enum PAYMENT_IN\|CREDIT_IN\|EXPENSE_OUT\|TRANSFER\|REVERSAL |
| direction* | enum IN\|OUT |
| amountPaise* | int > 0 |
| accountId*, occurredAt*, monthKey* | as Section 5.6 |
| clientId | ObjectId\|null |
| paymentId/expenseId/creditId | ObjectId\|null (exactly one set per type) |
| invoiceNumber/receiptNumber | string\|null (denormalized copies) |
| counterpartyLabel | string\|null |
| transactionGroupId | ObjectId\|null (transfer legs / reversal pairs) |
| reversesTransactionId | ObjectId\|null |
| status | enum active\|reversed, default active |
| note | string\|null ≤500 |
| idempotencyKey* | string, unique |
| createdBy* | ObjectId |

Indexes:
- `{accountId:1, occurredAt:-1}` — serves `getAccountActivity` (running-balance table,
  Section 7.8) and the per-account statement export.
- `{monthKey:1, type:1, status:1}` — serves every Section 4.3 aggregate
  (`collected`/`credits`/`expenses` per month) via single `$match+$group`, no `$lookup`
  (Section 9 — denormalized labels exist exactly for this).
- `{clientId:1, occurredAt:-1}` — serves client-detail activity tab and audit drill-in by
  client.
- `{transactionGroupId:1}` — serves transfer-leg lookup (both legs must be found together for
  reversal, Section 6.5.3) and reversal-pair lookup.
- `{idempotencyKey:1} unique` — idempotent replay.

### 5.7 `expenses`
| Field | Type/Rule |
|---|---|
| amountPaise* | int > 0 |
| reason*, paidToEntity* | string 2–200 / 2–120 |
| category* | enum salary\|incentive\|rent\|software\|vendor\|tax\|utilities\|marketing\|travel\|misc |
| accountId*, spentAt* | ObjectId / Date |
| attachments, note | optional |
| transactionId* | ObjectId |
| status/reversedBy/reversedReason | as 5.4 pattern |
| overrideNegativeBalance | bool, default false (owner-only, audited) |
| idempotencyKey*, createdBy* | unique / ObjectId |

Indexes:
- `{spentAt:-1}` — serves default `/ledger/expenses` list (newest first).
- `{category:1, spentAt:-1}` — serves category filter + "expense by category" donut drill.
- `{accountId:1, spentAt:-1}` — serves account activity filtered to expenses.

### 5.8 `credits`
| Field | Type/Rule |
|---|---|
| amountPaise*, source*, reason* | int>0 / 2–120 / 2–200 |
| category* | enum owner_capital\|loan\|refund\|interest\|grant\|other |
| accountId*, receivedAt* | ObjectId / Date |
| attachments, note, transactionId*, status/reversedBy/reversedReason, idempotencyKey*, createdBy* | as expense pattern |

Indexes:
- `{receivedAt:-1}` — serves default `/ledger/credits` list.
- `{category:1, receivedAt:-1}` — serves category filter.

### 5.9 `notifications`
| Field | Type/Rule |
|---|---|
| type* | enum DUE_UPCOMING\|DUE_OVERDUE\|LARGE_EXPENSE\|LOW_BALANCE\|PAYMENT_RECEIVED\|MONTH_SUMMARY\|RECONCILIATION_DRIFT\|UPLOAD_FAILED |
| severity* | enum info\|warning\|critical |
| title*, body* | ≤120 / ≤500 |
| entityRef* | {kind, id} |
| href* | string |
| isRead | bool, default false |
| audience* | enum all\|owner |
| dedupeKey* | string, unique |

Indexes:
- `{isRead:1, createdAt:-1}` — serves `/notifications` tabs (All/Unread) and the poll
  endpoint's unread-count + latest-5 query.
- `{dedupeKey:1} unique` — enforces the dedupe contract that makes cron notification jobs
  idempotent (Section 6.8B/D, Section 14 edge case 41).

### 5.10 `auditlogs` (append-only)
| Field | Type/Rule |
|---|---|
| actorUserId*, actorName* | ObjectId / string (denormalized) |
| action* | closed-list string (Section 13) |
| entity* | {kind, id} |
| before, after | object\|null (secrets stripped) |
| summary* | ≤200 |
| ip, userAgent | string\|null |

Indexes:
- `{"entity.kind":1, "entity.id":1, createdAt:-1}` — serves the client/account/etc.
  "activity" tab (Section 7.4 activity tab, 7.8) — audit trail for one entity.
- `{actorUserId:1, createdAt:-1}` — serves `/audit` actor filter.
- `{action:1, createdAt:-1}` — serves `/audit` action-type filter.

### 5.11 `AttachmentMeta` (embedded subdocument — not a standalone collection)
| Field | Type/Rule |
|---|---|
| publicId*, url* | string (Cloudinary secure_url) |
| originalName | ≤200 |
| bytes | int ≤ MAX_UPLOAD_BYTES |
| mime | enum ALLOWED_UPLOAD_MIME |
| uploadedAt, uploadedBy | Date / ObjectId |

No independent indexes (embedded in payments/expenses/credits arrays).

### 5.12 `counters`
| Field | Type/Rule |
|---|---|
| _id* | string ("invoice-2026"\|"receipt-2026") |
| seq* | int |

No secondary index needed — `_id` lookup is the only access pattern (atomic
`findOneAndUpdate` with `$inc`, Section 5.12). Default `_id` index suffices.

### 5.13 `settings` (single document, `_id:"global"`)
| Field | Type/Rule |
|---|---|
| largeExpenseAlertPaise, lowBalanceDefaultPaise, dueSoonDays | int, owner-editable |
| companyName | string |
| financialYearStartMonth | int 1–12, default 4 |
| goLiveDate | Date\|null |
| updatedBy, version | ObjectId / int |

No secondary index — single-document collection, always fetched by fixed `_id`, and cached
via `unstable_cache` tag `"settings"` (Section 9).

---

## ARTIFACT 3 — Section 14 Edge Case Checklist + 5 Additional Cases

Format: `#` — one-line implementation note (where in the architecture it's enforced).

1. Second partial payment — enforced by `billingRepository.applyPayment` recomputing status
   from formula 4.3 on every `$inc`, tested by the truth table unit suite (M2).
2. Overpayment surplus — `rollover.service.ts` reads prior month's negative-remaining-as-surplus
   and applies it as negative `carriedInPaise` on the new billing; audited in `BILLING_GENERATED`.
3. Cross-month `paidAt` — `monthKey` on `Payment`/`Transaction` is copied from the billing's
   `monthKey`, never derived from `paidAt`, per `recordPayment` step 4 (6.1).
4. Wrong-account correction — `features/payments/actions.ts` exposes a `movePaymentAction`
   composing `reversePayment` + `recordPayment` in one Server Action call (two ledger entries,
   Law 3 respected — no direct `accountId` edit).
5. Double-click/retry — `lib/idempotency.ts` unique-key insert-or-fetch, wired into every
   mutating service function (6.1–6.5).
6. Concurrent same-client payments — relies on Mongo `$inc` atomicity + per-transaction
   post-inc status recompute; verified by the "concurrent 10× parallel payments" integration
   test (Section 15).
7. Reversal drops FULLY_PAID — `billingRepository.applyReversal` recomputes status and
   `notificationsService` re-creates `DUE_OVERDUE` with a `:r{n}` dedupeKey suffix if still
   overdue.
8. Reversing a reversal — `paymentsService.reversePayment` checks `payment.status === 'active'`
   first; else throws `CONFLICT`.
9. Amount validation — `schemas/*.schema.ts` money field = `z.number().int().positive().max(MAX_ENTRY_PAISE)`,
   parsed after `toPaise()`; shared client+server (Law 8).
10. ≥ ₹10,00,000 confirm — client-side `ConfirmDialog` gated on `LARGE_ENTRY_CONFIRM_PAISE`
    before submit; server does not re-block (UX only, not a business rule).
11. Money string parsing — `lib/money.ts#toPaise` regex-based parser, unit-tested against the
    exact accepted/rejected string table in Section 2.8.
12. Mid-year amount change — `updateClient` (6.7) only `$set`s the `Client.amountPaise` field;
    existing `MonthlyBilling.billedPaise` rows are never touched.
13. `billingDay` 31 clamping — `lib/dates.ts#clampBillingDay`, unit-tested incl. leap year 2028.
14. IST/UTC boundary — `lib/dates.ts#toMonthKey` computed via `date-fns-tz` against
    `Asia/Kolkata`; unit test pins 23:50 IST 31-Jan → `2026-01`.
15. Past `nextDueDate` on create — allowed; `/clients/new` shows amber confirm per 7.3; no
    server-side block.
16. Paused client rollover skip — cron query filters `status:"active"` (6.8A); dues remain
    queryable; explicitly no back-billing on resume.
17. One-time client — `createClient` inserts exactly one `MonthlyBilling`
    (`generatedBy:"client_create"`); rollover cron query filters `engagementType:"retainer"`.
18. Archive with nonzero balance — `accountsService.archiveAccount` checks
    `currentBalancePaise === 0` else `NONZERO_BALANCE` with transfer CTA data.
19. Archived account history — `AccountSelect` filters `status:"active"`; all read paths
    (activity, drilldowns) are unfiltered by status.
20. Transfer to self — Zod `refine` on `transferBetweenAccounts` schema:
    `fromAccountId !== toAccountId`.
21. Transfer/expense exceeding balance — shared `checkSufficientBalance` helper in
    `accounts.service.ts`, owner-only override flag threaded through both `createExpense` and
    `transferBetweenAccounts`.
22. Zero accounts exist — `AccountSelect` component renders an inline "create account" card;
    parent form (RHF) state is preserved because the account-creation modal doesn't unmount
    the form, it mounts on top.
23. Opening balance edit — `updateAccount` owner-only branch, `TypedConfirmDialog`, triggers
    `reconcileAccount(accountId)` synchronously after the same transaction commits.
24. Reconciliation drift — `reconciliation.service.ts#reconcileAll` sets
    `Account.reconcileLock = true` + critical notification; all mutation services check
    `reconcileLock:false` in their account-load step (already required by 6.1/6.3/6.5's "load
    account (active, unlocked)" precondition).
25. Duplicate client names — `checkClientNameAction` read-only action, called on blur before
    submit; `createClient` itself never blocks on this.
26. Archive with dues — `archiveClientAction` composes a dues-lookup before confirming;
    `/ledger/dues` renders a 4th collapsed section for archived clients with `remaining > 0`.
27. Fully-paid one-time suggestion chip — pure UI derivation on `/clients/[id]`, no new engine
    function (reads existing `ClientMonthStatus`).
28. Unarchive — `unarchiveClientAction` sets `status:"active"`; rollover picks up from the
    current cron run's `monthKey`, no catch-up.
29. Upload failure — `FileUpload` component catches the Cloudinary XHR failure, submits the
    parent entity without the attachment, and the action layer fires `UPLOAD_FAILED`.
30. MIME spoof — `/api/uploads/sign` returns a signature; on the entity-create service call,
    Cloudinary's reported `format` is compared to the declared `mime`; mismatch rejects the
    attachment (not the whole entity).
31. Signed URL expiry — a dedicated read action (`getAttachmentUrlAction`) regenerates a
    fresh 10-minute Cloudinary signed URL on each click; URLs are never stored long-lived.
32. Empty-first-run vs empty-filtered — `DataTable`/`EmptyState` shared component takes an
    explicit `variant: 'first-run' | 'filtered'` prop; pages decide by checking
    `totalUnfiltered === 0` vs `total === 0`.
33. 100k transactions — all list queries paginate server-side (`TxFilter.page/pageSize`,
    clamped ≤100); `scripts/verify-indexes.ts` fails the build if any hot query COLLSCANs.
34. Search input injection-looking strings — `lib/csv.ts`/repository search builders run
    `escapeRegExp` before constructing `$regex`; never string-concatenate user input into a
    query object.
35. Export WYSIWYG — `/api/export/*` handlers accept the identical query-param shape as the
    table they mirror and call the identical service function.
36. Two tabs open — RSC pages naturally refresh on navigation/focus;
    `NOTIFICATION_POLL_MS` + `refetchOnWindowFocus: true` covers the notification bell.
37. Viewer direct POST — `requireUser(minRole)` in every action/service entry point throws
    `FORBIDDEN` regardless of what the UI hid.
38. Session dies mid-form — Section 11 T5: the Server Action wrapper's client-side caller
    keeps `FormData` in a React ref; on a 401 envelope it opens a re-login modal and replays
    the same action call after re-auth.
39. Deactivating last owner — `setUserActiveAction` counts active owners before allowing
    deactivation; blocks with an explicit message if it would reach zero.
40. Role downgraded mid-session — `requireUser` reads the user document fresh from
    `usersRepository` on every call, never trusts a cached/session-claimed role.
41. Cron double-run — every cron job (6.8 A–D) is state-based (checks for existing
    `MonthlyBilling`, existing `dedupeKey`) rather than "did I run today," so retries and
    Vercel's at-least-once cron delivery are safe no-ops.
42. Cron missed a day — same state-based design self-heals on the next successful run.
43. Cold start — `database/connection.ts` singleton on `globalThis`; `/api/health` used as an
    external warmer by the uptime monitor (Section 18.2).
44. Transient DB error mid-transaction — `session.withTransaction` has built-in transient-error
    retry; a final failure surfaces as `INTERNAL` with a `correlationId`, and Mongo guarantees
    no partial writes on abort.
45. Server clock authority — `lib/dates.ts#nowIST()`/`todayIST()` are the only source of "now"
    for validation (`paidAt ≤ today`); client-submitted dates are never trusted for that
    comparison.

**Five additional edge cases not explicitly covered by Section 14:**

46. **Concurrent `isDefault` account changes.** Two admins mark two different accounts
    default at the same moment. Handling: `setDefaultAccountAction` performs the unset-others
    + set-this update inside one transaction with the target account's `version` in the
    filter (optimistic lock); the loser gets `CONFLICT` and must retry, guaranteeing exactly
    one default account is never violated even under a race (Section 5.5's "exactly one" rule
    has no atomicity guidance in the spec — this closes that gap).
47. **`MonthlyBilling` for a month with zero clients billed yet cron hasn't run.**
    `getMonthOverview(monthKey)` for a mid-month `monthKey` before rollover has created some
    clients' billings must not undercount silently — handled because `billedPaise` aggregation
    only sums *existing* `MonthlyBilling` docs; the dashboard's "Billed" figure is documented in
    the UI copy as "billed so far this month," never implied to be a forecast. No engine change
    needed, but this is called out so no one later "fixes" it into a forecast without a spec
    change.
99. (renumbered below)
48. **Deleting/renaming a category enum value in `/settings` in the future.** The spec fixes
    expense/credit categories as closed enums (5.7/5.8) with no settings-driven customization.
    Handling: explicitly out of scope for v1 — documented in `docs/RUNBOOK.md` Section 18.6
    growth notes as a schema-migration item, not silently allowed via free text.
49. **Attachment array growth / an entity with many receipts.** No cap is specified on
    `attachments` array length. Handling: cap client-side at a sane UX limit (e.g. 5 files) and
    server-side reject arrays over that bound as `VALIDATION` — prevents an unbounded
    subdocument growing a payment doc past MongoDB's 16MB doc limit; documented as an
    implementation default, flagged to the user as an assumption at M4.
50. **Rate limiter storage under MongoDB transient failure.** `rate-limit.ts` is Mongo-backed
    (Section 10.2); if the rate-limit collection write itself fails transiently, the wrapper
    must fail **open** for reads and **closed** (reject) for money-mutating actions only after
    a bounded retry — otherwise a DB blip either locks out all mutations or silently disables
    rate limiting. This policy is documented in `lib/rate-limit.ts`'s module doc comment at
    implementation time and flagged to the user since Section 10.2 doesn't specify fail-open
    vs fail-closed behavior.

---

## ARTIFACT 4 — Route / Component Inventory

| Route | Split | Composed data call | Key shared components | Skeleton |
|---|---|---|---|---|
| `/login` | RSC shell + client form | none (Better Auth) | — | static, no skeleton needed |
| `/dashboard` | RSC + streamed client islands (sparkline) | `getDashboardData(monthKey)` | KpiCard, DrilldownCard, AmountText, StatusBadge | KPI row + strip + 2-col + chart placeholder, matched heights |
| `/clients` | RSC + client DataTable (server pagination via TanStack) | `listClients(filter)` (thin wrapper composing `getClientMonthStatus` per row via `$in` batch) | DataTable, StatusBadge, AmountText, EmptyState | 8 shimmer rows |
| `/clients/new` | RSC shell + client form (RHF) | none (create) | DateFieldIST, ClientSelect n/a, form sections | static |
| `/clients/[id]` | RSC + client Sheet/Tabs | composite: `getClientMonthStatus` + `getClientHistory` + `getClientTotalDue` + `getClientLifetimePaid` in one `Promise.all` service call `getClientDetailComposite(clientId)` | KpiCard, StatusBadge, AmountText, ConfirmDialog, TypedConfirmDialog, FileUpload | header + KPI + tab skeleton |
| `/ledger/overview` | RSC + client charts (dynamic import) | `getMonthOverview(monthKey)` / `getRangeOverview` | DrilldownCard, AmountText, DataTable (tx list), MonthPicker | math-block skeleton + chart placeholders |
| `/ledger/expenses` | RSC + client Sheet + DataTable | `listTransactions({type:['EXPENSE_OUT'], monthKey})` | DataTable, AccountSelect, FileUpload, AmountText | table skeleton |
| `/ledger/accounts` | RSC (grid) + client modals | `Promise.all` of `getAccountBalance` per active account (batched) | AmountText, StatusBadge-like chips | card grid skeleton |
| `/ledger/accounts/[id]` | RSC + client filters | `getAccountActivity(accountId, filter)` | DataTable, AmountText, MonthPicker | KPI + table skeleton |
| `/ledger/credits` | RSC + client Sheet + DataTable | `listTransactions({type:['CREDIT_IN'], monthKey})` | mirrors expenses | table skeleton |
| `/ledger/dues` | RSC | `getDuesList(todayIST())` | DrilldownCard, AmountText | 3-section skeleton |
| `/notifications` | RSC + client tabs (TanStack Query poll for bell only; page itself RSC-fetched list) | `listNotifications(filter)` | EmptyState | row skeleton |
| `/audit` | RSC + client filters/dialog | `listAuditLogs(filter)` | DataTable, dialog diff viewer | table skeleton |
| `/settings` | RSC + client cards | `getSettings()` (unstable_cache) | ConfirmDialog, TypedConfirmDialog | card skeleton |
| `/settings/users` | RSC + client table/modals | `listUsers()` | DataTable, ConfirmDialog | table skeleton |

Route-level layout: `app/(app)/layout.tsx` (sidebar+topbar, auth-guarded, one shell for all
above); `app/(app)/ledger/layout.tsx` (sub-tab bar for the five `/ledger/*` routes). Every
segment above ships its own `loading.tsx` and `error.tsx` per Section 3's structural
requirement; root `not-found.tsx` once.

---

## ARTIFACT 5 — Milestone Plan (M1–M10)

Each milestone is fully functional and independently testable in isolation (later milestones
build UI/behavior on top, but each milestone's own DoD is verifiable without later work).

### M1 — Auth, Sessions, App Shell
**Goal:** Login works, sessions never randomly expire (Section 11), roles are enforced,
sidebar/topbar shell renders for an authenticated user.
**Creates:** `config/env.ts`, `server/auth/auth.ts`, `server/auth/guards.ts`, `middleware.ts`,
`database/connection.ts`, `database/models/user.model.ts`, `app/(auth)/login/page.tsx`,
`features/auth/components/*`, `features/auth/actions.ts`, `app/(app)/layout.tsx`,
`components/shared/{PageHeader,ConfirmDialog}.tsx`, `scripts/bootstrap-owner.ts`,
`lib/rate-limit.ts`, `lib/result.ts`, `lib/errors.ts`, `lib/logger.ts`.
**Modifies:** `next.config.*` (security headers, Section 2.5), `vercel.json`.
**Depends on:** nothing (foundation layer).
**Acceptance criteria:** Session tests T1–T5 (Section 11) pass locally against
mongodb-memory-server; role rank enforced in `requireUser` with unit tests for all four roles;
lockout at 5 failed attempts; security headers present via `curl -I` against dev server.
**Expected output:** a deployable shell where a bootstrapped owner can log in, see an empty
sidebar-nav'd dashboard stub, and stay logged in across a simulated 30-day rolling window.

### M2 — Financial Engine, Schemas, Money/Date Libraries
**Goal:** Every formula in Section 4.3 and every model in Section 5 exists and is unit-tested,
with zero UI.
**Creates:** all `database/models/*.ts` (12 collections), `lib/money.ts`, `lib/dates.ts`,
`server/repositories/*.ts` (one per collection), `server/services/financial-engine.ts`,
`types/engine.ts`, `constants/finance.ts`, `schemas/*.schema.ts` (all entities).
**Modifies:** none (new layer).
**Depends on:** M1 (`database/connection.ts`).
**Acceptance criteria:** unit suite green including the full status truth table (4.4, every
row), carry-move invariant (total due unchanged across a rollover), overpayment surplus
application, reversal math, transfer exclusion from income/expense aggregates, and the
`closing == opening + net` assertion under generated random transaction sets.
**Expected output:** `financial-engine.ts` fully implements the Section 4.2 function list
against a real (memory-server) replica set, callable from a Node script with no HTTP layer.

### M3 — Clients, Billing, Payments, Reversals
**Goal:** The core money-in loop end-to-end: create client → bill → record payment → reverse.
**Creates:** `features/clients/*`, `features/payments/*`, `app/(app)/clients/**`,
`components/shared/{DataTable,AmountText,StatusBadge,DateFieldIST,ClientSelect,DrilldownCard}.tsx`,
`server/services/clients.service.ts`, `payments.service.ts`, `audit.service.ts`,
`lib/idempotency.ts`.
**Modifies:** `app/(app)/layout.tsx` nav (enable Clients).
**Depends on:** M1 (auth), M2 (engine, schemas, repositories).
**Acceptance criteria:** integration suite green (atomicity, idempotent replay, concurrent
payment sum-exactness, reversal restoring balances/status/notifications, counters unique
under 50 parallel payments); E2E: create client (5 required fields) → ₹8,000 partial →
PARTIALLY_PAID trail → ₹12,000 → FULLY_PAID → dashboard-equivalent numbers consistent
(dashboard itself lands in M5, but the underlying `getClientMonthStatus` numbers are asserted
here).
**Expected output:** `/clients`, `/clients/new`, `/clients/[id]` fully functional per Section
7.2–7.4 with real payment recording and reversal.

### M4 — Accounts, Expenses, Credits, Transfers
**Goal:** Complete the money-out/lateral loop and account lifecycle.
**Creates:** `features/accounts/*`, `features/expenses/*`, `features/credits/*`,
`app/(app)/ledger/{accounts,expenses,credits}/**`, `server/services/{accounts,expenses,
credits,transfers}.service.ts`, `components/shared/{AccountSelect,FileUpload}.tsx`,
`lib/cloudinary.ts`, `app/api/uploads/sign/route.ts`.
**Modifies:** `app/(app)/ledger/layout.tsx` (sub-tab bar, new).
**Depends on:** M2 (engine), M3 (payments patterns reused for expense/credit atomicity).
**Acceptance criteria:** atomicity + counter tests from Section 15; insufficient-balance block
and owner override both tested; transfer both-legs atomicity; archive-with-nonzero-balance
blocked; upload sign/verify flow tested against a real Cloudinary sandbox
(`scripts/cloudinary-check.ts`).
**Expected output:** `/ledger/accounts`, `/ledger/accounts/[id]`, `/ledger/expenses`,
`/ledger/credits` fully functional with attachments.

### M5 — Overview, Dues, Dashboard
**Goal:** All aggregate/drilldown screens wired to the sibling-list rule (4.6).
**Creates:** `app/(app)/dashboard/page.tsx` (real), `app/(app)/ledger/overview/page.tsx`,
`app/(app)/ledger/dues/page.tsx`, `components/shared/{MonthPicker,KpiCard,DrilldownCard
(dev-mode assertion)}.tsx`, chart components (dynamic-imported Recharts).
**Modifies:** dashboard stub from M1 replaced with real composed call.
**Depends on:** M2 (engine's overview/dues functions), M3+M4 (data to aggregate).
**Acceptance criteria:** drill-down equality E2E (card value === sum of sibling list rows,
asserted numerically, not just visually) for every KPI card and every math-block line;
reconciliation banner appears correctly when a seeded drift exists and never shows
conflicting numbers.
**Expected output:** dashboard, overview, and dues screens match Section 7.1/7.5/7.10 exactly,
including the dev-mode `DrilldownCard` runtime assertion.

### M6 — Notifications, Cron, Audit
**Goal:** Background jobs and the audit trail are live and idempotent.
**Creates:** `app/(app)/notifications/page.tsx`, `app/(app)/audit/page.tsx`,
`app/api/notifications/poll/route.ts`, `app/api/cron/daily/route.ts`,
`server/services/{notifications,reconciliation,rollover}.service.ts`,
`features/notifications/*`, `features/audit/components/*`, `constants/{audit-actions,
notification-types}.ts`.
**Modifies:** every service touched in M3/M4 gains its notification-emitting side effects if
not already present (payment/expense/credit notifications were built alongside their services
in M3/M4 per Section 6's atomic-transaction requirement — M6 adds the cron-driven ones:
rollover, due reminders, month summary, reconciliation).
**Depends on:** M3, M4, M5 (needs real data to notify about).
**Acceptance criteria:** idempotent cron proof (run 5× → one billing per client-month, one
notification per dedupeKey); missed-day self-heal test; reconcile-fuzz smoke (small scale
here, full 10k-op gate is M8).
**Expected output:** `/notifications`, `/audit` functional; `/api/cron/daily` verified
locally with `CRON_SECRET`.

### M7 — Exports, Settings, Users
**Goal:** Owner-facing administration and CSV exports.
**Creates:** `app/(app)/settings/**`, `app/api/export/*/route.ts`,
`server/services/{export,settings}.service.ts`, `features/settings/actions.ts`, `lib/csv.ts`.
**Modifies:** `server/auth/guards.ts` (if any owner-only nuance surfaces), nav to enable
Settings/Audit visibility per role.
**Depends on:** M1 (roles), M2–M6 (data to export/administer).
**Acceptance criteria:** WYSIWYG export test (export rows === screen rows for an identical
filter); last-active-owner guard blocks deactivation; role change is audit-logged and takes
effect on the *next* request per edge case 40.
**Expected output:** `/settings`, `/settings/users`, all four `/api/export/*` endpoints
functional.

### M8 — Hardening
**Goal:** Full production checklist item that isn't inherently tied to a feature: security
review, performance budgets, accessibility, full test gates.
**Creates:** `scripts/verify-indexes.ts`, `scripts/reconcile-fuzz.ts`, `scripts/db-check.ts`,
`scripts/cloudinary-check.ts`, CI workflow files, `@next/bundle-analyzer` config.
**Modifies:** any hot query found to COLLSCAN; any route exceeding the 250KB JS budget
(code-split further); CSP nonce tightening if straightforward.
**Depends on:** M1–M7 (needs the whole app surface to audit).
**Acceptance criteria:** Section 15's full production checklist ticked except the
deployment-only items (D1 etc., deferred to M9/M10); `reconcile-fuzz.ts` (10,000 random valid
ops) passes; zero COLLSCAN; Lighthouse budgets met against a production build run locally.
**Expected output:** a release-candidate build (tag-ready) passing every gate in Section 15
that doesn't require a live deployment.

### M9 — Provisioning, Staging Rehearsal, Production Deploy
**Goal:** Section 17.1–17.4 executed exactly. Requires human input at H1–H4 (Atlas, Cloudinary,
Vercel/domain, owner credentials) — will pause and hand the user exact numbered instructions
at each.
**Creates:** staging env wiring, `docs/RUNBOOK.md` skeleton, `scripts/smoke-prod.ts`.
**Modifies:** `vercel.json` (confirm regions/cron live), env vars in Vercel (via CLI, not
committed).
**Depends on:** M8 (must be release-candidate quality before touching prod).
**Acceptance criteria:** 17.1–17.4 all complete — prod deployed in `bom1`, cron verified
manually once, owner bootstrapped in production, `smoke-prod.ts` all-green against the
deployed URL.
**Expected output:** a live, empty (no real business data yet) production system, reachable
at its final URL, passing the automated smoke suite (17.4).

### M10 — Go-Live and Handover
**Goal:** Section 16 D1–D7 all demonstrably true.
**Creates:** `docs/RUNBOOK.md` (complete, Section 18 content).
**Modifies:** production data (real accounts, real clients, real opening balances — entered
with the user, not invented).
**Depends on:** M9.
**Acceptance criteria:** owner has changed password, set thresholds, entered real opening
balances matching `settings.goLiveDate`; all H5-list users created and can log in; session
T1–T5 and the smoke suite re-run against production; one backup restore drill performed; one
rollback (promote-previous-deployment) tested; `/ledger/overview` closing position verified
to equal the sum of real account balances (sign-off moment per 17.5.3).
**Expected output:** system in real daily use, `docs/RUNBOOK.md` delivered, hypercare period
(18.4) started.

---

## Dependency Graph

```
                         ┌────────────────────────┐
                         │ config/env.ts           │
                         │ database/connection.ts  │   (M1 foundation)
                         └───────────┬─────────────┘
                                     │
                 ┌───────────────────┼───────────────────┐
                 ▼                                        ▼
        server/auth/auth.ts                      lib/{money,dates,result,
        server/auth/guards.ts                     errors,logger,rate-limit}.ts
        middleware.ts                             constants/finance.ts
        (M1)                                       (M2, no deps beyond M1's connection)
                 │                                        │
                 ▼                                        ▼
        app/(app)/layout.tsx                    database/models/*.ts (12 collections)
        (auth-guarded shell)                     schemas/*.schema.ts
                 │                                        │
                 │                                        ▼
                 │                             server/repositories/*.ts
                 │                                        │
                 │                                        ▼
                 │                      server/services/financial-engine.ts
                 │                      (M2 — pure functions, fully unit-tested
                 │                       before any feature consumes it)
                 │                                        │
                 └───────────────┬────────────────────────┘
                                  ▼
              server/services/{clients,payments,accounts,expenses,
                                credits,transfers,audit}.service.ts   (M3, M4)
                                  │
              ┌───────────────────┼───────────────────┐
              ▼                                        ▼
     features/*/actions.ts                   app/(app)/{clients,ledger}/**
     (Server Actions, M3/M4)                  (RSC pages calling services
              │                                in-process, M3/M4)
              ▼
     components/shared/* (DataTable, AmountText, StatusBadge, DrilldownCard,
     AccountSelect, ClientSelect, FileUpload, ConfirmDialog, ...) — built
     incrementally as each feature first needs them, M3 onward
              │
              ▼
     server/services/{notifications,rollover,reconciliation}.service.ts (M6)
     — depends on financial-engine (M2) AND on payments/expenses/credits
       services (M3/M4) already emitting their inline notifications
              │
              ▼
     app/api/cron/daily/route.ts, app/(app)/{notifications,audit}/**  (M6)
              │
              ▼
     server/services/{export,settings}.service.ts, app/api/export/*,
     app/(app)/settings/**   (M7 — depends on everything above existing
     to have data worth exporting/administering)
              │
              ▼
     M8 Hardening (scripts/verify-indexes, reconcile-fuzz, perf/security
     pass) — depends on the full M1–M7 surface existing
              │
              ▼
     M9 Provisioning + Deploy — depends on M8 release-candidate
              │
              ▼
     M10 Go-Live — depends on M9's live production system
```

**Cross-cutting dependencies that don't fit the linear chain:**
- `lib/idempotency.ts` (M3) is reused unchanged by every mutating service in M3–M7.
- `AuditLog` writes (Law 9) are wired into *every* service from the moment that service is
  built (not deferred to M6) — M6 only adds the cron-triggered audit events
  (`RECONCILE_RUN`, `CRON_RUN`) and the `/audit` UI itself.
- `components/shared/DrilldownCard`'s dev-mode sum-assertion (4.6) depends on both the engine
  function (M2) and the corresponding `listTransactions`/list-fn (M3/M4) existing — it can
  only be fully wired in M5 once dashboard/overview compose both sides.
- Rate limiting (`lib/rate-limit.ts`, M1) wraps every Server Action from M3 onward — never
  deferred.

---

## Open Assumptions Flagged to User (not in spec, decided per "ask, don't invent" rule)

These are implementation defaults chosen where Section 14/elsewhere is silent. Flagging per
the master prompt's instruction to ask rather than assume — proceeding with the stated default
unless corrected:

1. **Attachment count cap per entity** (edge case 49 above): defaulting to 5 files/entity.
2. **Rate-limiter fail-open/closed policy** (edge case 50 above): defaulting to fail-open for
   reads, fail-closed (reject) for money mutations after one bounded retry.
3. **`isDefault` account race** (edge case 46 above): defaulting to optimistic-lock + retry
   rather than a global mutex, consistent with the rest of the spec's optimistic-locking
   pattern (clients/accounts/billings all use `version`).

If any of these three should be handled differently, say so before M4 (accounts) / M1
(rate-limit) land — everything else in this roadmap is taken directly from the spec with no
invented behavior.
