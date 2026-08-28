"use client";

import { useActionState } from "react";
import { CheckCircle2 } from "lucide-react";

import { submitDemoRequest, type DemoRequestState } from "@/app/(marketing)/contact/actions";
import { MarketingButton } from "@/components/marketing/button";

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

  if (state.status === "success") {
    return (
      <div className="flex flex-col items-center rounded-xl border border-marketing-navy-950/10 bg-marketing-canvas px-8 py-12 text-center">
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
    <form action={formAction} className="flex flex-col gap-5">
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
          <select id="role" name="role" required defaultValue="" className={inputClass}>
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
        <p className="text-sm font-medium text-destructive">{state.message}</p>
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
