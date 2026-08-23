"use client";

import { Suspense, useActionState } from "react";
import { useSearchParams } from "next/navigation";
import {
  BarChart3,
  CalendarCheck,
  GraduationCap,
  ShieldCheck,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { login, type LoginState } from "./actions";

const initialState: LoginState = { error: null };

const BRAND_HIGHLIGHTS = [
  { icon: GraduationCap, label: "Academics" },
  { icon: Users, label: "Students" },
  { icon: CalendarCheck, label: "Attendance" },
  { icon: BarChart3, label: "Reports" },
];

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
  const errorMessage =
    state.error ??
    (wasDeactivated ? "Your account has been deactivated. Contact your school admin." : null);

  return (
    <div className="grid min-h-screen w-full bg-background lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      {/* Brand panel — desktop/tablet only. The one deliberately branded,
          non-neutral surface in the product; see the brand-* tokens in
          globals.css. */}
      <div
        className="relative hidden flex-col justify-between overflow-hidden px-14 py-14 lg:flex xl:px-20"
        style={{
          background:
            "radial-gradient(1100px 620px at 8% -10%, var(--brand-navy-800) 0%, transparent 55%), linear-gradient(165deg, var(--brand-navy-900) 0%, var(--brand-navy-950) 100%)",
        }}
      >
        {/* Subtle dot-grid texture — decoration only. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.16]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.5) 1px, transparent 0)",
            backgroundSize: "28px 28px",
          }}
        />
        {/* Soft gold glow, bottom-left — very low opacity, purely atmospheric. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-32 -left-32 h-96 w-96 rounded-full opacity-[0.12] blur-3xl"
          style={{ background: "var(--brand-gold-400)" }}
        />

        <div className="relative">
          <div className="inline-flex rounded-xl bg-white/[0.97] px-5 py-4 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.35)]">
            <img
              src="/educore-logo-lockup.png"
              alt="EduCore — School Management System"
              className="h-14 w-auto xl:h-16"
            />
          </div>
        </div>

        <div className="relative max-w-md space-y-10">
          <p
            className="text-lg italic leading-relaxed"
            style={{ color: "var(--brand-gold-300)" }}
          >
            Smarter Schools. Brighter Futures.
          </p>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-5">
            {BRAND_HIGHLIGHTS.map(({ icon: Icon, label }) => (
              <div key={label} className="flex items-center gap-2.5">
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md"
                  style={{
                    backgroundColor: "rgba(217,166,39,0.12)",
                    color: "var(--brand-gold-400)",
                  }}
                >
                  <Icon className="h-4 w-4" strokeWidth={1.75} />
                </span>
                <dt className="text-sm font-medium text-white/80">{label}</dt>
              </div>
            ))}
          </dl>
        </div>

        <p className="relative text-xs text-white/40">
          © {new Date().getFullYear()} EduCore. Built for modern school administration.
        </p>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center px-6 py-14 sm:px-10 lg:px-16 xl:px-24">
        <div className="w-full max-w-sm">
          {/* Compact brand mark — mobile/tablet only, where the brand panel
              above is hidden. */}
          <div className="mb-10 flex justify-center lg:hidden">
            <div className="inline-flex rounded-lg border border-border bg-white px-3 py-2 shadow-sm">
              <img
                src="/educore-logo-lockup.png"
                alt="EduCore — School Management System"
                className="h-9 w-auto"
              />
            </div>
          </div>

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
              <Label htmlFor="password">Password</Label>
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
              Having trouble signing in? Contact your school administrator to reset your
              staff account.
            </p>
          </form>

          <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
            Protected by enterprise-grade security
          </p>
        </div>
      </div>
    </div>
  );
}
