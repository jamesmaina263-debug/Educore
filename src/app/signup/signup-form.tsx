"use client";

import { useActionState, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { CheckCircle2, Loader2, Rocket } from "lucide-react";
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
import { COUNTRY_CODES, countryName } from "@/lib/institution-reference-data";

const initialState: SignupState = { error: null };

/**
 * Short signup: only what's needed to create the account (name, school name,
 * email, phone, country). School details (type, cycles, address, logo, ...)
 * are collected after the first sign-in instead of in front of the visitor.
 * Currency and time zone are derived from the country server-side.
 */
export function SignupForm() {
  const [state, formAction, pending] = useActionState(signUpSchool, initialState);
  const [formLoadedAt] = useState(() => Date.now());
  const [country, setCountry] = useState("KE");
  const [captchaToken, setCaptchaToken] = useState("");
  const formRef = useRef<HTMLFormElement>(null);

  // Fires once, the render after state.success flips true -- a new school
  // account was actually created, not just that the form validated.
  // state.honeypot guards against counting bots: the honeypot branch in
  // signUpSchool also returns success: true, but no account was created.
  useEffect(() => {
    if (state.success && !state.honeypot) {
      sendGTMEvent({ event: "sign_up" });
    }
  }, [state.success, state.honeypot]);

  // Marketing attribution (UTM tags + Google Ads click ID) for the signup
  // record. /signup does not mount MarketingAnalytics, so a visitor whose ad
  // lands straight here would otherwise never get their parameters captured.
  // captureAttribution() is first-touch and idempotent.
  const attributionJson = useSyncExternalStore(
    subscribeToAttribution,
    getAttributionSnapshot,
    getServerAttributionSnapshot,
  );
  const attribution = JSON.parse(attributionJson) as Attribution;
  useEffect(() => {
    captureAttribution();
  }, []);

  // Names resolved client-side via Intl.DisplayNames — see institution-reference-data.ts.
  const countries = COUNTRY_CODES.map((code) => ({ code, name: countryName(code) })).sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  if (state.success) {
    return (
      <div className="animate-in fade-in zoom-in-95 space-y-4 rounded-lg border border-border bg-surface p-6 text-center shadow-raised duration-300">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success-subtle text-success">
          <CheckCircle2 className="h-7 w-7" strokeWidth={2} />
        </div>
        <h1 className="text-base font-semibold">Your institution is set up</h1>
        <p className="text-sm text-muted-foreground">
          We&apos;ve created <span className="font-medium text-foreground">{state.schoolName}</span>. Sign in
          with the temporary password below — you&apos;ll be asked to choose a new one right away.
        </p>
        <div className="space-y-2 rounded-md border border-dashed border-border bg-muted/40 p-3 text-left">
          <div>
            <p className="text-xs text-muted-foreground">Email</p>
            <p className="font-mono text-sm">{state.email}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Temporary password</p>
            <p className="font-mono text-sm">{state.temporaryPassword}</p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Copy this password now — it won&apos;t be shown again. It expires in 3 days if unused.
        </p>
        <Button asChild className="w-full">
          <a href="/login">
            Continue to sign in <Rocket className="h-4 w-4" />
          </a>
        </Button>
      </div>
    );
  }

  return (
    <form
      ref={formRef}
      action={formAction}
      className="relative space-y-4"
      encType="multipart/form-data"
    >
      <input type="hidden" name="form_loaded_at" value={formLoadedAt} />
      {ATTRIBUTION_KEYS.map((key) => (
        <input key={key} type="hidden" name={key} value={attribution[key] ?? ""} />
      ))}
      {/* Honeypot — hidden from real users via CSS, left unfilled by them; bots that fill
          every field will trip it. */}
      <div className="absolute -left-[9999px]" aria-hidden="true">
        <label htmlFor="company_website">Leave this field blank</label>
        <input type="text" id="company_website" name="company_website" tabIndex={-1} autoComplete="off" />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="owner_name">Your name</Label>
          <Input id="owner_name" name="owner_name" required autoComplete="name" placeholder="e.g. Jane Wanjiru" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="school_name">School name</Label>
          <Input id="school_name" name="school_name" required placeholder="e.g. Sunrise Academy" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" required autoComplete="email" placeholder="you@school.ac.ke" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="phone">Phone</Label>
          <Input id="phone" name="phone" type="tel" required autoComplete="tel" placeholder="+2547XXXXXXXX" />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Country</Label>
        <Select value={country} onValueChange={setCountry}>
          <SelectTrigger>
            <SelectValue placeholder="Select" />
          </SelectTrigger>
          <SelectContent>
            {countries.map((c) => (
              <SelectItem key={c.code} value={c.code}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <input type="hidden" name="country_code" value={country} required />
      </div>

      <div className="space-y-1.5">
        <TurnstileWidget onVerify={setCaptchaToken} />
      </div>

      {state.error && (
        <p role="alert" className="rounded-md border border-destructive-subtle bg-destructive-subtle px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      )}

      <Button type="submit" disabled={pending || !captchaToken} className="w-full" size="lg">
        {pending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Setting up your school…
          </>
        ) : (
          <>
            Start free trial <Rocket className="h-4 w-4" />
          </>
        )}
      </Button>
      {!pending && !captchaToken && (
        <p className="text-center text-xs text-muted-foreground">
          Confirm you&apos;re human above, then submit. If the check doesn&apos;t appear, disable your ad blocker or
          refresh the page.
        </p>
      )}
      <p className="text-center text-xs text-muted-foreground">
        You can add your school&apos;s details, logo and other information after you sign in.
      </p>
    </form>
  );
}
