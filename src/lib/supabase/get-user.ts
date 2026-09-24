import "server-only";
import { cache } from "react";
import { createClient } from "./server";

// One Supabase Auth round trip per request, shared by every Server Component.
//
// supabase.auth.getUser() is a network call to Supabase Auth, not a local token decode. A single
// navigation renders the (app) layout, sometimes a module layout (health/discipline/library/
// boarding) and the page, and each used to call it independently -- 2 to 4 identical Auth round
// trips per navigation on top of the one proxy.ts already makes.
//
// React's cache() memoises per server request, so layout + page (which render in the same
// request) now share one call. Same user object, same semantics: this is NOT a session cache
// across requests, and it is deliberately not used by Server Actions (writes keep calling
// getUser() directly so a mutation always sees the live session).
export const getCachedUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});
