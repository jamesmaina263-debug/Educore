// The school types a visitor can tell us about on the demo form, and the helpers that tie them to
// the /schools/<slug> landing pages. Deliberately tiny and free of icons / page copy, with no
// "use client" / "use server" directive, so the browser form, the server action and the admin
// views can all import it without pulling the landing-page content into their bundles.
// src/lib/marketing/school-categories.test.ts keeps these slugs in step with the pages.
//
// Storage: the chosen type is written as one readable line in the existing
// marketing_demo_requests.message block (see src/lib/marketing/demo-request.ts), the same
// schema-free approach used for contact method and preferred time. For unfinished (step-1)
// leads it travels in the existing source_page column as the landing page's path.

export const SCHOOL_CATEGORY_OPTIONS = [
  { value: "nursery-kindergarten", label: "Nursery or kindergarten" },
  { value: "primary-schools", label: "Primary school" },
  { value: "junior-schools", label: "Junior school" },
  { value: "secondary-schools", label: "Secondary school" },
  { value: "integrated-schools", label: "Integrated school (several levels)" },
] as const;

export type SchoolCategorySlug = (typeof SCHOOL_CATEGORY_OPTIONS)[number]["value"];

/** The slug if `raw` is exactly one of ours, otherwise null. Never throws; unknown input is ignored. */
export function parseSchoolCategory(raw: unknown): SchoolCategorySlug | null {
  const value = String(raw ?? "").trim();
  return SCHOOL_CATEGORY_OPTIONS.find((o) => o.value === value)?.value ?? null;
}

export function schoolCategoryLabel(slug: SchoolCategorySlug): string {
  return SCHOOL_CATEGORY_OPTIONS.find((o) => o.value === slug)?.label ?? slug;
}

/** "/schools/primary-schools" (optionally with a trailing slash) -> "primary-schools"; anything else -> null. */
export function schoolCategoryFromPath(path: string | null | undefined): SchoolCategorySlug | null {
  const match = /^\/schools\/([a-z-]+)\/?$/.exec(String(path ?? "").trim());
  return match ? parseSchoolCategory(match[1]) : null;
}
