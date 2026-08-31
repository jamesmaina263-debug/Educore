"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { sendGTMEvent } from "@next/third-parties/google";

import { submitDemoRequest, type DemoRequestState } from "@/app/(marketing)/contact/actions";
import { MarketingButton } from "@/components/marketing/button";
import { trackEvent } from "@/components/marketing/analytics";
import { getStoredAttribution } from "@/lib/attribution";
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

export function DemoRequestForm() {
  const [state, formAction, pending] = useActionState(submitDemoRequest, initialState);
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

  useEffect(() => {
    if (state.status === "success") {
      trackEvent("Demo Request Submitted");

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

  // Fires once, on the visitor's first real interaction with any field --
  // lets the funnel spec's "Demo Form Started -> Demo Request Submitted"
  // stage measure abandonment, not just completions. Ignores the honeypot
  // and hidden bot-mitigation fields (they're never focused by a real
  // visitor, and a bot filling them shouldn't count as a real form start).
  const startedRef = useRef(false);
  function handleFormFocus(event: React.FocusEvent<HTMLFormElement>) {
    if (startedRef.current) return;
    const targetName = (event.target as HTMLElement).getAttribute("name");
    if (targetName === "company_website") return;
    startedRef.current = true;
    trackEvent("Demo Form Started");
  }

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
    <form action={formAction} onFocusCapture={handleFormFocus} className="flex flex-col gap-5">
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
      {/* Marketing attribution, forwarded silently -- see src/lib/attribution.ts.
          Never shown or asked of the visitor; empty/absent if nothing was
          captured this session. */}
      <input type="hidden" name="utm_source" value={attribution.utm_source ?? ""} />
      <input type="hidden" name="utm_medium" value={attribution.utm_medium ?? ""} />
      <input type="hidden" name="utm_campaign" value={attribution.utm_campaign ?? ""} />

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Your name" htmlFor="name">
          <input
            id="name"
            name="name"
            type="text"
            required
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
            className={inputClass}
          />
        </Field>
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

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Email" htmlFor="email">
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            className={inputClass}
          />
        </Field>
        <Field label="Phone" htmlFor="phone" optional>
          <input
            id="phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            className={inputClass}
          />
        </Field>
      </div>

      <Field label="Anything specific you'd like us to cover?" htmlFor="message" optional>
        <textarea id="message" name="message" rows={4} className={inputClass} />
      </Field>

      {state.status === "error" && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {state.message}
        </p>
      )}

      <MarketingButton type="submit" size="lg" disabled={pending} className="w-full sm:w-auto">
        {pending ? "Sending..." : "Book a Demo"}
      </MarketingButton>
    </form>
  );
}

const inputClass =
  "w-full rounded-md border border-marketing-navy-950/15 bg-white px-3 py-2 text-sm text-marketing-navy-950 shadow-sm placeholder:text-marketing-navy-900/40 focus:outline-none focus:ring-2 focus:ring-marketing-blue/40 focus:border-marketing-blue";

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
          <span className="ml-1 font-normal text-marketing-navy-900/40">(optional)</span>
        )}
      </label>
      {children}
    </div>
  );
}
