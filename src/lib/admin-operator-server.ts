import { cookies } from "next/headers";
import {
  ADMIN_OPERATOR_COOKIE,
  ADMIN_OPERATOR_MAX_AGE_SECONDS,
  isAdminOperator,
  type AdminOperator,
} from "@/lib/admin-operator";

type CookieStore = Awaited<ReturnType<typeof cookies>>;

export async function getAdminOperator(): Promise<AdminOperator | null> {
  const value = (await cookies()).get(ADMIN_OPERATOR_COOKIE)?.value;
  return isAdminOperator(value) ? value : null;
}

export function setAdminOperatorCookie(cookieStore: CookieStore, operator: AdminOperator) {
  cookieStore.set(ADMIN_OPERATOR_COOKIE, operator, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: ADMIN_OPERATOR_MAX_AGE_SECONDS,
  });
}

export function clearAdminOperatorCookie(cookieStore: CookieStore) {
  cookieStore.delete(ADMIN_OPERATOR_COOKIE);
}
