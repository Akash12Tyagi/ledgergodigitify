# Known Limitations — Production Stabilization Pass

Everything below was deliberately deferred rather than guessed at. Each
entry explains why, and — for the four missing modules — a recommended
starting scope so a future pass doesn't start from a blank page.

---

## 1. Reports module (does not exist)

No `/reports` route, no nav entry. The only substitute today is raw CSV
export (Settings page → clients/expenses/credits/transactions), which is
data dump, not a report.

**Why deferred:** "What should a report contain" is a product decision,
not something inferable from the codebase. Guessing risks building the
wrong thing.

**Recommended v1 scope**, based on what the financial engine already
computes and could feed directly:
- A Profit & Loss summary for an arbitrary date range (the
  `getRangeOverview` function already backing the Dashboard's range picker
  computes collected/expenses for any [from, to] — a Reports page could
  reuse it directly).
- A per-client statement (billed/paid/due over a range) — `getClientHistory`
  and `getClientMonthStatus` already exist and back the client detail
  page's own tabs.
- Export-to-PDF is a larger, separate decision (a new dependency, a
  template system) — recommend starting with on-screen + the existing CSV
  export pattern, not PDF, for v1.

## 2. Standalone Invoice/Receipt management (does not exist)

Invoice/receipt numbers are captured today only as metadata fields on the
`Payment` record (`invoiceNumber`/`receiptNumber`, both DB-uniqueness-
enforced), entered manually at record-payment time (`RecordPaymentSheet`).
There is no list, search, detail view, or regeneration UI for invoices or
receipts as their own entities.

**Why deferred:** Whether invoices/receipts should become first-class
documents (with their own template, PDF generation, and possibly a
separate numbering sequence per document type) versus staying as payment
metadata is a product/compliance decision — some jurisdictions have
specific invoice-numbering-sequence requirements that would shape the data
model differently than what exists today.

**Recommended v1 scope:** A read-only `/invoices` and `/receipts` list
(each just a filtered view over `Payment`, grouped by
`invoiceNumber`/`receiptNumber`) is the lowest-risk starting point — no
schema change, just a new query + page. Only take on PDF generation /
a separate numbering authority once it's confirmed the business actually
needs invoices to exist independently of the payment that created them.

## 3. Global search (does not exist)

Only per-table filter/search inputs exist (e.g. Clients' "Search name,
company, service…"). The topbar has no search box — the code already has
an explicit comment acknowledging this ("Global search / month pill land
in a later pass").

**Why deferred:** Scope depends on what should be searchable (clients
only? transactions? accounts? a combined index?) and whether it needs a
dedicated search index (e.g. the `Client` model's existing `$text` index
suggests a pattern, but transactions/payments have no text index today).

**Recommended v1 scope:** Start narrow — a single search box that queries
clients by name/company (reusing the existing `$text` index) and links to
each client's detail page. Expanding to transactions/accounts is a
separate, larger decision once it's clear that's actually the primary use
case.

## 4. Help/Support module (does not exist)

No route, no nav entry, no content.

**Why deferred:** This is pure content (what should it say, who
maintains it) — not something to fabricate.

**Recommended v1 scope:** A single static `/help` page with contact
info and links to key workflows, added once there's actual content to
put there.

---

## 5. CSP allows `'unsafe-inline'` on `script-src`/`style-src`

`next.config.ts`'s Content-Security-Policy weakens XSS mitigation for
script injection specifically (`'unsafe-inline'` on `script-src` means an
injected inline `<script>` would still execute).

**Why deferred:** A proper fix (nonce-based CSP, generating a per-request
nonce via `proxy.ts`/middleware and threading it to every inline
script/style) risks breaking Base UI's floating-UI positioning — popovers,
selects, and sheets throughout the app rely on inline `style` attributes
for placement, and CSP nonces don't cover style *attributes* the way they
cover `<style>` tags (a separate `style-src-attr` directive would likely
be needed, or accepting `'unsafe-inline'` on `style-src` specifically
while hardening only `script-src`). This needs dedicated testing across
every floating component in the app, not a same-pass change alongside
everything else here.

**Recommended approach for a future pass:** Harden `script-src` first
(lower risk, the more severe of the two since it governs executable code)
with a nonce; leave `style-src` as-is initially and re-evaluate separately.

## 6. `proxy.ts`'s presence-only session pre-check

`proxy.ts` does a cheap cookie-presence check before the authoritative
`(app)/layout.tsx` guard (`requireUser`) runs. This means a request from a
role-insufficient (but authenticated) user still gets a full page assembly
before the redirect fires.

**Why deferred:** Negligible cost, and restructuring the two-layer guard
is churn with no user-facing benefit — noted for completeness, not
because it needs fixing.

## 7. Minor Ledger sub-nav tab overflow at ~390px width

`/ledger/overview`'s tab bar (Overview/Dues/Accounts/Expenses/Credits)
overflows slightly at phone width, clipping "Credits" to "Cr".

**Why deferred:** Noticed incidentally while verifying this pass's
app-shell fix (a different, already-fixed issue). Distinct, smaller,
purely cosmetic — recommend a follow-up pass adding horizontal scroll or
wrapping to that specific tab bar component.

## 8. `AuditDiffDialog` doesn't resolve IDs to names

The diff dialog (fixed this pass to stop crashing and to Title-Case/
currency-format its output — see `FIX_REPORT.md` #8) still shows raw
ObjectIds for reference fields like `accountId`/`clientId`/`updatedBy`,
rather than resolving them to "HDFC Current Account" or a person's name.

**Why deferred:** Doing this generically (for arbitrary before/after
blobs across every entity type) needs either a name-lookup map threaded
from the server page into the client dialog (per audit-log row, since
each row may reference a different entity type), or a more invasive
generic entity-resolution layer — judged out of scope for one admin-only
(`requireUser("admin")`) dialog in this pass. Low real-world impact since
the only viewers are trusted internal admins, not end users.

**Recommended v1 scope for a future pass:** Batch-resolve just the
handful of ID-shaped keys already known to be common
(`accountId`, `clientId`, `paymentId`, `updatedBy`) via the existing
name-lookup helpers (`accounts.service.ts#getAccountNamesByIds`,
`findClientById`, `findUserById`) at the point `listAuditLogs` builds each
row, passing a small `{id: name}` map alongside each entry rather than
resolving inside the client component.
