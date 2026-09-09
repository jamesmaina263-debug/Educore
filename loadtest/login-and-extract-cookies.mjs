// Logs in as each load-test account through the REAL login form (not a hand-built HTTP
// request) and writes the resulting session cookies to JSON files that k6 then replays across
// many concurrent virtual users.
//
// Why not just POST to the login server action or straight to Supabase Auth's token endpoint
// and hand-construct the session cookie k6 needs? Next.js Server Actions are invoked over an
// internal wire protocol (a `Next-Action` header + an encoding scheme) that isn't meant to be
// hand-replicated and can change between Next.js versions without notice. And @supabase/ssr's
// server client reads the session from a specific cookie name/format (chunked, base64-prefixed
// above a size threshold) that's also not a stable public contract to hand-roll. A real browser
// doing a real login produces the exact right cookies automatically, with none of that fragility
// -- this script's only job is to capture what a real login already produces, not to reconstruct
// it.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const SITE_URL = process.env.LOADTEST_SITE_URL || "https://www.educoreafrica.com";

const accounts = [
  { key: "guardian", email: process.env.LOADTEST_GUARDIAN_EMAIL, password: process.env.LOADTEST_GUARDIAN_PASSWORD },
  { key: "staff", email: process.env.LOADTEST_STAFF_EMAIL, password: process.env.LOADTEST_STAFF_PASSWORD },
];

for (const acct of accounts) {
  if (!acct.email || !acct.password) {
    console.error(`Missing credentials for ${acct.key} -- check the LOADTEST_${acct.key.toUpperCase()}_EMAIL/PASSWORD env vars.`);
    process.exit(1);
  }
}

const browser = await chromium.launch();

for (const acct of accounts) {
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(`${SITE_URL}/login`, { waitUntil: "networkidle" });
  await page.fill('input[name="email"]', acct.email);
  await page.fill('input[name="password"]', acct.password);
  // No role-based branching at login (checked src/app/login/actions.ts directly rather than
  // assuming): every account lands on /dashboard except super_admin (-> /admin) -- there is no
  // login-time redirect to /portal for a parent-role account. So "did login actually work" is
  // checked against /dashboard for both accounts below; /portal is a page a guardian navigates
  // to separately, tested as its own authenticated request further down, not as the login target.
  await Promise.all([
    page.waitForURL((url) => url.pathname.includes("/dashboard") || url.pathname.includes("/login"), { timeout: 20000 }),
    page.click('button[type="submit"]'),
  ]);

  const finalUrl = page.url();
  if (!finalUrl.includes("/dashboard")) {
    console.error(`Login for ${acct.key} (${acct.email}) did not land on /dashboard -- landed on ${finalUrl} instead. Aborting rather than handing k6 a session that isn't actually authenticated.`);
    await browser.close();
    process.exit(1);
  }

  // For the guardian specifically, also confirm /portal is reachable with this same session --
  // that's the page k6 will actually load-test for this account, and a login landing on
  // /dashboard successfully doesn't by itself prove /portal is reachable too.
  if (acct.key === "guardian") {
    await page.goto(`${SITE_URL}/portal`, { waitUntil: "networkidle" });
    if (!page.url().includes("/portal")) {
      console.error(`Guardian session could not reach /portal -- landed on ${page.url()} instead.`);
      await browser.close();
      process.exit(1);
    }
  }

  const cookies = await context.cookies();
  // k6's http module wants a simple "name=value; name2=value2" header string, not Playwright's
  // structured cookie objects.
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  writeFileSync(`loadtest-cookies-${acct.key}.txt`, cookieHeader);
  console.log(`${acct.key}: logged in OK, landed on ${finalUrl}, captured ${cookies.length} cookies.`);

  await context.close();
}

await browser.close();
