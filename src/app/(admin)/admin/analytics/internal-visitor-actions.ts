"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  INTERNAL_VISITOR_COOKIE,
  INTERNAL_VISITOR_MAX_AGE_SECONDS,
  isInternalVisitorValue,
} from "@/lib/marketing/internal-visitor";

// Flips the "don't count my visits" marker on THIS browser. Platform super admins only, checked here because a
// server action is a public endpoint. Takes no input from the caller: it reads the current cookie and reverses it.
export async function toggleInternalVisitor(): Promise<void> {
  const supabase = await createClient();
  const { data: isSuperAdmin } = await supabase.rpc("auth_is_super_admin");
  if (!isSuperAdmin) return;

  const jar = await cookies();
  const on = isInternalVisitorValue(jar.get(INTERNAL_VISITOR_COOKIE)?.value);
  if (on) {
    jar.delete(INTERNAL_VISITOR_COOKIE);
  } else {
    jar.set(INTERNAL_VISITOR_COOKIE, "1", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: INTERNAL_VISITOR_MAX_AGE_SECONDS,
    });
  }
  revalidatePath("/admin/analytics");
}
