import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Service-role client — bypasses RLS entirely. Only ever call this from
// Server Actions/Route Handlers, and only for operations that genuinely
// need to act outside the current user's own permissions (e.g. creating
// a new staff member's auth account, which the new staff member
// obviously can't do themselves yet).
//
// Depends on SUPABASE_SERVICE_ROLE_KEY being set in the deployment
// environment. If it isn't, this throws clearly rather than silently
// falling back to the anon key (which would just fail RLS checks in a
// more confusing way).
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not configured in this environment — staff invitation requires it.",
    );
  }

  return createSupabaseClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
