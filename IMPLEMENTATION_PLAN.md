# Implementation Plan — Production Stabilization Pass

This is the finalized version of the plan approved before implementation
began (Section 15/M8 hardening pass). See `BUG_AUDIT.md` for the full
findings this plan responds to, and `FIX_REPORT.md` for what actually
happened per item.

## Context

The application was audited end-to-end (routes/navigation, backend/CRUD/
DB models/financial engine, forms/auth/security/UI-state) against the
Finance & Ledger specification, per instructions not to stop at explicitly
-named issues but to do a complete product audit first.

Finding: the core app (CRUD, the financial engine, auth, forms) is
unusually mature — no systemic gaps. The real gaps split into two kinds:

- **(A) Confirmed defects/polish in existing, shipped modules** — fixable
  now, no new product surface.
- **(B) Four modules the spec expects that don't exist at all** (Reports,
  standalone Invoice/Receipt management, global search, Help/Support) —
  each needs real product decisions (e.g. what a "Report" should contain)
  that can't be inferred from the codebase alone.

Decision: **fix (A) now to true production quality; defer (B) to
`KNOWN_LIMITATIONS.md`** with a recommended scope for a future pass,
rather than guessing at requirements for net-new modules.

## Module dependencies / order of work

Work proceeded in three priority tiers, each self-contained (no item
depended on a later one):

1. **P1 — quick, safe, high-value.** Independent one- or two-file changes:
   confirming a nav link, adding an error boundary, deleting dead code,
   money-formatting consistency, adding a missing validator. No shared
   state between these items.
2. **P2 — medium effort, self-contained.** The clients-pagination change
   touches the repository → service → page chain for one entity only;
   the toast-standardization and audit-dialog changes are UI-only. None
   interact with each other or with P3.
3. **P3 — the app shell.** Deliberately last and isolated: it changes
   `AppSidebar`/`AppTopbar`/a new Zustand store, which every page renders
   through, so it carried the highest regression risk and got the most
   dedicated browser verification (mobile/tablet/desktop, plus a desktop
   regression check of the existing collapse toggle).

Two additional defects (a server-actions crash and an audit-log data leak)
surfaced *during* manual verification of the above and were fixed inline,
since both blocked verifying P1.5/P2.8's own correctness. See
`BUG_AUDIT.md` §10.2–10.3 and `FIX_REPORT.md` #10.

## Scope executed

### P1 — Quick, safe, high-value
1. Verified `/clients/new`'s "New Client" button already links correctly
   (`ClientsTableView.tsx`) — no fix needed.
2. Added `src/app/error.tsx`, a root-level branded error boundary
   (renders inside the existing root layout — not `global-error.tsx`,
   which would need its own `<html>/<body>` and is only for failures in
   the root layout itself, a different, unaffected failure mode here).
3. Removed 4 dead exports (`findBillingsByClientIds`,
   `findTransactionById`, `getClientTotalDueForArchiveWarning`,
   `listClients`) and the now-fully-dead `getEarliestActivityMonthKey` +
   `findEarliestTransaction` pair, plus their test coverage.
4. Replaced inline `paise / 100` with `lib/money.ts#paiseToRupeesPlain` in
   4 form components.
5. Added a `zodResolver(updateSettingsSchema)` to `SettingsForm` (reusing
   the schema already used server-side, rather than inventing a second
   one).

### P2 — Medium effort, self-contained
6. Converted `getClientsListView`'s in-memory pagination to true DB-level
   pagination: `findClientsFiltered` gained `page`/`pageSize` (skip/limit
   at the Mongo query level) and a sibling `countClientsFiltered`; the
   per-client enrichment fan-out (`getClientMonthStatus`/
   `getClientTotalDue`/`findPaymentsByClient`) now runs only for the
   current page's rows. `exportClientsCsv` was updated to pass the
   already-established `EXPORT_ALL_PAGE_SIZE` sentinel (the export file
   already had this constant ready for exactly this signature change).
7. Added `toast.success(...)` (existing `sonner` pattern from
   `AccountSettingsForm`) to `SettingsForm`, `CreateAccountSheet`,
   `EditAccountSheet` (both its general-edit and opening-balance save
   paths), and `EditClientSheet`.
8. Humanized `AuditDiffDialog`: Title-Cased field keys, `Paise`-suffixed
   fields reformatted through `formatINR`, plain objects rendered as a
   key-value list instead of raw JSON (arrays/primitives still fall back
   to JSON, unchanged). Deliberately did not build ID→name resolution —
   judged over-scoped for one admin-only dialog; the raw ObjectId still
   renders, but readably and without crashing (see item 10 below for the
   crash that *was* fixed).

### P3 — The big one
9. Rebuilt the app shell for mobile: `AppSidebar` now renders a desktop
   `<aside>` (`hidden md:flex`, unchanged above `md:`) plus a mobile
   off-canvas drawer reusing the existing `Sheet` primitive (`side="left"`)
   — no new floating-UI/focus-trap code needed. `AppTopbar` gained a
   hamburger trigger (`md:hidden`). A new non-persisted Zustand store
   (`mobile-nav-store.ts`) coordinates open/close between them, mirroring
   the existing `sidebar-store.ts` pattern minus persistence (the drawer
   should always start closed on a fresh load).

### Fixed inline (discovered during verification, not in the original plan)
10. A `"use server"` file (`settings/actions.ts`) re-exporting a type
    (`export type { CreateUserResult, UserRow }`) crashed every action in
    the file at runtime (`ReferenceError`) — this Next.js version's
    server-actions bundler doesn't elide type-only re-exports correctly.
    Removed the re-export; the two consumers now import the type from its
    origin (`@/server/services/settings.service`) directly. Separately,
    `listAuditLogs` was passing raw Mongoose `.lean()` values (including
    BSON ObjectIds) straight through to `AuditDiffDialog`, a Client
    Component — fixed with a JSON round-trip at the single choke point
    (`listAuditLogs`) rather than touching every `logAudit` call site.

## Explicitly out of scope this pass (→ `KNOWN_LIMITATIONS.md`)
- Reports module, standalone Invoice/Receipt management UI, global
  search, Help/Support.
- CSP `'unsafe-inline'` hardening — real fix risks breaking every
  floating-UI component's inline positioning styles; needs dedicated
  testing, not a same-pass change.
- `proxy.ts` presence-only pre-check redundancy — informational only.
- Minor Ledger sub-nav tab overflow at ~390px width — cosmetic, unrelated
  to the app-shell fix, noticed incidentally during its verification.

## Verification performed
See `REGRESSION_REPORT.md` for the full, itemized results. Summary: full
`vitest` suite (189/189 passing, +2 net new tests), `tsc --noEmit` clean,
`eslint .` clean (0 errors, same 4 pre-existing warnings in untouched
files), and a Playwright-driven manual browser pass covering the range-
picker regression surface, clients pagination, Settings validation +
toast, the Audit diff dialog, and the mobile drawer at 375/390/414/768/
820/1440px — including a desktop regression check of the pre-existing
sidebar collapse toggle.
