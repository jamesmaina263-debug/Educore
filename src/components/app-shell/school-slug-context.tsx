"use client";

import { createContext, useCallback, useContext, type ReactNode } from "react";
import { stripSchoolSlug, withSchoolSlug } from "@/lib/school-slug-href";

// The school's URL slug (from the edu_slug cookie, read once server-side in the (app) layout).
// undefined -> every helper below is a no-op and links behave exactly as they did before.
const SchoolSlugContext = createContext<string | undefined>(undefined);

export function SchoolSlugProvider({ slug, children }: { slug: string | undefined; children: ReactNode }) {
  return <SchoolSlugContext.Provider value={slug}>{children}</SchoolSlugContext.Provider>;
}

/** Returns a function that turns "/students" into "/{slug}/students" (skipping the proxy's 307 hop). */
export function useSchoolHref() {
  const slug = useContext(SchoolSlugContext);
  return useCallback((href: string) => withSchoolSlug(slug, href), [slug]);
}

/** Returns a function that removes the slug prefix from a pathname, for active-link matching. */
export function useStripSlug() {
  const slug = useContext(SchoolSlugContext);
  return useCallback((pathname: string) => stripSchoolSlug(slug, pathname), [slug]);
}
