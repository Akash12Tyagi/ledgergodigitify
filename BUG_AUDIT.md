# Bug Audit — GoDigitify Finance & Ledger System

Produced by a full-application audit (routes/navigation, backend/CRUD/DB,
forms/auth/security/UI-state) prior to the Section 15/M8 stabilization pass.
Every item below was independently verified by reading the relevant code
(not inferred from patterns alone). Status reflects the outcome of this
pass — see `FIX_REPORT.md` for implementation detail on anything marked
**Fixed**.

Overall finding: the core application (CRUD, financial engine, auth,
forms) is unusually mature for its stage. Money-mutating flows are
transactional, idempotent, audited, and reconciled against the ledger on a
schedule. The defects below are real but narrow — no systemic issues were
found in balance calculation, ledger integrity, or authorization.

---

## 1. Dashboard Module

No open issues. The From–To range picker (Issue 1.1/1.2) was completed
and verified in a prior pass: future months disabled, cookie persistence,
range summing verified against raw DB data, no shared-state conflict with
`/ledger/overview`'s independent `MonthPicker`.

## 2. Notifications Module

No open issues found. Route resolves, badge/mark-as-read logic backed by
`dedupeKey`-based idempotent inserts, polling works.

## 3. Profile Module

No open issues. `AccountSettingsForm`/`ChangePasswordCard` already had
full validation + toast feedback — used as the reference pattern for
fixes elsewhere (see `FIX_REPORT.md` #7).

## 4. Client Module

### 4.1 — In-memory pagination (Medium, scalability)
**File:** `src/server/services/clients.service.ts` (`getClientsListView`),
`src/app/(app)/clients/page.tsx`
**Root cause:** `getClientsListView` fetched *every* client matching the
current filter, ran 3 per-client engine calls
(`getClientMonthStatus`/`getClientTotalDue`/`findPaymentsByClient`) on all
of them, then the page sliced the result in memory for the requested
page. Every page load paid the full-roster enrichment cost regardless of
page size. The code's own comment already flagged this as deferred
("a hardening-pass optimization... not a v1 requirement").
**Status:** Fixed — see `FIX_REPORT.md` #6.

### 4.2 — `/clients/new` has no nav entry
**Verified not a bug.** The page works and is reachable via the "New
Client" button on `/clients` (`ClientsTableView.tsx:61,114`). Not linking
it from the sidebar is the intended pattern (create flows launch from a
list page's action button, matching every other entity in the app).
**Status:** No action needed.

## 5. Account Module

No raw ObjectId exposure found in any account `<Select>`/dropdown —
`AccountSelect` and all form pickers render human-readable names, not IDs
(Issue 5.1 from the original tracker was already resolved before this
pass).

## 6. Routing

### 6.1 — No root-level or `(app)`-group `error.tsx` (Low)
**Root cause:** Every leaf route (`dashboard`, `clients`, `ledger/*`,
etc.) has its own `error.tsx`, but nothing existed above them. A failure
inside `(app)/layout.tsx` itself (e.g. an unexpected throw from
`requireUser`) or on `/login` would fall through to Next's unstyled
default error page instead of the app's branded one.
**Status:** Fixed — see `FIX_REPORT.md` #2.

No broken links, no orphaned nav targets, no `href="#"` stubs anywhere in
the codebase.

## 7. Forms & Validation

### 7.1 — `SettingsForm` had no client-side validation (Medium)
**File:** `src/features/settings/components/SettingsForm.tsx`
**Root cause:** Every other form in the app pairs `useForm` with a
`zodResolver`; this one had none. Numeric/date edge cases (negative
`dueSoonDays`, malformed dates) were only caught after a round-trip to
the server, unlike the rest of the app's fail-fast pattern.
**Status:** Fixed — see `FIX_REPORT.md` #5.

### 7.2 — Inconsistent success feedback on non-navigating saves (Low)
**Files:** `SettingsForm.tsx`, `CreateAccountSheet.tsx`,
`EditAccountSheet.tsx`, `EditClientSheet.tsx`
**Root cause:** Some forms toast on save (`AccountSettingsForm`,
`ChangePasswordCard`), some did nothing beyond an implicit
`router.refresh()` — a save could look like it silently no-opped.
**Status:** Fixed — see `FIX_REPORT.md` #7.

### 7.3 — Inline `paise / 100` instead of the shared money helper (Low, cosmetic)
**Files:** `EditClientSheet.tsx`, `SettingsForm.tsx`,
`RecordPaymentSheet.tsx`, `EditAccountSheet.tsx`
**Root cause:** `lib/money.ts` exports `paiseToRupeesPlain` specifically
for this (plain-numeric string, no currency symbol) but four call sites
reimplemented it inline with float division — a latent precision risk
for paise values that don't divide evenly, and duplicated logic in
violation of the codebase's own "Law 10."
**Status:** Fixed — see `FIX_REPORT.md` #4.

## 8. UI & UX Improvements

### 8.1 — App shell has zero responsive breakpoints (High)
**Files:** `AppSidebar.tsx`, `AppTopbar.tsx`, `(app)/layout.tsx`
**Root cause:** The sidebar is a fixed 64px/240px `<aside>` with no
`sm:`/`md:`/`lg:` classes anywhere, and no hamburger/drawer alternative.
At phone width (~375–414px) the fixed rail plus topbar left almost no
room for content — tables, KPI grids, and forms were squeezed into an
unusably narrow column. Independently reproduced with screenshots during
the prior Dashboard range-picker verification.
**Status:** Fixed — see `FIX_REPORT.md` #9. This was the single highest-
severity finding from the audit.

### 8.2 — `AuditDiffDialog` renders raw JSON (Low–Medium)
**File:** `src/features/audit/components/AuditDiffDialog.tsx`
**Root cause:** `JSON.stringify(value, null, 2)` in a `<pre>` block — raw
field names (`amountPaise`, `clientId`) and values with no
humanization. Admin-only surface (`requireUser("admin")`), so this was
readability, not a true security leak.
**Status:** Fixed — see `FIX_REPORT.md` #8.

### 8.3 — Minor Ledger sub-nav tab overflow at phone width (Low, not fixed this pass)
`/ledger/overview`'s tab bar (Overview / Dues / Accounts / Expenses /
Credits) overflows slightly at 390px, clipping "Credits" to "Cr". Noticed
during mobile verification of the app-shell fix; distinct from the shell
issue and out of scope for this pass. See `KNOWN_LIMITATIONS.md`.

## 9. Performance Review

No duplicate API requests found in the range-picker or clients-pagination
interaction flows (verified: exactly one POST + one GET per user action).
The clients in-memory-pagination issue (4.1 above) was the one confirmed
performance defect; fixed.

## 10. Security Review

No gaps found in authentication, session handling, role-based access
control, or API authorization. Specifically verified:
- `requireUser` re-reads the user's role from the DB on every call (never
  trusts session/cookie-cache), correctly defeating a mid-session role
  downgrade.
- Every `(app)` route has an appropriate minimum-role guard (verified
  page-by-page).
- Two-layer duplicate-submission protection: UI-level (`disabled={pending}`)
  plus server-side idempotency keys on every financial mutation, turning a
  double-submit into a detected `IDEMPOTENT_REPLAY`, not a double charge.
- Mongo-backed rate limiting (auth/mutation/export scopes) plus an
  independent DB-backed login-lockout mechanism.
- A NoSQL-injection guard (`parseActionInput`) deep-rejects any key
  starting with `$` or containing `.` before Zod/Mongo ever see it.

### 10.1 — CSP allows `'unsafe-inline'` on `script-src`/`style-src` (Medium, not fixed this pass)
`next.config.ts`'s CSP weakens XSS mitigation for script injection
specifically. Deferred — see `KNOWN_LIMITATIONS.md` for why a nonce-based
rewrite risks breaking every floating-UI component in the app (popovers,
selects, sheets all rely on inline `style` for positioning) and needs
dedicated testing, not a same-pass change.

### 10.2 — `AuditDiffDialog` passed raw ObjectId/Buffer values to a Client Component (Medium — discovered and fixed during this pass, not in the original 3-agent audit)
**File:** `src/server/services/audit.service.ts` (`listAuditLogs`)
**Root cause:** `logAudit`'s `before`/`after` is a Mongoose `Mixed` field
storing whatever a service passed in verbatim — frequently a raw
`.lean()` document containing a real BSON ObjectId (e.g.
`updateSettings`'s `updatedBy`). `listAuditLogs` passed these straight
through into `AuditLogRow`, which flows into `AuditDiffDialog` (a Client
Component) as a prop. React's Flight/RSC serialization doesn't support
arbitrary classes with a `toJSON` method (ObjectId has one; Date is
specially supported and was fine) — this reliably threw a "Only plain
objects can be passed to Client Components" warning while viewing any
audit entry for an entity update (client edits, status changes, settings
changes — anywhere a raw `.lean()` doc was logged as `before`/`after`).
Discovered only because manual verification of this pass's own fixes
happened to save Settings and immediately view `/audit` — not previously
exercised together in dev.
**Status:** Fixed. `listAuditLogs` now JSON-round-trips `before`/`after`
before returning them, which converts every ObjectId/Date to its string
form (both have `toJSON`) regardless of how the entry was originally
stored — fixing every existing stored entry, not just future ones. See
`FIX_REPORT.md` #10.

### 10.3 — `updateSettingsAction`/500 crash from a `"use server"` file re-exporting a type (Critical — discovered and fixed during this pass)
**File:** `src/features/settings/actions.ts`
**Root cause:** `export type { CreateUserResult, UserRow };` inside a
`"use server"` file. This Next.js version's server-actions bundler does
not correctly elide this type-only re-export from the action-reference
manifest it generates, producing a runtime `ReferenceError:
CreateUserResult is not defined` on every `POST` to any action in the
file — including `updateSettingsAction`, breaking the entire Settings
save flow with a 500. Reproduced twice, including after a full `.next`
cache clear, ruling out a transient dev-cache artifact.
**Status:** Fixed. Removed the type re-export; the two components that
imported `UserRow` through it now import directly from
`@/server/services/settings.service`, the type's origin. See
`FIX_REPORT.md` #10.

## 11. Financial Integrity Review

No issues found. Balances are incrementally updated (`$inc`) inside DB
transactions; the ledger has a single insert path; a real
derive-vs-materialized reconciliation job runs on a schedule and locks any
account with nonzero drift. No client-side money math exists anywhere
(only cosmetic `paise/100` display conversions, addressed in 7.3). Cross-
checked dashboard/ledger figures against raw MongoDB data directly during
the prior Dashboard range-picker verification — matched to the rupee.

## 12. Dead Code / Duplication

- **4 dead exported functions**, never imported anywhere:
  `findBillingsByClientIds`, `findTransactionById`,
  `getClientTotalDueForArchiveWarning`, `listClients` (superseded by
  `getClientsListView`). **Status:** Removed — see `FIX_REPORT.md` #3.
- **`getEarliestActivityMonthKey`** (and its sole caller,
  `findEarliestTransaction`) — only exercised by its own unit test; its
  doc-comment claimed `dashboard/page.tsx` used it as a fallback, which it
  did not (per the prior Dashboard range-picker work, which deliberately
  removed that implicit floor). **Status:** Removed along with its dead
  test — see `FIX_REPORT.md` #3.

## 13. Missing Modules (expected by spec, don't exist)

Reports, standalone Invoice/Receipt management, global search, and
Help/Support. Each needs product scoping before any code should be
written. See `KNOWN_LIMITATIONS.md` for a recommended v1 scope per
module, deliberately deferred rather than guessed at in this pass.
