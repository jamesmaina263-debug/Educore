import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Server Components can't write cookies (only Server Actions/Route
// Handlers can); the try/catch below is the standard @supabase/ssr
// pattern for that, safe as long as middleware.ts is also refreshing
// the session on every request.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component — middleware handles refresh.
          }
        },
      },
    },
  );
}
