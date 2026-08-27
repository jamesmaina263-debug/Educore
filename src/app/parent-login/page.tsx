"use client";

import { useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { AuthLayout } from "@/components/shared/auth-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const FUNCTIONS_BASE = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1`;

export default function ParentLoginPage() {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function requestCode(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const res = await fetch(`${FUNCTIONS_BASE}/request-otp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not send code.");
      setStep("code");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send code.");
    } finally {
      setPending(false);
    }
  }

  async function verifyCode(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const res = await fetch(`${FUNCTIONS_BASE}/verify-otp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        },
        body: JSON.stringify({ phone, code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Invalid code.");

      const supabase = createClient();
      const { error: sessionError } = await supabase.auth.verifyOtp({
        token_hash: data.token_hash,
        type: "magiclink",
      });
      if (sessionError) throw sessionError;

      window.location.href = "/portal";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid code.");
    } finally {
      setPending(false);
    }
  }

  const inputRingClass =
    "h-10 focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-500)] focus-visible:ring-offset-0";
  const goldButtonClass =
    "h-10 w-full border-0 font-semibold text-[var(--brand-navy-950)] shadow-sm transition-colors hover:brightness-105 focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-500)] focus-visible:ring-offset-2";
  const goldButtonStyle = {
    background:
      "linear-gradient(135deg, var(--brand-gold-400) 0%, var(--brand-gold-500) 100%)",
  };

  return (
    <AuthLayout>
      <div className="space-y-5 rounded-xl border border-border bg-surface p-7 shadow-raised sm:p-8">
        <div className="space-y-1.5">
          <h1 className="text-lg font-semibold tracking-tight">
            Parent / student sign in
          </h1>
          <p className="text-sm text-muted-foreground">
            Staff should use the staff sign-in page instead.
          </p>
        </div>

        {step === "phone" && (
          <form onSubmit={requestCode} className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="phone">Phone number</Label>
              <Input
                id="phone"
                type="tel"
                required
                placeholder="+2547XXXXXXXX"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                autoFocus
                className={inputRingClass}
              />
            </div>
            {error && (
              <p
                role="alert"
                className="rounded-md border border-destructive/25 bg-destructive-subtle px-3 py-2 text-sm text-destructive"
              >
                {error}
              </p>
            )}
            <Button
              type="submit"
              disabled={pending}
              className={goldButtonClass}
              style={goldButtonStyle}
            >
              {pending ? "Sending…" : "Send code"}
            </Button>
          </form>
        )}

        {step === "code" && (
          <form onSubmit={verifyCode} className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="code">6-digit code</Label>
              <Input
                id="code"
                type="text"
                inputMode="numeric"
                pattern="\d{6}"
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoFocus
                className={inputRingClass}
              />
              <p className="text-xs text-muted-foreground">
                Sent to {phone}.
              </p>
            </div>
            {error && (
              <p
                role="alert"
                className="rounded-md border border-destructive/25 bg-destructive-subtle px-3 py-2 text-sm text-destructive"
              >
                {error}
              </p>
            )}
            <Button
              type="submit"
              disabled={pending}
              className={goldButtonClass}
              style={goldButtonStyle}
            >
              {pending ? "Verifying…" : "Verify"}
            </Button>
          </form>
        )}

        <p className="border-t border-border pt-4 text-xs text-muted-foreground">
          Having trouble signing in? Contact your school office for help.
        </p>
      </div>
    </AuthLayout>
  );
}
