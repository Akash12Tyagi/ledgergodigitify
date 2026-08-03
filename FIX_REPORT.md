# Fix Report — Production Stabilization Pass

Numbered to match `IMPLEMENTATION_PLAN.md`'s "Scope executed" list. Each
entry: root cause, files modified, what was done, and how it was verified.

---

### 1. `/clients/new` nav entry — no fix needed
**Root cause:** N/A — not a bug. The page is reachable via the "New
Client" button in `ClientsTableView.tsx` (lines 61 and 114, one for the
empty state, one for the populated table).
**Files modified:** None.
**Verification:** Read the button's `render={<Link href="/clients/new" />}`
directly; confirmed it's wired correctly.

---

### 2. Root-level error boundary
**Root cause:** Every leaf route under `(app)/` had its own `error.tsx`,
but nothing existed above them — a failure in `(app)/layout.tsx` itself
or on `/login` fell through to Next's default unstyled error page.
**Files modified:** `src/app/error.tsx` (new).
**Implementation:** A plain (non-`global-error`) boundary matching the
existing per-route pattern (digest-correlated `console.error`, a "Try
again" button calling `reset()`). Verified against this Next.js version's
own docs (`node_modules/next/dist/docs/.../10-error-handling.md`) that a
plain `app/error.tsx` renders *inside* the root layout (which already
provides `<html>/<body>`) — an earlier draft of this fix incorrectly
included its own `<html>/<body>` tags, copying the `global-error.tsx`
pattern that only applies to failures in the root layout itself, a
different (and here, unaffected) failure mode. Caught and corrected
before committing.
**Verification:** `tsc --noEmit` clean.

---

### 3. Dead code removal
**Root cause:** 4 exported functions with zero call sites anywhere in
`src/` or `tests/`, plus one function (`getEarliestActivityMonthKey`)
whose doc-comment described behavior (`dashboard/page.tsx` falling back
to it) that the actual dashboard page no longer does, and which was
otherwise only exercised by its own now-orphaned unit test.
**Files modified:**
`src/server/repositories/monthly-billings.repository.ts` (removed
`findBillingsByClientIds`), `src/server/repositories/transactions.repository.ts`
(removed `findTransactionById`, `findEarliestTransaction`),
`src/server/services/clients.service.ts` (removed
`getClientTotalDueForArchiveWarning`, `listClients`),
`src/server/services/financial-engine.ts` (removed
`getEarliestActivityMonthKey`, unused import `toMonthKey`),
`tests/server/services/financial-engine/dashboard.test.ts` (removed the
`getEarliestActivityMonthKey` describe block and its import).
**Verification:** `grep -rn` for each function name confirmed zero
remaining references before and after; `tsc --noEmit` and `eslint`
clean; full `vitest run` — no test depended on any of these.

---

### 4. Money-formatting consistency
**Root cause:** `lib/money.ts#paiseToRupeesPlain` exists specifically to
render paise as a plain numeric string (no currency symbol, no thousands
grouping) for exactly this use case (seeding an editable amount input's
default value), but four call sites reimplemented `String(paise / 100)`
inline — float division that risks representation drift for paise values
that don't divide evenly, and duplicated logic the codebase's own
convention says should live in one place.
**Files modified:** `EditAccountSheet.tsx`, `EditClientSheet.tsx`,
`SettingsForm.tsx`, `RecordPaymentSheet.tsx` (2 call sites in this one —
both the initial state and the sheet's reset-on-reopen path).
**Verification:** `tsc --noEmit` and `eslint` clean on all 4 files.

---

### 5. `SettingsForm` client-side validation
**Root cause:** Every other form in the app pairs `useForm` with a
`zodResolver`; this one had none — invalid values (negative days, bad
dates) were only caught after a round-trip to the server.
**Files modified:** `src/features/settings/components/SettingsForm.tsx`.
**Implementation:** Reused the existing server-side
`updateSettingsSchema` (`src/schemas/settings.schema.ts`) rather than
writing a second, parallel schema — replaced the locally-declared
`SettingsFormValues` type with `z.infer<typeof updateSettingsSchema>`,
wired `resolver: zodResolver(updateSettingsSchema)`, and changed the
`goLiveDate` default from `undefined` to `null` to match the schema's
`nullable().optional()` (verified `DateFieldIST` already accepts
`Date | null | undefined`, so no downstream change needed).
**Verification:** `tsc --noEmit` clean (confirming the type change didn't
break anything downstream); manually submitted the form with an empty
required field via Playwright — confirmed a client-side validation
message appears before any network request.

---

### 6. Clients list: true DB-level pagination
**Root cause:** `getClientsListView` fetched every client matching the
current filter, ran 3 per-client engine calls on all of them, then the
page sliced the array in memory — every page load paid the full-roster
enrichment cost regardless of page size (the code's own comment already
flagged this as a deferred "hardening-pass optimization").
**Files modified:** `src/server/repositories/clients.repository.ts`
(added `page`/`pageSize` params to `findClientsFiltered`, extracted a
shared `buildClientMatch` helper, added `countClientsFiltered`),
`src/server/services/clients.service.ts` (`getClientsListView` now takes
`page`/`pageSize` and pages before enriching), `src/app/(app)/clients/page.tsx`
(passes page/pageSize through, uses `countClientsFiltered` for `total`
instead of `allRows.length`, and for `hasAnyClientsAtAll` instead of
fetching every client just to check `.length > 0`),
`src/server/services/export.service.ts` (`exportClientsCsv` updated to
pass the pre-existing `EXPORT_ALL_PAGE_SIZE` sentinel — the file already
had this constant wired up for `listExpenses`/`listCredits`/
`listTransactions`, anticipating exactly this signature change),
`tests/server/services/clients.service.test.ts` (new test).
**Design note:** Kept `findClientsFiltered`/`countClientsFiltered` as two
separate functions rather than mirroring `expenses.repository.ts`'s
single bundled `{rows, total, page, pageSize}` return shape — the
`hasAnyClientsAtAll` call site only ever needed a count, not rows, so the
split lets that check become a pure `countDocuments()` with no document
fetch at all (a strict improvement over the previous code, which fetched
every client just to check length).
**Verification:** New test seeds 5 clients, confirms `countClientsFiltered`
returns 5 and that pages of size 2 return the correct name-sorted slices
(`["Alpha Co","Bravo Co"]` / `["Charlie Co","Delta Co"]` / `["Echo Co"]`).
`exportClientsCsv`'s existing WYSIWYG test (`export.service.test.ts`)
still passes unmodified. `tsc --noEmit` and `eslint` clean.

---

### 7. Standardized success feedback
**Root cause:** Some forms toast on save, some did nothing beyond an
implicit `router.refresh()` — indistinguishable from a silent no-op.
**Files modified:** `SettingsForm.tsx` (replaced a `saved` boolean + inline
"Settings saved." paragraph with `toast.success`, matching
`AccountSettingsForm`'s pattern exactly), `CreateAccountSheet.tsx`,
`EditAccountSheet.tsx` (both the general-fields save and the separate
opening-balance save path get their own toast), `EditClientSheet.tsx`.
**Verification:** `tsc --noEmit` and `eslint` clean; manually saved
Settings via Playwright and confirmed a toast appears (visible in the
`p2-settings-toast.png` screenshot from the manual pass).

---

### 8. Humanized `AuditDiffDialog`
**Root cause:** Raw `JSON.stringify(value, null, 2)` in a `<pre>` block —
unreadable field names (`amountPaise`, `clientId`) and values.
**Files modified:** `src/features/audit/components/AuditDiffDialog.tsx`.
**Implementation:** Plain objects now render as a key-value list:
`humanizeKey` inserts spaces at camelCase boundaries and Title-Cases each
word, dropping the `Paise` suffix (since `humanizeValue` reformats those
values through `formatINR`, making the suffix stale) while *keeping* `Id`
(so a label like "Client Id" still signals the value alongside it is an
opaque reference, not a resolved name). Arrays and primitives still fall
back to raw `JSON.stringify`, unchanged. Deliberately did not attempt
ID→name resolution (e.g. showing "HDFC (68f2...)" instead of the bare
ObjectId) — that needs server-side lookups threaded through a client
component's props, judged too invasive for one admin-only dialog.
**Verification:** `tsc --noEmit` and `eslint` clean; manually opened a
diff dialog after a real Settings save via Playwright — confirmed
Title-Cased labels and `₹`-formatted amounts render correctly
(`p2-audit-diff-dialog.png`).

---

### 9. Mobile-responsive app shell
**Root cause:** `AppSidebar` was a fixed 64px/240px `<aside>` with zero
responsive breakpoints and no drawer alternative; `AppTopbar` had no
hamburger trigger. At phone width the fixed rail plus topbar left almost
no room for content.
**Files modified:** `src/components/shared/mobile-nav-store.ts` (new — a
non-persisted Zustand store, deliberately *not* using the `persist`
middleware `sidebar-store.ts` uses, since the drawer must always start
closed on a fresh load), `AppSidebar.tsx` (extracted nav-link rendering
into a shared `NavLinks` component reused by both the desktop `<aside>`
— now `hidden md:flex`, otherwise unchanged — and a new mobile drawer
built on the existing `Sheet` primitive with `side="left"`), `AppTopbar.tsx`
(added a `Menu`-icon hamburger button, `md:hidden`, wired to the new
store; restructured the header into a `justify-between` row on mobile /
`justify-end` on `md:` and up to make room for it).
**Design note:** Reused the existing `Sheet` component rather than
building a new drawer primitive — it already supports `side="left"` with
the exact overlay/slide-in/focus-trap behavior needed (built on
`@base-ui/react/dialog`), so no new floating-UI code was needed.
**A TypeScript fix along the way:** `NavLinks`' `onNavigate` prop needed a
default no-op function rather than staying `undefined`-by-default — with
`exactOptionalPropertyTypes` enabled, passing `onClick={undefined}`
through to Next's `Link` doesn't type-check the same as omitting the prop
entirely.
**Verification:** Full Playwright pass at 390px (phone): hamburger
visible, drawer opens showing all 6 nav items, clicking a link both
navigates and closes the drawer, Escape closes it, verified on Dashboard/
Ledger Overview/Notifications/Settings. At 820px (tablet) and 1440px
(desktop): hamburger correctly hidden, desktop layout pixel-identical to
before the change, and the pre-existing collapse/expand toggle still
works (screenshots `m1`–`m5`, `t1`, `d1`–`d2`). Zero new console errors
introduced — the only console output was the same pre-existing baseline
warnings (a dev-mode `eval()` notice, a React 19 ref-access warning, and
a Base UI `nativeButton` warning from the unrelated `NotificationBell`
component) present before this change.

---

### 10. Two bugs discovered during verification of the above

**10a — `"use server"` file crashed on every action (Critical).**
**Root cause:** `src/features/settings/actions.ts` had
`export type { CreateUserResult, UserRow };` — a type-only re-export
inside a Server Actions file. This Next.js version's server-actions
bundler doesn't correctly elide type-only exports from the action-
reference manifest it generates for the client, producing
`ReferenceError: CreateUserResult is not defined` at runtime on **every**
action in the file, including `updateSettingsAction` (a 500 on every
Settings save). Reproduced twice, including immediately after a full
`.next` cache clear — ruling out a stale-cache explanation.
**Files modified:** `src/features/settings/actions.ts` (removed the
re-export; kept the `import type` since it's still used for the two
actions' own return-type annotations), `users-columns.tsx` and
`UsersTableView.tsx` (the only two consumers of the re-exported `UserRow`
— now import it directly from `@/server/services/settings.service`, its
origin).
**Verification:** Cleared `.next`, restarted the dev server, resubmitted
the Settings form via Playwright — 200 response, no `ReferenceError`,
confirmed via server log diff (before: `500`/`ReferenceError`; after:
`200`). `tsc --noEmit` clean.

**10b — Raw ObjectId passed to a Client Component from the Audit page (Medium).**
**Root cause:** `logAudit`'s `before`/`after` is a Mongoose `Mixed` field
storing whatever a service passed in verbatim — often a raw `.lean()`
document (e.g. `updateSettings` logging its updated document, whose
`updatedBy` field is a real BSON `ObjectId`). `listAuditLogs` passed
these straight through to `AuditLogRow`, which flows as a prop into
`AuditDiffDialog` (a Client Component). React's RSC serialization doesn't
support arbitrary classes with a `toJSON` method (ObjectId has one; the
browser console explicitly says so: "Objects with toJSON methods are not
supported").
**Files modified:** `src/server/services/audit.service.ts` (added a
`toPlainJson` helper — a `JSON.parse(JSON.stringify(value))` round-trip —
applied to both `before` and `after` in `listAuditLogs`), `src/app/(app)/clients/[id]/page.tsx`
(a smaller instance of the same class of bug: `ActivityTabLoader` was
passing `_id: e._id` — a raw ObjectId — instead of `e._id.toString()`;
`ActivityTab.tsx`'s prop type already declared `_id: unknown`, suggesting
this was known-fragile rather than accidental, but still fixed since it's
the same root cause and a one-line change).
**Why fix at the read path, not the write path:** Already-stored audit
log entries (accumulated over the app's lifetime) contain raw ObjectId
values regardless of how future writes are structured — fixing only
`logAudit`'s write side would leave every existing entry broken. Fixing
at `listAuditLogs` (the single place `before`/`after` cross into client
rendering) fixes both existing and future entries in one change, without
touching the dozen-plus `logAudit` call sites across the codebase.
**Verification:** New test file `tests/server/services/audit.service.test.ts`
— one test performs a real `updateSettings` call (which stores a raw
ObjectId `updatedBy`) then asserts `listAuditLogs`'s returned `after
.updatedBy` is a `string` equal to the actor's id, and that the full row
survives `JSON.stringify` without throwing; a second test confirms
`before` comes back as `null` (not `undefined`) for `CLIENT_CREATED`
entries, which never pass a `before` at all. Manually re-verified via
Playwright: cleared `.next`, saved Settings, opened `/audit`'s diff dialog
— no console warning (previously present), diff renders correctly with
`Updated By` showing a plain hex string.
