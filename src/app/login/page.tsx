"use client";

import { Suspense, useActionState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { AuthLayout } from "@/components/shared/auth-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { login, type LoginState } from "./actions";

const initialState: LoginState = { error: null };

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const [state, formAction, pending] = useActionState(login, initialState);
  const searchParams = useSearchParams();
  const wasDeactivated = searchParams.get("deactivated") === "1";
  const linkError = searchParams.get("error");
  const errorMessage = state.error ?? linkError ?? (wasDeactivated
      ? "Your account has been deactivated. Contact your school admin."
      : null);

  return (
    <AuthLayout>
      <form
        action={formAction}
        className="space-y-5 rounded-xl border border-border bg-surface p-7 shadow-raised sm:p-8"
      >
        <div className="space-y-1.5">
          <h1 className="text-lg font-semibold tracking-tight">Staff sign in</h1>
          <p className="text-sm text-muted-foreground">
            Parents and students sign in with a phone number instead.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            autoFocus
            className="h-10 focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-500)] focus-visible:ring-offset-0"
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link
              href="/forgot-password"
              className="text-xs font-medium text-[var(--brand-gold-600)] hover:underline"
            >
              Forgot password?
            </Link>
          </div>
          <Input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="h-10 focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-500)] focus-visible:ring-offset-0"
          />
        </div>

        {errorMessage && (
          <p
            role="alert"
            className="rounded-md border border-destructive/25 bg-destructive-subtle px-3 py-2 text-sm text-destructive"
          >
            {errorMessage}
          </p>
        )}

        <Button
          type="submit"
          disabled={pending}
          className="h-10 w-full border-0 font-semibold text-[var(--brand-navy-950)] shadow-sm transition-colors hover:brightness-105 focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-500)] focus-visible:ring-offset-2"
          style={{
            background:
              "linear-gradient(135deg, var(--brand-gold-400) 0%, var(--brand-gold-500) 100%)",
          }}
        >
          {pending ? "Signing in…" : "Sign in"}
        </Button>

        <p className="border-t border-border pt-4 text-xs text-muted-foreground">
          Forgot your password? Use the link above to reset it. For any other
          account issue, contact your school administrator.
        </p>
      </form>

      <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
        Protected by enterprise-grade security
      </p>
    </AuthLayout>
  );
}
