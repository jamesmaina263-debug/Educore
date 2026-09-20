import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { buildCsp, marketingHeaderSources } from "./csp";

const SUPABASE = "https://abcd1234.supabase.co";

// The policy that was enforcing in production before the Google Ads readiness
// change. The base policy must not drift from it: it also protects the
// authenticated school app and admin console.
const PREVIOUS_PRODUCTION_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline' https://*.googletagmanager.com https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; frame-src 'self' https://abcd1234.supabase.co https://challenges.cloudflare.com; connect-src 'self' https://abcd1234.supabase.co https://*.ingest.de.sentry.io https://*.ingest.sentry.io https://*.googletagmanager.com https://*.google-analytics.com https://*.analytics.google.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; report-uri /api/csp-report; report-to csp-endpoint";

function directive(csp: string, name: string): string[] {
  const line = csp.split("; ").find((d) => d.startsWith(`${name} `));
  return line ? line.split(" ").slice(1) : [];
}

describe("base CSP (applies to the school app and admin console)", () => {
  it("is byte-identical to the policy already enforcing in production", () => {
    expect(buildCsp({ supabaseOrigin: SUPABASE })).toBe(PREVIOUS_PRODUCTION_CSP);
  });

  it("does not allow Google Ads or google.com hosts", () => {
    const csp = buildCsp({ supabaseOrigin: SUPABASE });
    expect(csp).not.toContain("googleadservices");
    expect(csp).not.toContain("doubleclick");
    expect(csp).not.toContain("*.google.com");
  });
});

describe("marketing CSP (public marketing pages and /signup only)", () => {
  const csp = buildCsp({ supabaseOrigin: SUPABASE, marketing: true });

  it("adds the hosts Google documents for Google Ads and Ads-linked Analytics", () => {
    expect(directive(csp, "script-src")).toEqual(
      expect.arrayContaining(["https://www.googleadservices.com", "https://www.google.com"]),
    );
    expect(directive(csp, "connect-src")).toEqual(
      expect.arrayContaining([
        "https://*.google.com",
        "https://*.google.co.ke",
        "https://*.g.doubleclick.net",
        "https://pagead2.googlesyndication.com",
        "https://www.googleadservices.com",
        "https://ad.doubleclick.net",
      ]),
    );
    expect(directive(csp, "frame-src")).toContain("https://www.googletagmanager.com");
  });

  it("keeps every source the base policy already allows", () => {
    const base = buildCsp({ supabaseOrigin: SUPABASE });
    for (const name of ["default-src", "script-src", "style-src", "img-src", "font-src", "frame-src", "connect-src"]) {
      expect(directive(csp, name)).toEqual(expect.arrayContaining(directive(base, name)));
    }
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("report-uri /api/csp-report");
  });
});

describe("marketingHeaderSources", () => {
  const sources = marketingHeaderSources(join(process.cwd(), "src/app/(marketing)"));

  it("covers the homepage, /signup and the pages ads will land on", () => {
    expect(sources).toContain("/");
    expect(sources).toContain("/signup/:path*");
    for (const route of [
      "pricing",
      "contact",
      "blog",
      "cbc-school-management",
      "finance-fees",
      "student-management-system",
      "privacy",
    ]) {
      expect(sources).toContain(`/${route}/:path*`);
    }
  });

  it("covers every top-level route folder in the marketing route group", () => {
    // Guards against a future marketing page being added without ad tags
    // working on it. The expectation is listed independently of the code under
    // test: every plain (non-group, non-dynamic, non-private) folder.
    const folders = readdirSync(join(process.cwd(), "src/app/(marketing)"), { withFileTypes: true })
      .filter((e) => e.isDirectory() && /^[a-z]/i.test(e.name))
      .map((e) => `/${e.name}/:path*`);
    expect(folders.length).toBeGreaterThan(15);
    for (const source of folders) expect(sources).toContain(source);
  });

  it("never includes app, admin, auth or API routes", () => {
    const joined = sources.join(" ");
    for (const route of ["dashboard", "admin", "login", "portal", "api", "apply", "parent-login", "students"]) {
      expect(joined).not.toContain(`/${route}/`);
    }
  });

  it("returns no sources (so the base policy stays) if the folder cannot be read", () => {
    expect(marketingHeaderSources(join(process.cwd(), "does-not-exist"))).toEqual([]);
  });
});
