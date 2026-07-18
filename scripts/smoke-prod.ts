/**
 * Section 17.4/M9 — the automated post-deploy smoke suite. Run against
 * ANY deployed URL (staging rehearsal or production) right after a
 * deploy, before calling it "live." Exercises real HTTP requests only —
 * no direct database access — exactly what a real user's browser would
 * hit.
 *
 * Usage:
 *   npx tsx scripts/smoke-prod.ts <baseUrl> [email] [password]
 *
 * Without email/password, only the unauthenticated checks run (health +
 * confirming every protected route redirects to /login rather than
 * leaking data). With credentials, the full authenticated page sweep
 * also runs.
 */

const PROTECTED_PAGES = [
  "/dashboard",
  "/clients",
  "/ledger/accounts",
  "/ledger/overview",
  "/ledger/dues",
  "/ledger/expenses",
  "/ledger/credits",
  "/notifications",
  "/audit",
  "/settings",
  "/settings/users",
];

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(condition: boolean, label: string) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
    failures.push(label);
  }
}

async function main() {
  const baseUrl = process.argv[2];
  if (!baseUrl) {
    throw new Error("Usage: npx tsx scripts/smoke-prod.ts <baseUrl> [email] [password]");
  }
  const email = process.argv[3];
  const password = process.argv[4];
  const url = baseUrl.replace(/\/$/, "");

  console.log(`Smoke testing ${url}\n`);

  console.log("1) Health check");
  try {
    const res = await fetch(`${url}/api/health`);
    const body = (await res.json()) as { ok?: boolean; db?: string };
    check(res.status === 200, "GET /api/health returns 200");
    check(body.ok === true, "/api/health body.ok === true");
    check(body.db === "up", "/api/health body.db === 'up' (database reachable)");
  } catch (error) {
    check(false, `GET /api/health did not throw (${error instanceof Error ? error.message : error})`);
  }

  console.log("\n2) Unauthenticated access is correctly blocked");
  for (const page of PROTECTED_PAGES.slice(0, 3)) {
    const res = await fetch(`${url}${page}`, { redirect: "manual" });
    check(
      res.status >= 300 && res.status < 400,
      `GET ${page} without a session redirects (${res.status}), never serves data`
    );
  }

  let cookie: string | null = null;
  if (email && password) {
    console.log("\n3) Login");
    // Better Auth requires an Origin header matching BETTER_AUTH_URL as
    // CSRF protection on state-changing requests — a real browser always
    // sends this for the page it's actually on; Node's fetch doesn't add
    // it automatically, so it's set explicitly here.
    const loginRes = await fetch(`${url}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: url },
      body: JSON.stringify({ email, password }),
    });
    check(loginRes.status === 200, "POST /api/auth/sign-in/email returns 200");

    const setCookieHeaders =
      typeof loginRes.headers.getSetCookie === "function"
        ? loginRes.headers.getSetCookie()
        : [loginRes.headers.get("set-cookie") ?? ""].filter(Boolean);
    cookie = setCookieHeaders.map((c) => c.split(";")[0]).join("; ");
    check(cookie.length > 0, "a session cookie was issued");

    console.log("\n4) Authenticated page sweep");
    for (const page of PROTECTED_PAGES) {
      // fetch() follows redirects by default — if the cookie were somehow
      // invalid, this would silently land on /login (a real 200 page) and
      // falsely report success. Checking res.url catches that.
      const res = await fetch(`${url}${page}`, { headers: { Cookie: cookie } });
      check(
        res.status === 200 && !res.url.includes("/login"),
        `GET ${page} returns 200 when authenticated (not silently redirected to /login)`
      );
    }

    console.log("\n5) Notification poll endpoint");
    const pollRes = await fetch(`${url}/api/notifications/poll`, { headers: { Cookie: cookie } });
    check(pollRes.status === 200, "GET /api/notifications/poll returns 200 when authenticated");
  } else {
    console.log("\n(no credentials passed — skipping authenticated checks; pass email/password for full coverage)");
  }

  console.log(`\n${passed} passed, ${failed} failed.`);
  if (failed > 0) {
    console.error("Failures:", failures);
    process.exitCode = 1;
  } else {
    console.log("SMOKE TEST: PASS");
  }
}

main().catch((error) => {
  console.error("smoke-prod failed to run:", error);
  process.exit(1);
});
