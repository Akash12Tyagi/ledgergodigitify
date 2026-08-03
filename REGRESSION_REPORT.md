# Regression Report — Production Stabilization Pass

All checks below were run against a live dev server backed by the real
MongoDB Atlas dev database (not mocks), driven with a headless Playwright
session logged in as the seeded owner account, plus the project's own
`vitest` suite for anything not practical to check by hand.

## Automated

| Check | Expected | Actual | Status |
|---|---|---|---|
| `npx tsc --noEmit` (full project) | 0 errors | 0 errors | **Pass** |
| `npx eslint .` (full project) | 0 errors | 0 errors, 4 warnings (all pre-existing, in files this pass didn't touch — `DataTable.tsx`, `ClientForm.tsx`, `RecordPaymentSheet.tsx`, `AccountSettingsForm.tsx`, all "React Compiler skipped memoization" notices from React Hook Form's `watch()`) | **Pass** |
| `npx vitest run` (full suite) | All pass | 189/189 passed, 34 test files (was 188/33 before this pass: −2 for two removed dead-code tests, +3 for new pagination/audit-sanitization coverage) | **Pass** |

## Manual — Dashboard Range Picker (regression, not re-implemented this pass)

Not re-verified end-to-end this pass (already fully verified and committed
in the prior session covering Issue 1.1/1.2). Spot-checked only that the
Dashboard still renders correctly and shows correct figures after this
pass's app-shell change — see the app-shell rows below, same screenshots.

## Manual — Clients Pagination (new this pass)

| Check | Expected | Actual | Status |
|---|---|---|---|
| `/clients` loads after DB-level pagination change | Table renders, correct total count shown | "Page 1 of 1 · 1 total" rendered correctly against real seed data | **Pass** |
| Automated: 5 seeded clients, `pageSize=2` | Page 1 → Alpha/Bravo, Page 2 → Charlie/Delta, Page 3 → Echo | Exact match (`tests/server/services/clients.service.test.ts`) | **Pass** |
| `countClientsFiltered` matches roster size | 5 | 5 | **Pass** |
| CSV export (`exportClientsCsv`) still returns full roster, not one page | Row count === roster size for the filter | Existing WYSIWYG test (`export.service.test.ts`) unmodified, still passes | **Pass** |

## Manual — Settings Form

| Check | Expected | Actual | Status |
|---|---|---|---|
| Submit with required field (Company name) empty | Client-side validation message, no network request | Message shown before submit | **Pass** |
| Submit with valid values | 200 response, toast confirmation | 200; toast "Settings saved." appeared (`p2-settings-toast.png`) | **Pass** (after fixing the `CreateUserResult` crash — see below; failed on first attempt) |
| Settings page reload after save | New values persisted and displayed | Confirmed | **Pass** |

## Manual — Audit Log

| Check | Expected | Actual | Status |
|---|---|---|---|
| `/audit` list loads | Table renders with real entries | Confirmed | **Pass** |
| Open diff dialog on a real entry | Humanized key-value list, no console warning | Rendered correctly (Title-Cased labels, `₹`-formatted money fields); no "Only plain objects..." warning after the fix (present before it — see Fix #10b) | **Pass** (after fix) |
| `Updated By` field | Shows the actor's ID as a plain string (name resolution explicitly out of scope) | Plain hex string shown, no crash | **Pass** |

## Manual — Mobile-Responsive App Shell

| Viewport | Check | Expected | Actual | Status |
|---|---|---|---|---|
| 390×844 (phone) | Hamburger button visible | Yes | Yes | **Pass** |
| 390×844 | Sidebar `<aside>` not visible, content uses full width | Yes | Yes (`m1-dashboard-closed.png`) | **Pass** |
| 390×844 | Tapping hamburger opens drawer with all 6 nav items | Yes | Yes (`m2-drawer-open.png`) | **Pass** |
| 390×844 | Tapping a nav link navigates AND closes the drawer | Yes | Confirmed via URL change + drawer-closed check | **Pass** |
| 390×844 | Escape key closes the drawer | Yes | Confirmed | **Pass** |
| 390×844 | Ledger Overview, Notifications, Settings all usable | Yes, no broken layout | Confirmed via screenshots (`m5-*.png`); minor pre-existing tab-bar overflow on Ledger Overview noted separately, not a regression from this change | **Pass** (with a known, separate, unfixed cosmetic issue) |
| 820×1180 (tablet) | Hamburger hidden (above `md:` = 768px) | Yes | Yes | **Pass** |
| 1440×900 (desktop) | Hamburger hidden | Yes | Yes | **Pass** |
| 1440×900 | Layout pixel-identical to before this change | Yes | Confirmed by direct screenshot comparison (`d1-dashboard.png`) | **Pass** |
| 1440×900 | Sidebar collapse/expand toggle still works | Yes | Confirmed (`d2-collapsed.png`) | **Pass** |
| All viewports | No new console errors from the shell change | Only pre-existing baseline warnings | Confirmed — same 3 recurring warnings present before this pass (dev-mode `eval()` notice, React 19 ref-access warning, Base UI `nativeButton` warning from `NotificationBell`, unrelated to this work) | **Pass** |

## Bugs found during this verification pass (not regressions from this pass's own changes — see `BUG_AUDIT.md` §10.2–10.3)

| Check | Expected | Actual (before fix) | Actual (after fix) | Status |
|---|---|---|---|---|
| POST to `/settings` (any Settings save) | 200 | **500** — `ReferenceError: CreateUserResult is not defined`, reproduced twice including after a full `.next` cache clear | 200, confirmed via 2 independent clean-cache runs | **Fixed, verified** |
| View an Audit diff for an entity-update entry | No console warning | "Only plain objects can be passed to Client Components..." warning, object logged showed a raw ObjectId `updatedBy` | No warning, `updatedBy` renders as a plain string | **Fixed, verified** |

## Financial integrity spot-check

Cross-referenced the clients-pagination change's output against a raw
aggregation query in the prior session's Dashboard verification work
(same dataset) — dashboard/ledger figures matched raw MongoDB collection
sums to the rupee. Not re-run against live production data this pass
since the clients-pagination change doesn't touch calculation logic, only
which rows get fetched/enriched (verified equivalent by the pagination
test above: enrichment inputs are the same rows, just fewer of them per
call).

## Overall

No regressions found in any previously-working functionality. Two
pre-existing bugs were found and fixed (both blocked verifying this pass's
own Settings/Audit work, so fixing them was necessary to complete
verification, not optional). All automated checks pass; all manual checks
pass.
