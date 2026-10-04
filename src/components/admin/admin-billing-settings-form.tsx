"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PAYMENT_INSTRUCTION_FIELDS, formatKes } from "@/lib/billing/format";
import { saveBillingSettingsAction, updatePlanPriceAction } from "@/app/(admin)/admin/billing/invoices/actions";

export type BillingSettings = {
  invoice_prefix: string;
  payment_terms_days: number;
  auto_generate_enabled: boolean;
  auto_effective_from: string | null;
  auto_lookback_days: number;
  auto_issue: boolean;
  auto_send: boolean;
  billable_student_statuses: string[];
  tax_enabled: boolean;
  tax_label: string;
  tax_rate_percent: number;
  payment_instructions: Record<string, string>;
  invoice_footer_note: string;
};
export type PlanRow = { id: string; code: string; name: string; price_per_student_kes: number; billing_period: string | null };

const STUDENT_STATUSES: { key: string; label: string; hint: string }[] = [
  { key: "active", label: "Active", hint: "Currently enrolled and attending (the default)" },
  { key: "enrolled", label: "Enrolled", hint: "Admitted but not yet marked active" },
  { key: "approved", label: "Approved", hint: "Application approved, not yet enrolled" },
  { key: "withdrawn", label: "Withdrawn", hint: "Left the school" },
  { key: "transferred", label: "Transferred", hint: "Moved to another school" },
  { key: "graduated", label: "Graduated", hint: "Completed their studies" },
];

export function AdminBillingSettingsForm({ settings, plans }: { settings: BillingSettings; plans: PlanRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [autoEnabled, setAutoEnabled] = useState(settings.auto_generate_enabled);
  const [effectiveFrom, setEffectiveFrom] = useState(settings.auto_effective_from ?? "");
  const [lookback, setLookback] = useState(String(settings.auto_lookback_days));
  const [autoIssue, setAutoIssue] = useState(settings.auto_issue);
  const [autoSend, setAutoSend] = useState(settings.auto_send);
  const [prefix, setPrefix] = useState(settings.invoice_prefix);
  const [terms, setTerms] = useState(String(settings.payment_terms_days));
  const [statuses, setStatuses] = useState<string[]>(settings.billable_student_statuses);
  const [taxEnabled, setTaxEnabled] = useState(settings.tax_enabled);
  const [taxLabel, setTaxLabel] = useState(settings.tax_label);
  const [taxRate, setTaxRate] = useState(String(settings.tax_rate_percent));
  const [pi, setPi] = useState<Record<string, string>>(settings.payment_instructions ?? {});
  const [footer, setFooter] = useState(settings.invoice_footer_note);

  const toggleStatus = (k: string) => setStatuses((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));

  function save() {
    setError(null);
    setSaved(false);
    if (statuses.length === 0) return setError("Choose at least one student status to bill.");
    if (autoEnabled && !effectiveFrom) return setError("Choose the date automatic billing starts from.");
    startTransition(async () => {
      const res = await saveBillingSettingsAction({
        invoice_prefix: prefix.trim().toUpperCase(),
        payment_terms_days: Number(terms),
        auto_generate_enabled: autoEnabled,
        auto_effective_from: effectiveFrom || null,
        auto_lookback_days: Number(lookback),
        auto_issue: autoIssue,
        auto_send: autoIssue && autoSend,
        billable_student_statuses: statuses,
        tax_enabled: taxEnabled,
        tax_label: taxLabel,
        tax_rate_percent: Number(taxRate),
        invoice_footer_note: footer,
        payment_instructions: pi,
      });
      if ("error" in res) return setError(res.error);
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <Section title="Rates" subtitle="Price per student for each plan. A change applies to invoices created from now on; existing invoices keep the rate recorded on them. A single school can have a custom price or discount on its invoice page.">
        <PlanRates plans={plans} />
      </Section>

      <Section title="Automatic billing" subtitle="Invoices each paying school once, when its term ends (by the term's end date). Off until you turn it on.">
        <Check checked={autoEnabled} onChange={setAutoEnabled} label="Generate invoices automatically at the end of each term" />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Automatic billing starts from" hint="Only terms ending on or after this date are ever billed — this is what stops history being back-billed.">
            <Input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
          </Field>
          <Field label="Look-back window (days)" hint="A term that ended more than this many days ago is left for you to invoice by hand.">
            <Input inputMode="numeric" value={lookback} onChange={(e) => setLookback(e.target.value)} />
          </Field>
        </div>
        <Check
          checked={autoIssue}
          onChange={(v) => {
            setAutoIssue(v);
            if (!v) setAutoSend(false);
          }}
          label="Issue automatically (otherwise invoices are created as drafts for review)"
          hint="Issued invoices are visible to the school and become overdue after the payment terms — and the existing policy then suspends a school 7 days after an invoice is overdue. Leave off until you trust the preview."
        />
        <Check checked={autoSend} disabled={!autoIssue} onChange={setAutoSend} label="Email each invoice to the school automatically when it is issued" hint="Needs email delivery (Resend) configured; an unsent invoice is retried daily for a week." />
      </Section>

      <Section title="Numbering and payment terms">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Invoice number prefix" hint={`Numbers look like ${prefix || "EDC-INV"}-${new Date().getFullYear()}-0001. Capital letters, digits and hyphens.`}>
            <Input value={prefix} onChange={(e) => setPrefix(e.target.value.toUpperCase())} maxLength={21} />
          </Field>
          <Field label="Payment terms (days)" hint="Due date = invoice date + this many days.">
            <Input inputMode="numeric" value={terms} onChange={(e) => setTerms(e.target.value)} />
          </Field>
        </div>
      </Section>

      <Section title="Who counts as a billable student" subtitle="Students in these statuses are counted when an invoice is created. The count is recorded on the invoice.">
        <div className="grid gap-2 sm:grid-cols-2">
          {STUDENT_STATUSES.map((s) => (
            <Check key={s.key} checked={statuses.includes(s.key)} onChange={() => toggleStatus(s.key)} label={s.label} hint={s.hint} />
          ))}
        </div>
      </Section>

      <Section title="Tax" subtitle="Off by default. When on, tax is added to the subtotal (after any discount) on new invoices.">
        <Check checked={taxEnabled} onChange={setTaxEnabled} label="Charge tax on invoices" />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Tax name">
            <Input value={taxLabel} onChange={(e) => setTaxLabel(e.target.value)} maxLength={20} />
          </Field>
          <Field label="Rate (%)">
            <Input inputMode="decimal" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} />
          </Field>
        </div>
      </Section>

      <Section title="Payment instructions" subtitle="Printed on every unpaid invoice. Nothing is pre-filled — enter your real details. Only filled-in fields appear.">
        <div className="grid gap-3 sm:grid-cols-2">
          {PAYMENT_INSTRUCTION_FIELDS.filter((f) => !f.long).map((f) => (
            <Field key={f.key} label={f.label}>
              <Input value={pi[f.key] ?? ""} onChange={(e) => setPi((v) => ({ ...v, [f.key]: e.target.value }))} maxLength={200} />
            </Field>
          ))}
        </div>
        <Field label="Other instructions">
          <Textarea rows={3} value={pi.other_instructions ?? ""} onChange={(e) => setPi((v) => ({ ...v, other_instructions: e.target.value }))} maxLength={1000} />
        </Field>
        <Field label="Closing line on the invoice">
          <Input value={footer} onChange={(e) => setFooter(e.target.value)} maxLength={300} />
        </Field>
      </Section>

      <div className="sticky bottom-0 -mx-1 flex items-center gap-3 border-t border-border bg-background/95 px-1 py-3 backdrop-blur">
        <Button onClick={save} disabled={pending}>
          {pending ? "Saving…" : "Save settings"}
        </Button>
        {saved && <span className="text-sm text-success">Saved.</span>}
        {error && (
          <span role="alert" className="text-sm text-danger">
            {error}
          </span>
        )}
      </div>
    </div>
  );
}

function PlanRates({ plans }: { plans: PlanRow[] }) {
  return (
    <div className="flex flex-col gap-2">
      {plans.map((p) => (
        <PlanRateRow key={p.id} plan={p} />
      ))}
    </div>
  );
}

function PlanRateRow({ plan }: { plan: PlanRow }) {
  const router = useRouter();
  const [price, setPrice] = useState(String(plan.price_per_student_kes));
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const changed = Number(price) !== plan.price_per_student_kes;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="w-44">
        <p className="text-sm font-medium">{plan.name}</p>
        <p className="text-xs text-muted-foreground">
          {plan.billing_period ?? "termly"} · currently {formatKes(plan.price_per_student_kes)} / student
        </p>
      </div>
      <Input className="w-32" inputMode="decimal" aria-label={`${plan.name} price per student`} value={price} onChange={(e) => setPrice(e.target.value)} />
      <Button
        size="sm"
        variant="outline"
        disabled={pending || !changed || !(Number(price) >= 0)}
        onClick={() => {
          setMsg(null);
          startTransition(async () => {
            const res = await updatePlanPriceAction(plan.id, Number(price));
            if ("error" in res) setMsg({ ok: false, text: res.error });
            else {
              setMsg({ ok: true, text: "Rate updated." });
              router.refresh();
            }
          });
        }}
      >
        Update rate
      </Button>
      {msg && <span className={`text-sm ${msg.ok ? "text-success" : "text-danger"}`}>{msg.text}</span>}
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="panel">
      <header className="border-b border-border px-4 py-2.5">
        <h2 className="text-[0.8125rem] font-semibold">{title}</h2>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      </header>
      <div className="flex flex-col gap-3 p-4">{children}</div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Check({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <label className={`flex items-start gap-2 text-sm ${disabled ? "opacity-50" : ""}`}>
      <input type="checkbox" className="mt-0.5" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>
        {label}
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}
