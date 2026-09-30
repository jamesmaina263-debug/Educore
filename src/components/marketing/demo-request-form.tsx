"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { sendGTMEvent } from "@next/third-parties/google";

import { submitDemoRequest, type DemoRequestState } from "@/app/(marketing)/contact/actions";
import { saveDemoContactStep } from "@/app/(marketing)/contact/partial-lead-actions";
import { MarketingButton } from "@/components/marketing/button";
import { getStoredAttribution } from "@/lib/attribution";
import { ATTRIBUTION_KEYS } from "@/lib/marketing/attribution-fields";
import { getStoredCtaSource } from "@/lib/cta-source";

const initialState: DemoRequestState = { status: "idle" };

const ROLE_OPTIONS = [
  "School Owner",
  "Principal",
  "Administrator",
  "Teacher",
  "Finance",
  "Other",
];

// Step 1 fields, validated with the browser's own constraint validation before Continue saves
// them. Their values are then carried into step 2 as hidden inputs (see the form below).
const STEP_ONE_FIELDS = ["name", "school_name", "email", "phone"] as const;
type ContactDetails = Record<(typeof STEP_ONE_FIELDS)[number], string>;
const EMPTY_CONTACT: ContactDetails = { name: "", school_name: "", email: "", phone: "" };

export function DemoRequestForm() {
  const [state, formAction, pending] = useActionState(submitDemoRequest, initialState);
  // Two-step form: step 1 (contact details) is saved server-side the moment the visitor
  // presses Continue, so a visitor who never finishes step 2 is still a lead. Step 2 holds the
  // rest of the request and the real submit. See partial-lead-actions.ts.
  const [step, setStep] = useState<1 | 2>(1);
  const [savingContact, startSavingContact] = useTransition();
  const [contactError, setContactError] = useState<string | null>(null);
  // Step-1 values that were saved. Kept in state (not read back from the DOM) because React 19
  // resets uncontrolled form fields after a form action finishes -- if the final submit errors,
  // anything only held in an input would be blanked. Step 2 re-submits them as hidden inputs,
  // which a form reset does not clear.
  const [contact, setContact] = useState<ContactDetails>(EMPTY_CONTACT);
  const formRef = useRef<HTMLFormElement>(null);
  const pathname = usePathname();
  const [renderedAt] = useState(() => Date.now());
  // Read once at mount, not on every render -- whatever was captured
  // earlier in this session by MarketingAnalytics (see
  // src/lib/attribution.ts). Empty strings if nothing was captured (direct
  // visit, no UTM params anywhere in this session) -- the server action
  // treats an empty string the same as "not provided".
  const [attribution] = useState(() => getStoredAttribution());
  // Mirrors whatever handleRoleChange last pushed to dataLayer -- kept here
  // too so the submit-time event below can read it directly as a React
  // value instead of re-deriving it, without changing how GTM itself reads
  // it (still the contact_form_role_selected -> DLV v2 path, see that
  // handler's comment).
  const [selectedRole, setSelectedRole] = useState("");
  // Guards the "Demo Form Started" push below so it fires once per mount,
  // not once per field -- see handleFormFocus.
  const [formStarted, setFormStarted] = useState(false);

  // Fires on first focus into any field in the form (React attaches
  // "onFocus" at the root via a focusin listener since React 17, so this
  // form-level handler catches focus on any descendant input/select/
  // textarea without instrumenting each field separately). Matches the
  // exact "Demo Form Started" goal name the admin analytics page's funnel
  // row (src/app/(admin)/admin/analytics/page.tsx) already reads via GA4's
  // getGoalBreakdown() -- no dashboard change needed, it was already
  // looking for this name. "Started" = first focus rather than first blur,
  // so it still captures a mobile visitor who focuses a field then
  // abandons without ever blurring it. Needs a matching GTM container
  // change (GA4 Event tag on a Custom Event trigger named "Demo Form
  // Started") -- not committable from this repo.
  function handleFormFocus() {
    if (formStarted) return;
    setFormStarted(true);
    sendGTMEvent({ event: "Demo Form Started" });
  }

  // Moves keyboard/screen-reader focus to the first step-2 field when the step changes.
  useEffect(() => {
    if (step === 2) document.getElementById("role")?.focus();
  }, [step]);

  function handleContinue() {
    const form = formRef.current;
    if (!form) return;
    for (const field of STEP_ONE_FIELDS) {
      const el = form.elements.namedItem(field) as HTMLInputElement | null;
      if (el && !el.reportValidity()) return;
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

  useEffect(() => {
    if (state.status === "success") {
      // Matches the exact "Demo Request Submitted" goal name the admin
      // analytics page's funnel row already reads (falling back to the
      // real marketing_demo_requests count if this is absent -- see that
      // page's demoFormSubmitted). Sent alongside, not instead of, the
      // existing contact_form_submit event below: that one is already
      // wired to GTM's contact_sales/generate_lead conversion tags with
      // its full attribution payload, and this repo has no way to confirm
      // whether renaming it would break an existing GTM trigger, so it's
      // left untouched. Needs the same GTM container change as above.
      sendGTMEvent({ event: "Demo Request Submitted" });
      // Dedicated conversion event: contact_form_context (above) fires on
      // mount, before the visitor has picked a role or submitted anything,
      // so it can't carry contact_form_role or represent an actual
      // completed submission -- it's context, not a conversion. This fires
      // exactly once, only on a confirmed successful submission, with the
      // full payload GA4's contact_sales / generate_lead tags should
      // actually key off. cta_* re-read from storage (not from the
      // contact_form_context push above) since that's the same
      // source-of-truth the earlier push used and it hasn't changed.
      const cta = getStoredCtaSource();
      sendGTMEvent({
        event: "contact_form_submit",
        page_path: window.location.pathname,
        contact_form_role: selectedRole,
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

  // Pushes UTM attribution + on-site CTA context into dataLayer once, at
  // mount -- not read live off the DOM at submit time, so this can't hit
  // the same undefined-at-submit race the role field had (see the
  // "JS - Contact Form Role" fix below). Values are already known the
  // instant this component renders (attribution captured earlier this
  // session; CTA context captured on whichever /contact link was just
  // clicked, see src/lib/cta-source.ts) -- pushing immediately just makes
  // them available to GTM well before any eventual submit. Non-content
  // only: page/campaign/CTA identifiers, never name/email/phone/message.
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
    // attribution is captured once via useState(() => ...) and never
    // changes for the life of this component -- safe as a dep, won't
    // cause a second push.
  }, [attribution]);

  // GTM's "JS - Contact Form Role" variable was reading document.getElementById
  // ("role") live at submit time, racing the Server Action's success-state
  // swap (which unmounts the form, including #role, the instant the request
  // resolves) -- resolved to undefined in every Preview-mode test. Fix:
  // capture the role the moment it's chosen and push it straight into
  // dataLayer, so GTM's variable/trigger reads an already-present value at
  // submit time instead of reading a DOM node that may already be gone.
  // Non-content only -- the role selection itself, never name/email/phone/
  // message. GTM-side still needs a matching change: point the
  // contact_sales / generate_lead role condition at a Data Layer Variable
  // (Version 2) named "contact_form_role" instead of the old DOM-reading
  // Custom JS variable.
  function handleRoleChange(event: React.ChangeEvent<HTMLSelectElement>) {
    setSelectedRole(event.target.value);
    sendGTMEvent({ event: "contact_form_role_selected", contact_form_role: event.target.value });
  }

  if (state.status === "success") {
    return (
      <div
        role="status"
        className="flex flex-col items-center rounded-xl border border-marketing-navy-950/10 bg-marketing-canvas px-8 py-12 text-center"
      >
        <CheckCircle2 className="h-10 w-10 text-marketing-blue" strokeWidth={1.5} />
        <p className="mt-4 text-lg font-semibold text-marketing-navy-950">
          Thanks — we&apos;ve got it.
        </p>
        <p className="mt-2 max-w-sm text-sm leading-relaxed text-marketing-navy-900/70">
          Someone from EduCore will get back to you shortly to set up a time.
        </p>
      </div>
    );
  }

  return (
    <form
      ref={formRef}
      action={formAction}
      onFocus={handleFormFocus}
      className="flex flex-col gap-5"
    >
      {/* Bot mitigation, not a visible/functional field for real users:
          - honeypot ("company_website") is hidden from sighted users via CSS
            and never announced by a screen reader (aria-hidden + tabIndex -1
            + hidden from the accessibility tree), so a human never fills it,
            but most naive form-filling bots do.
          - "rendered_at" lets the server reject submissions completed faster
            than any human could plausibly fill this form (see actions.ts).
          Neither collects anything from real visitors or touches product data. */}
      <div aria-hidden="true" className="absolute left-[-9999px] top-auto h-px w-px overflow-hidden">
        <label htmlFor="company_website">Company website</label>
        <input
          id="company_website"
          name="company_website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>
      <input type="hidden" name="rendered_at" value={renderedAt} />
      <input type="hidden" name="source_page" value={pathname} />
      {/* Marketing attribution, forwarded silently -- see src/lib/attribution.ts.
          Never shown or asked of the visitor; empty/absent if nothing was
          captured this session. */}
      {ATTRIBUTION_KEYS.map((key) => (
        <input key={key} type="hidden" name={key} value={attribution[key] ?? ""} />
      ))}

      <p className="text-xs font-medium uppercase tracking-wide text-marketing-navy-900/60">
        Step {step} of 2 — {step === 1 ? "Your contact details" : "About your school"}
      </p>

      {step === 1 && (
        <div className="flex flex-col gap-5" onKeyDown={handleStepOneKeyDown}>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Your name" htmlFor="name">
              <input
                id="name"
                name="name"
                type="text"
                required
                defaultValue={contact.name}
                autoComplete="name"
                className={inputClass}
              />
            </Field>
            <Field label="School name" htmlFor="school_name">
              <input
                id="school_name"
                name="school_name"
                type="text"
                required
                defaultValue={contact.school_name}
                className={inputClass}
              />
            </Field>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Email" htmlFor="email">
              <input
                id="email"
                name="email"
                type="email"
                required
                defaultValue={contact.email}
                autoComplete="email"
                className={inputClass}
              />
            </Field>
            <Field label="Phone" htmlFor="phone" optional>
              <input
                id="phone"
                name="phone"
                type="tel"
                defaultValue={contact.phone}
                autoComplete="tel"
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
              {savingContact ? "Saving..." : "Continue"}
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
              Booking for <strong className="font-semibold">{contact.name}</strong> at{" "}
              <strong className="font-semibold">{contact.school_name}</strong>
            </span>
            <button
              type="button"
              onClick={() => setStep(1)}
              className="text-marketing-blue underline-offset-2 hover:underline"
            >
              Edit details
            </button>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Your role" htmlFor="role">
              <select
                id="role"
                name="role"
                required
                defaultValue=""
                onChange={handleRoleChange}
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
            <Field label="Roughly how many students?" htmlFor="student_count" optional>
              <input
                id="student_count"
                name="student_count"
                type="number"
                min={0}
                inputMode="numeric"
                className={inputClass}
              />
            </Field>
          </div>

          <Field label="Anything specific you'd like us to cover?" htmlFor="message" optional>
            <textarea id="message" name="message" rows={4} className={inputClass} />
          </Field>
        </>
      )}

      {state.status === "error" && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {state.message}
        </p>
      )}

      {step === 2 && (
        <MarketingButton type="submit" size="lg" disabled={pending} className="w-full sm:w-auto">
          {pending ? "Sending..." : "Book a Demo"}
        </MarketingButton>
      )}
    </form>
  );
}

const inputClass =
  "w-full rounded-md border border-marketing-navy-950/15 bg-white px-3 py-2 text-sm text-marketing-navy-950 shadow-sm placeholder:text-marketing-navy-900/60 focus:outline-none focus:ring-2 focus:ring-marketing-blue/40 focus:border-marketing-blue";

function Field({
  label,
  htmlFor,
  optional,
  children,
}: {
  label: string;
  htmlFor: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium text-marketing-navy-950">
        {label}
        {optional && (
          <span className="ml-1 font-normal text-marketing-navy-900/60">(optional)</span>
        )}
      </label>
      {children}
    </div>
  );
}
