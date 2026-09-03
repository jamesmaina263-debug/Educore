"use client";

import Link from "next/link";
import { useActionState } from "react";
import { ShieldCheck } from "lucide-react";
import { AuthLayout } from "@/components/shared/auth-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestPasswordReset, type ForgotPasswordState } from "./actions";

const initialState: ForgotPasswordState = { error: null, sent: false };

export default function ForgotPasswordPage() {
  const [state, formAction, pending] = useActionState(requestPasswordReset, initialState);

  return (
    <AuthLayout>
      {state.sent ? (
        <div className="space-y-5 rounded-xl border border-border bg-surface p-7 shadow-raised sm:p-8">
          <div className="space-y-1.5">
            <h1 className="text-lg font-semibold tracking-tight">Check your email</h1>
            <p className="text-sm text-muted-foreground">
              If that email address is registered, we&apos;ve sent a link to reset your
              password. It may take a few minutes to arrive.
            </p>
          </div>
          <Link
            href="/login"
            className="block text-sm font-medium text-[var(--brand-gold-600)] hover:underline"
          >
            Back to sign in
          </Link>
        </div>
      ) : (
        <form
          action={formAction}
          className="space-y-5 rounded-xl border border-border bg-surface p-7 shadow-raised sm:p-8"
        >
          <div className="space-y-1.5">
            <h1 className="text-lg font-semibold tracking-tight">Reset your password</h1>
            <p className="text-sm text-muted-foreground">
              Enter the email address on your staff account and we&apos;ll send you a link
              to set a new password.
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

          {state.error && (
            <p
              role="alert"
              className="rounded-md border border-destructive/25 bg-destructive-subtle px-3 py-2 text-sm text-destructive"
            >
              {state.error}
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
            {pending ? "Sending…" : "Send reset link"}
          </Button>

          <p className="border-t border-border pt-4 text-xs text-muted-foreground">
            <Link href="/login" className="font-medium text-foreground hover:underline">
              Back to sign in
            </Link>
          </p>
        </form>
      )}

      <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
        Protected by enterprise-grade security
      </p>
    </AuthLayout>
  );
}
