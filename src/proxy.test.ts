import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "fs";
import path from "path";
import { config } from "./proxy";
import { APP_ROUTE_SEGMENTS, NEVER_PREFIX } from "./lib/school-slug-routing";

// Next requires `matcher` to be a static literal, so the list of public marketing routes the proxy
// skips is hard-coded there. These tests keep it honest: it must mirror the real (marketing)
// folders, and nothing that needs the session/maintenance gate/slug routing may ever be skipped.

const matcher = config.matcher[0];
// Next compiles a matcher source with path-to-regexp; for this pattern that is equivalent to
// anchoring the source on both ends.
const matcherRegex = new RegExp(`^${matcher}$`);
const matches = (pathname: string) => matcherRegex.test(pathname);

const marketingDir = path.join(__dirname, "app", "(marketing)");
const marketingRoots = readdirSync(marketingDir).filter((name) =>
  statSync(path.join(marketingDir, name)).isDirectory(),
);

describe("proxy matcher: public marketing routes skip the proxy", () => {
  it("excludes every top-level (marketing) route folder, and only those", () => {
    const stillMatched = marketingRoots.filter((r) => matches(`/${r}`));
    expect(stillMatched).toEqual([]);
  });

  it("excludes nested marketing pages too (blog posts etc.)", () => {
    expect(matches("/blog/mpesa-fee-collection-automation-kenya-schools")).toBe(false);
    expect(matches("/pricing/")).toBe(false);
    expect(matches("/contact")).toBe(false);
  });

  it("every excluded route is already a never-slug-prefixed public route and not an app route", () => {
    for (const r of marketingRoots) {
      expect(NEVER_PREFIX.has(r)).toBe(true);
      expect(APP_ROUTE_SEGMENTS.has(r)).toBe(false);
    }
  });

  it("no nested marketing folder name collides with an app route segment (the maintenance gate checks the 2nd segment)", () => {
    const collisions: string[] = [];
    const walk = (dir: string, rel: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (!statSync(full).isDirectory()) continue;
        if (rel && APP_ROUTE_SEGMENTS.has(name)) collisions.push(`${rel}/${name}`);
        walk(full, rel ? `${rel}/${name}` : name);
      }
    };
    walk(marketingDir, "");
    expect(collisions).toEqual([]);
  });
});

describe("proxy matcher: everything that needs the proxy is still matched", () => {
  it("still matches the homepage (password-reset fallback lives there)", () => {
    expect(matches("/")).toBe(true);
  });

  it("still matches every school-app route, bare and slug-prefixed", () => {
    for (const seg of APP_ROUTE_SEGMENTS) {
      expect(matches(`/${seg}`)).toBe(true);
      expect(matches(`/some-school/${seg}`)).toBe(true);
      expect(matches(`/${seg}/anything/deeper`)).toBe(true);
    }
    expect(matches("/dashboard")).toBe(true);
    expect(matches("/gititu-school/dashboard")).toBe(true);
  });

  it("still matches auth, portal, admin, api (webhooks/crons/actions) and unknown paths", () => {
    for (const p of [
      "/login",
      "/signup",
      "/apply",
      "/portal",
      "/portal/fees",
      "/parent-login",
      "/change-password",
      "/reset-password",
      "/forgot-password",
      "/maintenance",
      "/auth/confirm",
      "/admin",
      "/admin/analytics",
      "/notifications",
      "/unsubscribe/abc123",
      "/api/cron/billing",
      "/api/mpesa/callback",
      "/totally-unknown-slug",
      "/some-school",
      "/wp-login.php",
    ]) {
      expect(matches(p), p).toBe(true);
    }
  });

  it("does not exclude look-alike prefixes of marketing names", () => {
    // Only whole first segments are excluded: "/blogger", "/pricing-admin" etc. still hit the proxy.
    expect(matches("/blogger")).toBe(true);
    expect(matches("/pricing-admin")).toBe(true);
    expect(matches("/abouts/dashboard")).toBe(true);
    expect(matches("/some-school/blog")).toBe(true);
  });

  it("preserves the original static-asset exclusions", () => {
    for (const p of [
      "/_next/static/chunks/a.js",
      "/_next/image",
      "/favicon.ico",
      "/sw.js",
      "/offline.html",
      "/manifest.webmanifest",
      "/robots.txt",
      "/sitemap.xml",
      "/downloads/cbc-digital-readiness-checklist.pdf",
      "/logo.png",
    ]) {
      expect(matches(p), p).toBe(false);
    }
  });
});
