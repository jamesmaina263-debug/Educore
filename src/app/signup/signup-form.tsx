"use client";

import { useActionState, useEffect, useState, useSyncExternalStore } from "react";
import { CheckCircle2, Loader2, MailCheck, Rocket, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { TurnstileWidget } from "@/components/turnstile-widget";
import { sendGTMEvent } from "@next/third-parties/google";
import {
  captureAttribution,
  getAttributionSnapshot,
  getServerAttributionSnapshot,
  subscribeToAttribution,
  type Attribution,
} from "@/lib/attribution";
import { ATTRIBUTION_KEYS } from "@/lib/marketing/attribution-fields";
import { signUpSchool, type SignupState } from "./actions";
import { TITLE_OPTIONS, SCHOOL_TYPE_OPTIONS } from "@/lib/institution-reference-data";

const initialState: SignupState = { error: null };

// 16px text stops iOS Safari zooming on focus; h-11 (44px) meets the touch-target guideline.
const fieldClass = "h-11 text-base sm:text-sm";

export function SignupForm() {
  const [state, formAction, pending] = useActionState(signUpSchool, initialState);
  const [formLoadedAt] = useState(() => Date.now());
  // Controlled, because React resets uncontrolled fields once a form action finishes: without
  // this, any server-side error (bad phone, address already registered, ...) wiped everything the
  // visitor had typed.
  const [fields, setFields] = useState({ owner_name: "", school_name: "", phone: "", email: "", address: "" });
  const bind = (name: keyof typeof fields) => ({
    value: fields[name],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setFields((f) => ({ ...f, [name]: e.target.value })),
  });
  const [title, setTitle] = useState("");
  const [schoolType, setSchoolType] = useState("");
  const [captchaToken, setCaptchaToken] = useState("");

  // Fires once, the render after state.success flips true -- a new school account was actually
  // created, not just that the form validated. state.honeypot guards against counting bots:
  // the honeypot branch in signUpSchool also returns success (so bots see a convincing fake
  // success screen) but no account was created, so it must not inflate the sign_up count.
  useEffect(() => {
    if (state.success && !state.honeypot) {
      sendGTMEvent({ event: "sign_up" });
    }
  }, [state.success, state.honeypot]);

  // Marketing attribution (UTM tags + Google Ads click ID) for the signup record. /signup has its
  // own layout and does not mount MarketingAnalytics, so a visitor whose ad lands straight here
  // would otherwise never get their parameters captured. captureAttribution() is first-touch and
  // idempotent. Filled after mount (sessionStorage does not exist during server render) and
  // submitted as hidden inputs; the server action stores them best-effort.
  const attributionJson = useSyncExternalStore(
    subscribeToAttribution,
    getAttributionSnapshot,
    getServerAttributionSnapshot,
  );
  const attribution = JSON.parse(attributionJson) as Attribution;
  useEffect(() => {
    captureAttribution();
  }, []);

  if (state.success) {
    const sent = state.emailSent !== false;
    return (
      <div
        role="status"
        className="animate-in fade-in zoom-in-95 space-y-4 rounded-lg border border-border bg-surface p-6 text-center shadow-raised duration-300"
      >
        <div
          className={`mx-auto flex h-12 w-12 items-center justify-center rounded-full ${
            sent ? "bg-success-subtle text-success" : "bg-warning-subtle text-warning"
          }`}
        >
          {sent ? <MailCheck className="h-7 w-7" strokeWidth={2} /> : <TriangleAlert className="h-7 w-7" strokeWidth={2} />}
        </div>
        {sent ? (
          <>
            <h1 className="text-base font-semibold">Check your email to finish</h1>
            <p className="text-sm text-muted-foreground">
              We&apos;ve created <span className="font-medium text-foreground">{state.schoolName}</span> and
              sent a link to <span className="font-medium text-foreground">{state.email}</span>. Open it to choose
              your password and go straight to your dashboard.
            </p>
            <p className="text-xs text-muted-foreground">
              Open the link in this same browser. Nothing in your inbox after a few minutes? Check spam, or use
              &ldquo;Forgot password&rdquo; on the sign-in page with the same email.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-base font-semibold">Your school is created — one more step</h1>
            <p className="text-sm text-muted-foreground">
              We created <span className="font-medium text-foreground">{state.schoolName}</span> but couldn&apos;t send
              the set-password email just now. Use &ldquo;Forgot password&rdquo; with{" "}
              <span className="font-medium text-foreground">{state.email}</span> and we&apos;ll send it again.
            </p>
          </>
        )}
        <Button asChild className="w-full" variant={sent ? "outline" : "default"}>
          <a href={sent ? "/login" : "/forgot-password"}>
            {sent ? "Go to sign in" : "Send me the link again"} <Rocket className="h-4 w-4" />
          </a>
        </Button>
      </div>
    );
  }

  return (
    <form action={formAction} className="relative space-y-5" aria-busy={pending}>
      <input type="hidden" name="form_loaded_at" value={formLoadedAt} />
      {ATTRIBUTION_KEYS.map((key) => (
        <input key={key} type="hidden" name={key} value={attribution[key] ?? ""} />
      ))}
      {/* Honeypot — hidden from real users via CSS, left unfilled by them; bots that fill every
          field will trip it. */}
      <div className="absolute -left-[9999px]" aria-hidden="true">
        <label htmlFor="company_website">Leave this field blank</label>
        <input type="text" id="company_website" name="company_website" tabIndex={-1} autoComplete="off" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="owner_name">Your name</Label>
          <Input id="owner_name" name="owner_name" {...bind("owner_name")} required maxLength={120} autoComplete="name" placeholder="e.g. Jane Wanjiru" className={fieldClass} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="school_name">School name</Label>
          <Input id="school_name" name="school_name" {...bind("school_name")} required maxLength={200} autoComplete="organization" className={fieldClass} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="phone">Phone</Label>
          <Input id="phone" name="phone" {...bind("phone")} type="tel" inputMode="tel" required maxLength={40} autoComplete="tel" placeholder="0712 345 678" className={fieldClass} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" {...bind("email")} type="email" inputMode="email" required maxLength={254} autoComplete="email" placeholder="you@school.ac.ke" className={fieldClass} />
          <p className="text-xs text-muted-foreground">We&apos;ll email you a link to set your password.</p>
        </div>
      </div>

      <details className="rounded-md border border-border px-3">
        <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium text-foreground">
          Tell us more about your school (optional — you can do this later)
        </summary>
        <div className="grid gap-4 pb-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Your title</Label>
            <Select value={title} onValueChange={setTitle}>
              <SelectTrigger className="h-11 text-base sm:text-sm">
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent>
                {TITLE_OPTIONS.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <input type="hidden" name="title" value={title} />
          </div>
          <div className="space-y-1.5">
            <Label>School type</Label>
            <Select value={schoolType} onValueChange={setSchoolType}>
              <SelectTrigger className="h-11 text-base sm:text-sm">
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent>
                {SCHOOL_TYPE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <input type="hidden" name="school_type" value={schoolType} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="address">Address</Label>
            <Input id="address" name="address" {...bind("address")} maxLength={300} autoComplete="street-address" className={fieldClass} />
          </div>
        </div>
      </details>

      <div className="space-y-1.5">
        <TurnstileWidget onVerify={setCaptchaToken} />
      </div>

      {state.error && (
        <p role="alert" className="rounded-md border border-destructive-subtle bg-destructive-subtle px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      )}

      <Button type="submit" disabled={pending || !captchaToken} className="h-12 w-full" size="lg">
        {pending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Setting up your school…
          </>
        ) : (
          <>
            Start my 30-day free trial <Rocket className="h-4 w-4" />
          </>
        )}
      </Button>
      {!pending && !captchaToken && (
        <p className="text-center text-xs text-muted-foreground">Complete the CAPTCHA above to continue.</p>
      )}
      <p className="text-center text-xs text-muted-foreground">
        <CheckCircle2 className="mr-1 inline h-3 w-3" aria-hidden="true" />
        No card required. You&apos;ll be the school owner and can change any details later.
      </p>
    </form>
  );
}
