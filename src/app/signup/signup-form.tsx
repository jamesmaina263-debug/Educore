"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  UserRound,
  Building2,
  ImageIcon,
  Share2,
  CheckCircle2,
  Loader2,
  Rocket,
  UploadCloud,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { TurnstileWidget } from "@/components/turnstile-widget";
import { sendGTMEvent } from "@next/third-parties/google";
import { signUpSchool, type SignupState } from "./actions";
import {
  TITLE_OPTIONS,
  SCHOOL_TYPE_OPTIONS,
  CYCLE_OPTIONS,
  OWNERSHIP_TYPE_OPTIONS,
  INSTITUTION_TYPE_OPTIONS,
  COUNTRY_CODES,
  CURRENCY_CODES,
  countryName,
  currencyName,
  startingYearOptions,
  timezoneOptions,
} from "@/lib/institution-reference-data";

const initialState: SignupState = { error: null };

type SelectField =
  | "title"
  | "school_type"
  | "cycle_type"
  | "ownership_type"
  | "institution_type"
  | "country_code"
  | "starting_academic_year"
  | "gmt_timezone"
  | "currency_code";

const EMPTY_VALUES: Record<SelectField, string> = {
  title: "",
  school_type: "",
  cycle_type: "",
  ownership_type: "",
  institution_type: "",
  country_code: "",
  starting_academic_year: "",
  gmt_timezone: "",
  currency_code: "",
};

function SectionHeading({ icon: Icon, title, hint }: { icon: typeof UserRound; title: string; hint?: string }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary-subtle text-primary">
        <Icon className="h-4 w-4" strokeWidth={2} />
      </span>
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}

export function SignupForm() {
  const [state, formAction, pending] = useActionState(signUpSchool, initialState);
  const [formLoadedAt] = useState(() => Date.now());
  const [values, setValues] = useState<Record<SelectField, string>>(EMPTY_VALUES);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [captchaToken, setCaptchaToken] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // Live completion progress, purely a UX affordance — reads every
  // `[required]` control actually in the DOM (plain inputs + the hidden
  // inputs the Select components bubble their value into), so it can never
  // drift out of sync with what's actually required for submission.
  const [progress, setProgress] = useState({ filled: 0, total: 0 });
  const recomputeProgress = () => {
    const form = formRef.current;
    if (!form) return;
    const required = Array.from(
      form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[required]"),
    );
    const filled = required.filter((el) => el.value.trim() !== "").length;
    setProgress({ filled, total: required.length });
  };
  useEffect(recomputeProgress, [values]);

  // Fires once, the render after state.success flips true -- a new school
  // account was actually created, not just that the form validated. No
  // sign_up event existed anywhere on the site before this -- the funnel
  // in the SEO brief (Search -> Landing -> Feature -> Demo CTA -> Demo
  // Request -> Lead) stops at the lead; this closes the gap for the
  // self-serve "Start a school" path that skips the demo entirely.
  useEffect(() => {
    if (state.success) {
      sendGTMEvent({ event: "sign_up" });
    }
  }, [state.success]);

  const set = (field: SelectField) => (v: string) => setValues((prev) => ({ ...prev, [field]: v }));

  // Names resolved client-side via Intl.DisplayNames — see institution-reference-data.ts.
  const countries = COUNTRY_CODES.map((code) => ({ code, name: countryName(code) })).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const currencies = CURRENCY_CODES.map((code) => ({ code, name: currencyName(code) })).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const timezones = timezoneOptions();
  const years = startingYearOptions();

  const allSelectsFilled = Object.values(values).every((v) => v !== "");
  const percent = progress.total > 0 ? Math.round((progress.filled / progress.total) * 100) : 0;

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
      className="relative space-y-6"
      encType="multipart/form-data"
      onInput={recomputeProgress}
      onChange={recomputeProgress}
    >
      <input type="hidden" name="form_loaded_at" value={formLoadedAt} />
      {/* Honeypot — hidden from real users via CSS, left unfilled by them; bots that fill
          every field will trip it. Named distinctly from the real "website" field below. */}
      <div className="absolute -left-[9999px]" aria-hidden="true">
        <label htmlFor="company_website">Leave this field blank</label>
        <input type="text" id="company_website" name="company_website" tabIndex={-1} autoComplete="off" />
      </div>

      {/* Live progress — decorative, computed from real [required] elements in the DOM. */}
      <div className="sticky top-0 z-10 -mx-6 -mt-2 space-y-1.5 bg-surface/95 px-6 pb-3 pt-2 backdrop-blur">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {progress.filled} of {progress.total} required fields complete
          </span>
          <span className="font-medium text-foreground">{percent}%</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>

      <div className="animate-in fade-in slide-in-from-bottom-1 duration-300">
        <SectionHeading icon={UserRound} title="About you" />
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Your Title</Label>
            <Select value={values.title} onValueChange={set("title")}>
              <SelectTrigger>
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
            <input type="hidden" name="title" value={values.title} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="owner_name">Your Name</Label>
            <Input id="owner_name" name="owner_name" required autoComplete="name" placeholder="e.g. Joe Doe" />
          </div>
        </div>
        <div className="mt-3 space-y-1.5">
          <Label>School Type</Label>
          <Select value={values.school_type} onValueChange={set("school_type")}>
            <SelectTrigger>
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
          <input type="hidden" name="school_type" value={values.school_type} required />
        </div>
      </div>

      <div className="animate-in fade-in slide-in-from-bottom-1 duration-300">
        <SectionHeading icon={Building2} title="Institution details" />
        <div className="space-y-1.5">
          <Label htmlFor="school_name">Institution Name</Label>
          <Input id="school_name" name="school_name" required placeholder="Enter Institution Name" />
        </div>

        <div className="mt-3 space-y-1.5">
          <Label htmlFor="description">Institution Description</Label>
          <Textarea id="description" name="description" required rows={3} />
        </div>

        <div className="mt-3 space-y-1.5">
          <Label>Cycles</Label>
          <Select value={values.cycle_type} onValueChange={set("cycle_type")}>
            <SelectTrigger>
              <SelectValue placeholder="Select" />
            </SelectTrigger>
            <SelectContent>
              {CYCLE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <input type="hidden" name="cycle_type" value={values.cycle_type} required />
        </div>

        <div className="mt-3 grid grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label>Organisation State</Label>
            <Select value={values.ownership_type} onValueChange={set("ownership_type")}>
              <SelectTrigger>
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent>
                {OWNERSHIP_TYPE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <input type="hidden" name="ownership_type" value={values.ownership_type} required />
          </div>
          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select value={values.institution_type} onValueChange={set("institution_type")}>
              <SelectTrigger>
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent>
                {INSTITUTION_TYPE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <input type="hidden" name="institution_type" value={values.institution_type} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="phone">Phone</Label>
            <Input id="phone" name="phone" required autoComplete="tel" placeholder="+2547XXXXXXXX" />
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" required autoComplete="email" placeholder="Enter email" />
          </div>
          <div className="space-y-1.5">
            <Label>Country</Label>
            <Select value={values.country_code} onValueChange={set("country_code")}>
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
            <input type="hidden" name="country_code" value={values.country_code} required />
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="address">Address</Label>
            <Input id="address" name="address" required />
          </div>
          <div className="space-y-1.5">
            <Label>Year</Label>
            <Select value={values.starting_academic_year} onValueChange={set("starting_academic_year")}>
              <SelectTrigger>
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent>
                {years.map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <input type="hidden" name="starting_academic_year" value={values.starting_academic_year} required />
          </div>
          <div className="space-y-1.5">
            <Label>GMT Timezone</Label>
            <Select value={values.gmt_timezone} onValueChange={set("gmt_timezone")}>
              <SelectTrigger>
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent>
                {timezones.map((tz) => (
                  <SelectItem key={tz} value={tz}>
                    {tz}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <input type="hidden" name="gmt_timezone" value={values.gmt_timezone} required />
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label>Currency Code</Label>
            <Select value={values.currency_code} onValueChange={set("currency_code")}>
              <SelectTrigger>
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent>
                {currencies.map((c) => (
                  <SelectItem key={c.code} value={c.code}>
                    {c.code} — {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <input type="hidden" name="currency_code" value={values.currency_code} required />
          </div>
        </div>
      </div>

      <div className="animate-in fade-in slide-in-from-bottom-1 duration-300">
        <SectionHeading icon={ImageIcon} title="Logo" hint="optional" />
        <div
          role="button"
          tabIndex={0}
          className={`flex h-28 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-md border-2 border-dashed p-3 text-center text-sm transition-colors ${
            dragActive ? "border-primary bg-primary-subtle" : "border-border hover:border-border-strong hover:bg-accent"
          }`}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click();
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragActive(false);
            const file = e.dataTransfer.files?.[0];
            if (file) setLogoFile(file);
          }}
        >
          <UploadCloud className={`h-5 w-5 ${dragActive ? "text-primary" : "text-muted-foreground"}`} strokeWidth={1.75} />
          {logoFile ? (
            <p className="font-medium text-foreground">{logoFile.name}</p>
          ) : (
            <p className="text-muted-foreground">Drag Your Logo Here or Click in this Area</p>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          name="logo"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          className="hidden"
          onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)}
        />
      </div>

      <div className="animate-in fade-in slide-in-from-bottom-1 duration-300">
        <SectionHeading icon={Share2} title="Online presence" hint="optional" />
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="website">Website</Label>
            <Input id="website" name="website" type="url" placeholder="https://" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="facebook_url">Facebook</Label>
            <Input id="facebook_url" name="facebook_url" type="url" placeholder="https://" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="twitter_url">Twitter</Label>
            <Input id="twitter_url" name="twitter_url" type="url" placeholder="https://" />
          </div>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="instagram_url">Instagram</Label>
            <Input id="instagram_url" name="instagram_url" type="url" placeholder="https://" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="youtube_url">YouTube</Label>
            <Input id="youtube_url" name="youtube_url" type="url" placeholder="https://" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cloud_folder_url">Cloud Folder</Label>
            <Input id="cloud_folder_url" name="cloud_folder_url" type="url" placeholder="https://" />
          </div>
        </div>
      </div>

      <div className="space-y-1.5">
        <TurnstileWidget onVerify={setCaptchaToken} />
      </div>

      {state.error && (
        <p role="alert" className="rounded-md border border-destructive-subtle bg-destructive-subtle px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      )}

      <Button type="submit" disabled={pending || !allSelectsFilled || !captchaToken} className="w-full" size="lg">
        {pending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Setting up your institution…
          </>
        ) : (
          <>
            Setup My Institution <Rocket className="h-4 w-4" />
          </>
        )}
      </Button>
      {!pending && (!allSelectsFilled || !captchaToken) && (
        <p className="text-center text-xs text-muted-foreground">
          {!allSelectsFilled
            ? "Complete every field above to continue."
            : "Complete the CAPTCHA above to continue."}
        </p>
      )}
    </form>
  );
}
