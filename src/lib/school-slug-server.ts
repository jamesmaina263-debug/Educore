import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { SCHOOL_SLUG_COOKIE } from "@/lib/school-slug-cookie";
import { sanitizeSchoolSlug } from "@/lib/school-slug-href";

// Server-side counterpart to school-slug-context.tsx's useSchoolHref(), for the handful of
// Server Component pages that link straight to another staff-app route inline (e.g. "Add a
// student via Admissions") rather than only through the app shell's sidebar/breadcrumbs/palette,
// which already read this same cookie via (app)/layout.tsx's SchoolSlugProvider. cache()'d per
// request so a page that reads this and also renders under that layout (which reads the same
// cookie) doesn't pay for the lookup twice -- same pattern as getCachedUser().
export const getSchoolSlug = cache(async () => {
  return sanitizeSchoolSlug((await cookies()).get(SCHOOL_SLUG_COOKIE)?.value);
});
