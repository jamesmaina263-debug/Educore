"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";
import { sendGTMEvent } from "@next/third-parties/google";

import { submitDemoRequest, type DemoRequestState } from "@/app/(marketing)/contact/actions";
import { saveDemoContactStep } from "@/app/(marketing)/contact/partial-lead-actions";
import { MarketingButton } from "@/components/marketing/button";
import { getStoredAttribution } from "@/lib/attribution";
import { ATTRIBUTION_KEYS } from "@/lib/marketing/attribution-fields";
import {
  CONTACT_METHODS,
  ROLE_OPTIONS,
  TIME_WINDOWS,
  WHATSAPP_CONSENT_LABEL,
  formatPreferredDate,
  todayInNairobi,
  type ContactMethod,
  type RequestType,
  type TimeWindow,
} from "@/lib/marketing/demo-request";
import { getStoredCtaSource } from "@/lib/cta-source";

const initialState: DemoRequestState = { status: "idle" };

// Shown to visitors as the follow-up promise. Keep in sync with what the team can deliver.
const FOLLOW_UP = "within two hours";

// Step 1 fields, validated with the browser's own constraint validation before Continue saves
// them. Their values are then carried into step 2 as hidden inputs (see the form below).
const STEP_ONE_FIELDS = ["name", "school_name", "phone", "email"] as const;
type StepOneField = (typeof STEP_ONE_FIELDS)[number];
type ContactDetails = Record<StepOneField, string>;
const EMPTY_CONTACT: ContactDetails = { name: "", school_name: "", phone: "", email: "" };

// Step 2 values are controlled so a server error never blanks what the visitor already chose.
type Details = {
  role: string;
  contactMethod: ContactMethod;
  requestType: RequestType;
  preferredDate: string;
  timeWindow: TimeWindow | "";
  studentCount: string;
  message: string;
  whatsappConsent: boolean;
};
const EMPTY_DETAILS: Details = {
  role: "",
  contactMethod: "whatsapp",
  requestType: "callback",
  preferredDate: "",
  timeWindow: "",
  studentCount: "",
  message: "",
  whatsappConsent: false,
};

export function DemoRequestForm() {
  const [state, formAction, pending] = useActionState(submitDemoRequest, initialState);
  // Two-step form: step 1 (contact details) is saved server-side the moment the visitor
  // presses Continue, so a visitor who never finishes step 2 is still a lead that the admin
  // console shows under "incomplete". Step 2 holds the rest of the request and the real submit.
  const [step, setStep] = useState<1 | 2>(1);
  const [savingContact, startSavingContact] = useTransition();
  const [contactError, setContactError] = useState<string | null>(null);
  // Step-1 values that were saved. Kept in state (not read back from the DOM) because React 19
  // resets uncontrolled form fields after a form action finishes. Step 2 re-submits them as
  // hidden inputs, which a form reset does not clear.
  const [contact, setContact] = useState<ContactDetails>(EMPTY_CONTACT);
  const [details, setDetails] = useState<Details>(EMPTY_DETAILS);
  // Nairobi calendar-day limits for the date picker. The picker only renders after the visitor
  // chooses "specific day", so this never appears in server-rendered HTML.
  const [dateBounds] = useState(() => {
    const min = todayInNairobi();
    const max = new Date(`${min}T00:00:00Z`);
    max.setUTCDate(max.getUTCDate() + 60);
    return { min, max: max.toISOString().slice(0, 10) };
  });
  const formRef = useRef<HTMLFormElement>(null);
  const pathname = usePathname();
  const [renderedAt] = useState(() => Date.now());
  // Read once at mount -- whatever was captured earlier in this session by MarketingAnalytics
  // (see src/lib/attribution.ts). Empty strings if nothing was captured; the server action
  // treats an empty string the same as "not provided".
  const [attribution] = useState(() => getStoredAttribution());
  // Guards the "Demo Form Started" push so it fires once per mount, not once per field.
  const [formStarted, setFormStarted] = useState(false);
  // Latest values for the page-hide handler, which must not re-subscribe on every keystroke.
  const live = useRef({ started: false, done: false, step: 1 as 1 | 2, abandonSent: false });
  useEffect(() => {
    live.current.started = formStarted;
    live.current.done = state.status === "success";
    live.current.step = step;
  });

  // "Demo Form Started": first focus into any field (React delegates focus to the root, so this
  // form-level handler catches every descendant). First focus rather than first blur, so a
  // mobile visitor who focuses a field then leaves is still counted. Event name matches the
  // goal the admin analytics funnel already reads.
  function handleFormFocus() {
    if (formStarted) return;
    setFormStarted(true);
    sendGTMEvent({ event: "Demo Form Started" });
  }

  // Best-effort abandonment signal: the visitor started the form and hid/left the page without a
  // confirmed submit. Fires at most once per page view and carries only the step number. Mobile
  // browsers can suspend pages before a tag flushes, so treat this count as approximate; the
  // incomplete-lead list in the admin console remains the source of truth for step-1 drop-offs.
  useEffect(() => {
    function onHide() {
      const l = live.current;
      if (document.visibilityState !== "hidden") return;
      if (!l.started || l.done || l.abandonSent) return;
      l.abandonSent = true;
      sendGTMEvent({ event: "Demo Form Abandoned", form_step: l.step });
    }
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, []);

  // Moves keyboard/screen-reader focus to the first step-2 field when the step changes.
  useEffect(() => {
    if (step === 2) document.getElementById("role")?.focus();
  }, [step]);

  function reportValidationError(formStep: 1 | 2, field: string) {
    // Field NAME only -- never the value, never the message text.
    sendGTMEvent({ event: "Demo Form Validation Error", form_step: formStep, error_field: field });
  }

  function handleContinue() {
    const form = formRef.current;
    if (!form) return;
    for (const field of STEP_ONE_FIELDS) {
      const el = form.elements.namedItem(field) as HTMLInputElement | null;
      if (el && !el.reportValidity()) {
        reportValidationError(1, field);
        return;
      }
    }
    setContactError(null);
    const data = new FormData(form);
    const saved = Object.fromEntries(
      STEP_ONE_FIELDS.map((field) => [field, String(data.get(field) ?? "").trim()]),
    ) as ContactDetails;
    startSavingContact(async () => {
      const result = await saveDemoContactStep(data);
      if (result.status === "error") {
        setContactError(result.message);
        reportValidationError(1, "server");
        return;
      }
      // Needs a matching GTM container change to reach GA4 (like "Demo Form Started" above).
      sendGTMEvent({ event: "Demo Form Contact Step Completed" });
      setContact(saved);
      setStep(2);
    });
  }

  // Enter in a step-1 field means "Continue", not "submit the whole form" (which would fail
  // server-side validation for the step-2 fields that aren't on screen yet).
  function handleStepOneKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Enter" || step !== 1) return;
    if ((event.target as HTMLElement).tagName !== "INPUT") return;
    event.preventDefault();
    handleContinue();
  }

  // A second submit while one is in flight (double tap, Enter held down) is dropped here; the
  // server additionally ignores an identical phone + school within 10 minutes.
  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    if (pending) event.preventDefault();
  }

  // A server-side validation failure on a step-1 field sends the visitor back to step 1.
  // (Derived during render, React's documented pattern for resetting state when an input changes.)
  const [seenState, setSeenState] = useState(state);
  if (state !== seenState) {
    setSeenState(state);
    if (state.status === "error" && state.field && isStepOneField(state.field)) setStep(1);
  }

  // Report which field failed (name only, never the value) and move focus to it.
  useEffect(() => {
    if (state.status !== "error") return;
    reportValidationError(2, state.field ?? "server");
    const target = state.field;
    if (target) {
      // Wait a frame so a step change has rendered the target field.
      requestAnimationFrame(() => document.getElementById(fieldId(target))?.focus());
    }
  }, [state]);

  useEffect(() => {
    if (state.status === "success") {
      // "Demo Request Submitted": exact goal name the admin analytics funnel already reads.
      // Sent alongside, not instead of, contact_form_submit below, which is already wired to
      // GTM's contact_sales/generate_lead tags.
      sendGTMEvent({ event: "Demo Request Submitted" });
      // Fires exactly once, only on a confirmed successful submission. Non-content only:
      // identifiers for the page/campaign/CTA and two non-identifying form choices -- never
      // name, school, phone, email or message.
      const cta = getStoredCtaSource();
      sendGTMEvent({
        event: "contact_form_submit",
        page_path: window.location.pathname,
        contact_form_role: details.role,
        contact_form_preferred_method: details.contactMethod,
        contact_form_request_type: details.requestType,
        cta_location: cta.location ?? "",
        cta_label: cta.label ?? "",
        cta_tier: cta.tier ?? "",
        utm_source: attribution.utm_source ?? "",
        utm_medium: attribution.utm_medium ?? "",
        utm_campaign: attribution.utm_campaign ?? "",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status]);

  // Pushes UTM attribution + on-site CTA context into dataLayer once, at mount, so GTM reads
  // already-present values at submit time. Non-content only.
  useEffect(() => {
    const cta = getStoredCtaSource();
    sendGTMEvent({
      event: "contact_form_context",
      utm_source: attribution.utm_source ?? "",
      utm_medium: attribution.utm_medium ?? "",
      utm_campaign: attribution.utm_campaign ?? "",
      cta_location: cta.location ?? "",
      cta_label: cta.label ?? "",
      cta_tier: cta.tier ?? "",
    });
  }, [attribution]);

  function setDetail<K extends keyof Details>(key: K, value: Details[K]) {
    setDetails((d) => ({ ...d, [key]: value }));
  }

  function handleRoleChange(event: React.ChangeEvent<HTMLSelectElement>) {
    setDetail("role", event.target.value);
    // Pushed at selection time so GTM never reads a DOM node that has already unmounted.
    sendGTMEvent({ event: "contact_form_role_selected", contact_form_role: event.target.value });
  }

  if (state.status === "success") {
    const method = CONTACT_METHODS.find((m) => m.value === details.contactMethod)?.label ?? "";
    const scheduled =
      details.requestType === "scheduled" && details.preferredDate && details.timeWindow;
    const windowLabel = TIME_WINDOWS.find((w) => w.value === details.timeWindow)?.label;
    return (
      <div
        role="status"
        className="flex flex-col items-center rounded-xl border border-marketing-navy-950/10 bg-marketing-canvas px-6 py-10 text-center sm:px-8 sm:py-12"
      >
        <CheckCircle2 className="h-10 w-10 text-marketing-blue" strokeWidth={1.5} aria-hidden="true" />
        <p className="mt-4 text-lg font-semibold text-marketing-navy-950">Request received</p>
        <p className="mt-2 max-w-sm text-sm leading-relaxed text-marketing-navy-900/75">
          We aim to contact you {FOLLOW_UP} by {method.toLowerCase()} to{" "}
          {scheduled ? "confirm a time" : "arrange your demo"}.
        </p>
        {scheduled && (
          <p className="mt-3 max-w-sm rounded-md bg-white px-3 py-2 text-sm text-marketing-navy-900/80">
            You asked for <strong>{formatPreferredDate(details.preferredDate)}</strong>,{" "}
            {windowLabel}. This is a preference, not a confirmed booking — we&apos;ll confirm it or
            suggest the nearest alternative.
          </p>
        )}
        <p className="mt-4 text-xs text-marketing-navy-900/70">
          Need us sooner?{" "}
          <a
            href="https://wa.me/254702904562?text=Hi%2C%20I%20just%20requested%20an%20EduCore%20demo."
            className="font-medium text-marketing-blue underline underline-offset-2"
          >
            WhatsApp +254 702 904562
          </a>
        </p>
      </div>
    );
  }

  const errorField = state.status === "error" ? state.field : undefined;

  return (
    <form
      ref={formRef}
      action={formAction}
      onSubmit={handleSubmit}
      onFocus={handleFormFocus}
      aria-busy={pending}
      className="flex flex-col gap-5"
    >
      {/* Bot mitigation, not a visible/functional field for real users:
          - honeypot ("company_website") is hidden from sighted users via CSS and never announced
            by a screen reader (aria-hidden + tabIndex -1), so a human never fills it, but most
            naive form-filling bots do.
          - "rendered_at" lets the server reject submissions completed faster than any human
            could plausibly fill this form (see actions.ts). */}
      <div aria-hidden="true" className="absolute left-[-9999px] top-auto h-px w-px overflow-hidden">
        <label htmlFor="company_website">Company website</label>
        <input id="company_website" name="company_website" type="text" tabIndex={-1} autoComplete="off" />
      </div>
      <input type="hidden" name="rendered_at" value={renderedAt} />
      <input type="hidden" name="source_page" value={pathname} />
      {/* Marketing attribution, forwarded silently -- see src/lib/attribution.ts. */}
      {ATTRIBUTION_KEYS.map((key) => (
        <input key={key} type="hidden" name={key} value={attribution[key] ?? ""} />
      ))}

      <p className="text-xs font-medium uppercase tracking-wide text-marketing-navy-900/70">
        Step {step} of 2 — {step === 1 ? "Your contact details" : "Your demo preferences"}
      </p>

      {step === 1 && (
        <div className="flex flex-col gap-5" onKeyDown={handleStepOneKeyDown}>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Your name" htmlFor="name" invalid={errorField === "name"}>
              <input
                id="name"
                name="name"
                type="text"
                required
                maxLength={120}
                defaultValue={contact.name}
                autoComplete="name"
                aria-invalid={errorField === "name" || undefined}
                className={inputClass}
              />
            </Field>
            <Field label="School name" htmlFor="school_name" invalid={errorField === "school_name"}>
              <input
                id="school_name"
                name="school_name"
                type="text"
                required
                maxLength={200}
                defaultValue={contact.school_name}
                autoComplete="organization"
                aria-invalid={errorField === "school_name" || undefined}
                className={inputClass}
              />
            </Field>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              label="Phone (WhatsApp or calls)"
              htmlFor="phone"
              hint="e.g. 0712 345 678"
              invalid={errorField === "phone"}
            >
              <input
                id="phone"
                name="phone"
                type="tel"
                inputMode="tel"
                required
                minLength={9}
                maxLength={20}
                pattern="[+0-9\s().\-]{9,20}"
                title="Enter a phone number, e.g. 0712 345 678"
                defaultValue={contact.phone}
                autoComplete="tel"
                aria-invalid={errorField === "phone" || undefined}
                className={inputClass}
              />
            </Field>
            <Field label="Email" htmlFor="email" invalid={errorField === "email"}>
              <input
                id="email"
                name="email"
                type="email"
                inputMode="email"
                required
                maxLength={254}
                defaultValue={contact.email}
                autoComplete="email"
                aria-invalid={errorField === "email" || undefined}
                className={inputClass}
              />
            </Field>
          </div>

          {contactError && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {contactError}
            </p>
          )}

          <div className="flex flex-col gap-3">
            <MarketingButton
              type="button"
              size="lg"
              onClick={handleContinue}
              disabled={savingContact}
              className="w-full sm:w-auto sm:self-start"
            >
              {savingContact ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Saving...
                </>
              ) : (
                "Continue"
              )}
            </MarketingButton>
            {/* Disclosure for saving step 1 before the final submit -- keep in sync with the
                "What we collect" section of /privacy. */}
            <p className="text-xs leading-relaxed text-marketing-navy-900/70">
              When you continue, we save these contact details so our team can follow up about your
              demo, even if you don&apos;t finish the next step. See our{" "}
              <Link href="/privacy" className="underline underline-offset-2 hover:text-marketing-blue">
                privacy policy
              </Link>
              .
            </p>
          </div>
        </div>
      )}

      {step === 2 && (
        <>
          {STEP_ONE_FIELDS.map((field) => (
            <input key={field} type="hidden" name={field} value={contact[field]} />
          ))}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-marketing-canvas px-3 py-2 text-sm text-marketing-navy-900/80">
            <span>
              Demo for <strong className="font-semibold">{contact.name}</strong> at{" "}
              <strong className="font-semibold">{contact.school_name}</strong>
            </span>
            <button
              type="button"
              onClick={() => setStep(1)}
              className="min-h-11 px-2 text-marketing-blue underline-offset-2 hover:underline"
            >
              Edit details
            </button>
          </div>

          <Field label="Your role" htmlFor="role" invalid={errorField === "role"}>
            <select
              id="role"
              name="role"
              required
              value={details.role}
              onChange={handleRoleChange}
              aria-invalid={errorField === "role" || undefined}
              className={inputClass}
            >
              <option value="" disabled>
                Select a role
              </option>
              {ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </Field>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium text-marketing-navy-950">
              How should we reach you?
            </legend>
            <div className="flex flex-wrap gap-2">
              {CONTACT_METHODS.map((m) => (
                <Choice
                  key={m.value}
                  name="contact_method"
                  value={m.value}
                  checked={details.contactMethod === m.value}
                  onChange={() => setDetail("contactMethod", m.value)}
                >
                  {m.label}
                </Choice>
              ))}
            </div>
            {/* Never ticked by default: it is a separate, explicit agreement, stored with these exact words. */}
            <label className="flex cursor-pointer items-start gap-2 text-sm text-marketing-navy-900/80">
              <input
                type="checkbox"
                name="whatsapp_consent"
                value="yes"
                checked={details.whatsappConsent}
                onChange={(e) => setDetail("whatsappConsent", e.target.checked)}
                className="mt-1 h-4 w-4 shrink-0"
              />
              <span>{WHATSAPP_CONSENT_LABEL}</span>
            </label>
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium text-marketing-navy-950">
              When would you like your demo?
            </legend>
            <div className="flex flex-wrap gap-2">
              <Choice
                name="request_type"
                value="callback"
                checked={details.requestType === "callback"}
                onChange={() => setDetail("requestType", "callback")}
              >
                Call me back as soon as possible
              </Choice>
              <Choice
                name="request_type"
                value="scheduled"
                checked={details.requestType === "scheduled"}
                onChange={() => setDetail("requestType", "scheduled")}
              >
                I&apos;d prefer a specific day
              </Choice>
            </div>
            <p className="text-xs leading-relaxed text-marketing-navy-900/70">
              {details.requestType === "callback"
                ? `We aim to contact you ${FOLLOW_UP} to agree a time.`
                : "Tell us what suits you. It isn't booked until we confirm it with you — we'll suggest the nearest alternative if that slot is taken."}
            </p>
          </fieldset>

          {details.requestType === "scheduled" && (
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Preferred day" htmlFor="preferred_date" invalid={errorField === "preferred_date"}>
                <input
                  id="preferred_date"
                  name="preferred_date"
                  type="date"
                  required
                  min={dateBounds.min}
                  max={dateBounds.max}
                  value={details.preferredDate}
                  onChange={(e) => setDetail("preferredDate", e.target.value)}
                  aria-invalid={errorField === "preferred_date" || undefined}
                  className={inputClass}
                />
              </Field>
              <Field label="Preferred time (EAT)" htmlFor="time_window" invalid={errorField === "time_window"}>
                <select
                  id="time_window"
                  name="time_window"
                  required
                  value={details.timeWindow}
                  onChange={(e) => setDetail("timeWindow", e.target.value as TimeWindow)}
                  aria-invalid={errorField === "time_window" || undefined}
                  className={inputClass}
                >
                  <option value="" disabled>
                    Choose a time
                  </option>
                  {TIME_WINDOWS.map((w) => (
                    <option key={w.value} value={w.value}>
                      {w.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          )}

          <details className="rounded-md border border-marketing-navy-950/10 px-3 py-2">
            <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-marketing-navy-950">
              Anything else we should know? (optional)
            </summary>
            <div className="mt-2 flex flex-col gap-5 pb-2">
              <Field label="Roughly how many students?" htmlFor="student_count" optional invalid={errorField === "student_count"}>
                <input
                  id="student_count"
                  name="student_count"
                  type="number"
                  min={0}
                  max={100000}
                  step={1}
                  inputMode="numeric"
                  value={details.studentCount}
                  onChange={(e) => setDetail("studentCount", e.target.value)}
                  className={inputClass}
                />
              </Field>
              <Field label="Anything specific you'd like us to cover?" htmlFor="message" optional>
                <textarea
                  id="message"
                  name="message"
                  rows={3}
                  maxLength={1500}
                  value={details.message}
                  onChange={(e) => setDetail("message", e.target.value)}
                  className={inputClass}
                />
              </Field>
            </div>
          </details>
        </>
      )}

      {state.status === "error" && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {state.message}
        </p>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-2">
          <MarketingButton type="submit" size="lg" disabled={pending} className="w-full sm:w-auto sm:self-start">
            {pending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Sending your request...
              </>
            ) : (
              "Request my demo"
            )}
          </MarketingButton>
          <p className="text-xs leading-relaxed text-marketing-navy-900/70">
            This sends a request — your demo isn&apos;t confirmed until we get back to you, which we
            aim to do {FOLLOW_UP}. No obligation, no payment.
          </p>
        </div>
      )}
    </form>
  );
}

function isStepOneField(field: string): field is StepOneField {
  return (STEP_ONE_FIELDS as readonly string[]).includes(field);
}

function fieldId(field: string): string {
  return field === "contact_method" || field === "request_type" ? "role" : field;
}

// 16px text stops iOS Safari zooming the page when a field is focused, and min-h-11 (44px)
// meets the recommended touch-target size.
const inputClass =
  "min-h-11 w-full rounded-md border border-marketing-navy-950/20 bg-white px-3 py-2 text-base text-marketing-navy-950 shadow-sm placeholder:text-marketing-navy-900/60 focus:outline-none focus:ring-2 focus:ring-marketing-blue/40 focus:border-marketing-blue aria-[invalid=true]:border-destructive";

function Field({
  label,
  htmlFor,
  optional,
  hint,
  invalid,
  children,
}: {
  label: string;
  htmlFor: string;
  optional?: boolean;
  hint?: string;
  invalid?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5" data-invalid={invalid || undefined}>
      <label htmlFor={htmlFor} className="text-sm font-medium text-marketing-navy-950">
        {label}
        {optional && <span className="ml-1 font-normal text-marketing-navy-900/70">(optional)</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-marketing-navy-900/70">{hint}</p>}
    </div>
  );
}

// A radio styled as a large tappable pill. The input is visually hidden but stays focusable and
// announced by screen readers; the label carries the 44px touch target.
function Choice({
  name,
  value,
  checked,
  onChange,
  children,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: () => void;
  children: React.ReactNode;
}) {
  return (
    <label
      className={`flex min-h-11 cursor-pointer items-center rounded-md border px-4 py-2 text-sm font-medium transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-marketing-blue/50 ${
        checked
          ? "border-marketing-blue bg-marketing-blue/5 text-marketing-navy-950"
          : "border-marketing-navy-950/20 bg-white text-marketing-navy-900/80 hover:border-marketing-navy-950/40"
      }`}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        className="sr-only"
      />
      {children}
    </label>
  );
}
