import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { resolveSlugRouting, applySlugRouting } from "@/lib/school-slug-routing";

export async function proxy(request: NextRequest) {
  const sessionResponse = await updateSession(request);

  // updateSession already decided to redirect (protected route, no session)
  // -- honor that as-is and skip slug routing, since we're heading to /login.
  if (sessionResponse.headers.get("location")) {
    return sessionResponse;
  }

  const routing = resolveSlugRouting(request);
  return applySlugRouting(routing, sessionResponse);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
