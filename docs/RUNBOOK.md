# Operations Runbook — Finance & Ledger

Status: **live (M9 deployed)** — production is up at the URL below. Sections
marked `[TO FILL]` still need a real value once that step happens (custom
domain, first restore drill); everything else reflects the actual deployed
system.

---

## 1. Environments

| Environment | Purpose | URL |
|---|---|---|
| Local dev | `npm run dev` against the Docker Compose Mongo replica set | http://localhost:3000 |
| Production | The live, single environment this app ships to (no separate staging tier per Section 17 — a staging *rehearsal* happens against the same prod project before real data enters) | https://ledgergodigitify.vercel.app (Vercel's default alias; `[TO FILL]` if a custom domain is later attached) |

---

## 2. Environment variables

Every variable below is validated at boot by `src/config/env.ts` (Zod) — a
misconfigured deploy fails loudly (crashes) rather than misbehaving silently.
Set these in Vercel via `vercel env add <NAME> production`, never committed.

| Variable | Where it comes from | Notes |
|---|---|---|
| `MONGODB_URI` | MongoDB Atlas connection string (H1) | Must be a replica set — every money mutation uses `session.withTransaction` (Law 4). Atlas clusters are replica sets by default. |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 48` | **Never rotate casually** — rotating invalidates every session immediately. |
| `BETTER_AUTH_URL` | The exact production URL, scheme included | Must match what users actually visit, or auth cookies/CSRF checks fail. |
| `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | Cloudinary dashboard → Settings → API Keys (H2) | Verify with `npm run cloudinary-check` before relying on file uploads. |
| `CRON_SECRET` | `openssl rand -base64 48` | Must match the `Authorization: Bearer` header Vercel Cron sends — Vercel sets this automatically from the env var of the same name. |
| `APP_TIMEZONE` | Always the literal string `Asia/Kolkata` | Every date/money rule in the app is IST-derived (Law — never a raw `new Date()` timezone assumption). |
| `BOOTSTRAP_OWNER_EMAIL` / `BOOTSTRAP_OWNER_PASSWORD` / `BOOTSTRAP_OWNER_NAME` | Chosen with the user at go-live (H4) | Only used locally, once, by `scripts/bootstrap-owner.ts` run against the **production** `MONGODB_URI` — never committed, never left in shell history longer than needed. |

---

## 3. First deploy checklist (Section 17.1–17.4)

Human input required at each `H#` — this is not something to automate past;
confirm with the user before each irreversible step.

1. **H1 — MongoDB Atlas.**
   - Create (or reuse) an Atlas project + cluster in a region close to `bom1`
     (Mumbai) for latency — ideally Atlas's own Mumbai (`ap-south-1`) region.
   - Create a database user scoped to this app's database only.
   - Add Vercel's outbound IPs (or `0.0.0.0/0` if using Vercel's own
     recommended network-access setup) to the Atlas IP access list.
   - Copy the `mongodb+srv://...` connection string → `MONGODB_URI`.
   - Run `npm run db-check` locally against it once to confirm connectivity
     and replica-set status before deploying anything.

2. **H2 — Cloudinary.**
   - Create (or reuse) a Cloudinary account; grab Cloud Name / API Key / API
     Secret from the dashboard.
   - Run `npm run cloudinary-check` locally with these real values in
     `.env.local` — this performs a real sign → upload → verify → cleanup
     round trip and must show `PASS` before deploying.

3. **H3 — Vercel + domain.**
   - `vercel link` this project (or `vercel --prod` the first time, which
     creates the project) under the correct Vercel team/account.
   - **`vercel.json` must set `"framework": "nextjs"` explicitly.** On this
     project the Vercel dashboard's auto-detected Framework Preset came up
     as "Other" (not Next.js) — the build itself succeeded (all routes
     compiled, "Ready") but Vercel then served the raw build output as a
     static site instead of running the Next.js server, so every route
     404'd at the edge even though the deployment was healthy. Setting
     `"framework": "nextjs"` in `vercel.json` and redeploying fixed it.
     Always confirm `vercel project inspect <name>` shows `Framework
     Preset: Next.js` after the first deploy, before spending time
     debugging anything else.
   - The daily cron (`/api/cron/daily` at `30 2 * * *` IST-adjacent —
     Vercel Cron runs in UTC, so confirm the schedule still lands at the
     intended IST time) must show up live for the project (Vercel
     Dashboard → Cron Jobs).
   - `regions` in `vercel.json` is a **Pro-plan-only** feature — a Hobby
     (free) plan project must not set it (it doesn't itself break the
     build, but it's dead config on Hobby; remove it rather than leave it
     misleading).
   - Set every env var from Section 2 above via `vercel env add`. Note:
     on this project, every value added this way came back as an empty
     string when later fetched with `vercel env pull` — Vercel does not
     reliably let you read your own values back through the CLI. Keep a
     copy of any freshly generated secret (e.g. `CRON_SECRET`,
     `BETTER_AUTH_SECRET`) somewhere retrievable at the moment you
     generate it; don't rely on being able to pull it from Vercel later.
   - Point the real domain at the Vercel project (Vercel Dashboard →
     Domains) and wait for DNS to propagate + TLS to issue.

4. **H4 — Owner bootstrap.**
   - Agree on the real owner's name/email with the user.
   - Generate a strong temporary password (or let the user supply one they
     will change immediately).
   - Run `BOOTSTRAP_OWNER_EMAIL=... BOOTSTRAP_OWNER_PASSWORD=... BOOTSTRAP_OWNER_NAME=... MONGODB_URI=<prod URI> npx tsx scripts/bootstrap-owner.ts`
     **once**, locally, against the production database.
   - Confirm the script reports `mustChangePassword is set` — the owner is
     forced to change it on first real login.

5. **Verify.** Run `npx tsx scripts/smoke-prod.ts <deployed-url>` — see
   Section 5 below. All green before calling this "deployed."

---

## 4. Deploying / rolling back

- **Normal deploy:** push to the connected branch (or `vercel --prod` if
  deploying from local without git) — Vercel builds and promotes
  automatically.
- **Rollback:** Vercel Dashboard → Deployments → find the last known-good
  deployment → "Promote to Production." This is instant and doesn't require
  a new build. Always prefer this over a git revert + redeploy when the
  issue is urgent.
- **Cron verification after any deploy:** manually trigger
  `curl -H "Authorization: Bearer $CRON_SECRET" https://<domain>/api/cron/daily`
  once and check the JSON response's `rollover`/`dueReminders`/`monthSummary`/
  `reconciliation` fields look sane, rather than waiting until 2:30 AM IST to
  find out it's broken.

---

## 5. Smoke testing

`scripts/smoke-prod.ts` (built in M9) hits the deployed URL directly:
`/api/health` (200 + `db: "up"`), an authenticated login round trip, and a
read-only page fetch for each major route (`/dashboard`, `/clients`,
`/ledger/accounts`, `/ledger/overview`, `/ledger/dues`, `/notifications`,
`/audit`, `/settings`) — confirming each returns 200 with no server error,
without needing real business data to exist yet.

Run: `npx tsx scripts/smoke-prod.ts https://<domain> <owner-email> <owner-password>`

---

## 6. Incident response

- **Reconciliation drift alert:** an account is auto-locked (Section 14 edge
  case 24) and money mutations against it are refused until resolved. Go to
  `/settings` → Reconciliation panel, investigate the drift (check
  `/ledger/accounts/[id]` activity for anything that looks like an orphaned
  or duplicate transaction), then "Resolve" once understood — this does not
  auto-fix data, it only clears the lock.
- **A cron run failed or double-ran:** safe by design — every job in
  `/api/cron/daily` is idempotent (state-based, not "did I run today"),
  so re-triggering it manually is always safe.
- **Suspected data corruption:** do NOT delete or edit documents directly.
  The ledger is append-only (Law 3) — corrections are reversals, always
  through the app's own reversal actions, never a manual `mongosh` edit.

---

## 7. Backup / restore

### Where we actually stand

Atlas provides continuous backups **on paid tiers only**. On the free M0
tier there are none at all — no snapshots, no point-in-time recovery. Until
the cluster is upgraded, the full-backup file below is the *entire* disaster
recovery story, and it is only as fresh as the last time somebody clicked
the button.

M0 also caps storage at 512 MB and pauses a cluster after 60 days idle.

### Taking a backup

Settings → **Full backup** → *Download full backup (.xlsx)*. Owner only,
and every download is written to the audit log.

One sheet per collection, with MongoDB `_id`s and every reference intact.
Each sheet carries readable columns for humans plus a `__json` column
holding canonical Extended JSON — that column is what the restore reads, and
it is why an ObjectId stays an ObjectId and an int stays an int through a
format that would otherwise turn `6031…` into `6.031e+23`. The `_manifest`
sheet holds per-collection document counts and SHA-256 checksums.

**The file contains password hashes and every financial record. It is as
sensitive as the database itself** — keep it encrypted, and never in a
folder that syncs somewhere by accident.

Rough cadence, given no automation exists yet: after any day with real data
entry, and always before a deploy that touches the schema. Keep at least one
copy off the machine that made it (pen drive, separate cloud account).

### Restore drill — do this on every backup you keep

```
npm run restore-from-xlsx -- --file <backup.xlsx> --verify-only
```

Touches no database. Reads the file, re-checksums every sheet against the
manifest, and parses all documents. A backup that has never been verified is
not a backup, it is a hope.

### Restoring for real

```
npm run restore-from-xlsx -- --file <backup.xlsx> --uri <target mongodb uri>
```

`--uri` is required and is **never** defaulted from `.env`, because
restoring over a live database is the one mistake this tool cannot undo. Add
`--force` only when you intend to DROP the target's existing collections.

The script refuses to continue at the first failure, in order:

1. format version is one this build understands
2. every sheet's checksum matches the manifest
3. the connection actually landed on the database `--uri` named
4. the target is empty (or `--force` was passed)
5. indexes rebuilt — including the unique `idempotencyKey` ones that are the
   only thing preventing duplicate money
6. **reconciliation passes** — every account's derived balance equals its
   stored balance. A restore that leaves drift is not a restore, and the
   script exits non-zero.

### Known gaps

- **Attachments are not in this file.** Receipts live in Cloudinary; the
  backup holds their metadata and URLs, not the bytes. Cloudinary retention
  is a separate concern.
- **Manual, not scheduled.** Nobody is reminded to click the button.
- **No immutability.** A copy on a laptop or in a synced folder can be
  encrypted by ransomware along with everything else. An unplugged pen drive
  is the cheapest fix available today; object-lock storage is the real one.

### Drill log

- `[TO FILL]` — restore drill performed on `[date]`, restore point
  verified against `/ledger/overview`'s closing position (Section 17.5.3
  sign-off check).

---

## 8. Go-live sign-off (Section 16 D1–D7, M10)

- [x] Production owner bootstrapped (`owner@godigitify.local`,
      `mustChangePassword` set) against the real production database.
- [ ] Owner has changed their bootstrap password.
- [ ] Real operational thresholds set in `/settings` (not left at defaults).
- [ ] Real account opening balances entered, matching real bank/cash
      balances as of `settings.goLiveDate`.
- [ ] All real users created via `/settings/users` and confirmed able to log
      in.
- [ ] `/ledger/overview`'s closing position for the go-live month equals the
      sum of real, physically-verified account balances.
- [ ] One backup restore drill completed.
- [ ] One rollback (promote-previous-deployment) tested in production.
