import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// This path is already excluded from proxy.ts's matcher (per the
// MARKETING_SITE_STATUS.md Phase 9 note), so it needs no NEVER_PREFIX
// entry -- Next serves it directly.
//
// Audit finding (SEO-ANALYTICS-IMPLEMENTATION.md): every top-level folder
// under src/app/(app)/ shares the site's top-level URL space (route groups
// don't add a path segment), and that route group's own layout.tsx does
// NOT redirect unauthenticated visitors -- each page's data loader does
// (e.g. (app)/academics/_data.ts calls redirect("/login") itself). The
// previous version of this file only disallowed the 3 known auth entry
// points, leaving ~18 authenticated module folders crawlable-in-principle:
// a crawler would hit a 307 redirect chain to /login on every one of them,
// wasting crawl budget and risking /login?redirectedFrom=... variants
// getting discovered as their own URLs. Disallowing them here is a pure
// crawl-budget/hygiene fix -- it changes no runtime auth behavior, since
// the redirect-on-load already prevented any real content from rendering
// for anonymous visitors.
const AUTHENTICATED_APP_PATHS = [
  "/dashboard",
  "/login",
  "/parent-login",
  "/change-password",
  "/portal",
  "/notifications",
  "/biometric-kiosk",
  "/academics",
  "/admissions",
  "/ai",
  "/attendance",
  "/boarding",
  "/campuses",
  "/communication",
  "/connect",
  "/discipline",
  "/exams",
  "/finance",
  "/health",
  "/homework",
  "/integrations",
  "/inventory",
  "/library",
  "/parents",
  "/payroll",
  "/performance",
  "/pt-meetings",
  "/reports",
  "/settings",
  "/staff",
  "/students",
  "/transport",
];

// AI search / answer-engine crawlers, named explicitly so the intent to be
// discoverable and citable is on record rather than implied by the `*` rule.
// IMPORTANT: robots.txt crawlers obey only the most specific matching
// user-agent group and ignore `*` once they match one -- so this group must
// repeat the full AUTHENTICATED_APP_PATHS disallow list, otherwise naming
// these bots would quietly re-open every authenticated path to them.
// Only public marketing pages are reachable without a session anyway, so
// allowing both retrieval ("search") and training-style agents here is a
// visibility decision, not a data-exposure one. Drop a name from this list
// to opt that crawler out.
const AI_CRAWLERS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-SearchBot",
  "Claude-User",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "Applebot-Extended",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // /signup is deliberately not disallowed -- it's a real public
        // "start a school" page, not an authenticated route (see
        // footer.tsx's "Account" links). /apply/[slug] (public admissions
        // application forms) is also deliberately not disallowed.
        disallow: AUTHENTICATED_APP_PATHS,
      },
      {
        userAgent: AI_CRAWLERS,
        allow: "/",
        disallow: AUTHENTICATED_APP_PATHS,
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
