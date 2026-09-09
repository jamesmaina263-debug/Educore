// Load test against real production (www.educoreafrica.com + the real Supabase project), per
// the production-readiness audit's Section 15. Scope, and why it's narrower than the original
// brief's full scenario list, is documented at the top of each scenario below -- every narrowing
// here is a deliberate, disclosed safety decision, not an oversight.
//
// Two different auth mechanisms, matching how the real app actually authenticates each kind of
// request:
//  - Page loads (/dashboard, /portal) use a real session COOKIE, captured by a real browser
//    login in loadtest/login-and-extract-cookies.mjs -- see that file for why this isn't
//    hand-constructed.
//  - The M-Pesa RPC call uses a bearer access_token, fetched directly from Supabase Auth's own
//    REST endpoint in setup() below -- PostgREST RPC calls authenticate via Authorization header,
//    not cookies, so there's nothing to extract from the browser session for this one.
import http from "k6/http";
import { check, sleep } from "k6";
import { SharedArray } from "k6/data";
import { textSummary } from "https://jslib.k6.io/k6-summary/0.0.2/index.js";

const SITE_URL = __ENV.LOADTEST_SITE_URL || "https://www.educoreafrica.com";
const SUPABASE_URL = __ENV.SUPABASE_URL;
const SUPABASE_ANON_KEY = __ENV.SUPABASE_ANON_KEY;
const GUARDIAN_EMAIL = __ENV.LOADTEST_GUARDIAN_EMAIL;
const GUARDIAN_PASSWORD = __ENV.LOADTEST_GUARDIAN_PASSWORD;
const STAFF_EMAIL = __ENV.LOADTEST_STAFF_EMAIL;
const STAFF_PASSWORD = __ENV.LOADTEST_STAFF_PASSWORD;
const GITITU_TEST_STUDENT_ID = __ENV.GITITU_TEST_STUDENT_ID;

const staffCookie = open("../loadtest-cookies-staff.txt");
const guardianCookie = open("../loadtest-cookies-guardian.txt");

export const options = {
  scenarios: {
    // Brief Scenario A: "100 users simultaneously logging in." Hits Supabase Auth's password
    // grant endpoint directly rather than the Next.js login server action -- the action's own
    // wrapper (a rate-limit check, then a cookie-set) is comparatively cheap; the password
    // verification Supabase Auth itself does (bcrypt + JWT issuance) is the dominant real cost
    // and is exactly what this endpoint also does internally. Documented narrowing: this does
    // NOT exercise the login action's own rate-limiter or cookie-setting overhead.
    auth_login: {
      executor: "ramping-vus",
      exec: "authLogin",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 100 },
        { duration: "1m", target: 100 },
        { duration: "15s", target: 0 },
      ],
    },
    // Brief Scenario B (staff half): "500 users accessing dashboards simultaneously." All 500
    // virtual users replay the SAME one real staff session captured by the Playwright script,
    // rather than 500 distinct real logins. Documented narrowing: this measures server/DB
    // throughput and query cost under concurrent read load, not per-user session-isolation
    // overhead -- Scenario auth_login above is what separately stresses the login/session-
    // creation path itself.
    dashboard_reads: {
      executor: "ramping-vus",
      exec: "dashboardRead",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 500 },
        { duration: "1m", target: 500 },
        { duration: "15s", target: 0 },
      ],
    },
    // Brief Scenario B (parent half). Same one-real-session-replayed-many-times narrowing as
    // dashboard_reads above, using the guardian account and /portal instead.
    portal_reads: {
      executor: "ramping-vus",
      exec: "portalRead",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 500 },
        { duration: "1m", target: 500 },
        { duration: "15s", target: 0 },
      ],
    },
    // M-Pesa STK-push. Deliberately NOT run at the same 500-1000 scale as the read scenarios --
    // this calls a real third party (Safaricom's sandbox, guarded separately by the workflow's
    // own pre-flight check that Gititu's mpesa_settings.environment is 'sandbox'), and hammering
    // even a sandbox endpoint at production-load scale is inconsiderate to that provider and
    // risks tripping their own abuse detection for no real signal gained -- the brief's own
    // concern here is "does the STK-push code path handle real concurrent initiations without
    // creating duplicate charges or racing", which a handful of concurrent requests answers just
    // as well as a thousand would.
    mpesa_stk_push: {
      executor: "shared-iterations",
      exec: "mpesaStkPush",
      vus: 5,
      iterations: 5,
      maxDuration: "2m",
    },
  },
};

export function setup() {
  const res = http.post(
    `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    JSON.stringify({ email: STAFF_EMAIL, password: STAFF_PASSWORD }),
    { headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY } },
  );
  const body = res.json();
  if (res.status !== 200 || !body.access_token) {
    throw new Error(`setup(): could not authenticate the staff account for the M-Pesa scenario -- status ${res.status}, body: ${res.body}`);
  }
  return { staffAccessToken: body.access_token };
}

export function authLogin() {
  const res = http.post(
    `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    JSON.stringify({ email: GUARDIAN_EMAIL, password: GUARDIAN_PASSWORD }),
    { headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY } },
  );
  check(res, {
    "auth: status 200": (r) => r.status === 200,
    "auth: got access_token": (r) => !!r.json("access_token"),
  });
  sleep(1);
}

export function dashboardRead() {
  const res = http.get(`${SITE_URL}/dashboard`, { headers: { Cookie: staffCookie } });
  check(res, {
    "dashboard: status 200": (r) => r.status === 200,
    "dashboard: not a login redirect": (r) => !r.url.includes("/login"),
  });
  sleep(1);
}

export function portalRead() {
  const res = http.get(`${SITE_URL}/portal`, { headers: { Cookie: guardianCookie } });
  check(res, {
    "portal: status 200": (r) => r.status === 200,
    "portal: not a login redirect": (r) => !r.url.includes("/login"),
  });
  sleep(1);
}

export function mpesaStkPush(data) {
  // Safaricom's own published sandbox test number for STK-push simulations -- not a real
  // person's phone, this is documented by Safaricom specifically for this purpose.
  const res = http.post(
    `${SUPABASE_URL}/rest/v1/rpc/initiate_mpesa_stk_request`,
    JSON.stringify({
      p_student_id: GITITU_TEST_STUDENT_ID,
      p_amount: 1,
      p_phone_number: "254708374149",
      p_notes: "Load test -- k6 mpesa_stk_push scenario",
    }),
    {
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${data.staffAccessToken}`,
      },
    },
  );
  check(res, {
    "mpesa: status 200/201": (r) => r.status === 200 || r.status === 201,
  });
  sleep(2);
}

export function handleSummary(data) {
  return {
    stdout: textSummary(data, { indent: " ", enableColors: false }),
    "loadtest-summary.json": JSON.stringify(data),
  };
}
