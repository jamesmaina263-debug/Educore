"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { updateBranding } from "@/app/settings/actions";
import { setActiveTerm } from "@/app/academics/actions";

export interface TermOption {
  id: string;
  name: string;
  status: "active" | "closed" | "upcoming";
  start_date: string;
  end_date: string;
}

export interface GeneralSettingsData {
  name: string;
  email: string;
  academic_year_id: string | null;
  academic_year_name: string | null;
  terms: TermOption[];
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2 sm:grid-cols-[13rem_minmax(0,26rem)] sm:items-start sm:gap-6">
      <div>
        <label className="text-[0.8125rem] font-medium">{label}</label>
        {hint && <p className="mt-0.5 text-[0.75rem] text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

const inputClass =
  "h-9 w-full rounded-md border border-input bg-background px-2.5 text-[0.875rem] placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60";

function formatDate(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

export function GeneralSettingsPanel({ initial, canWrite }: { initial: GeneralSettingsData; canWrite: boolean }) {
  const router = useRouter();
  const [name, setName] = useState(initial.name);
  const [email, setEmail] = useState(initial.email);
  const [termId, setTermId] = useState(initial.terms.find((t) => t.status === "active")?.id ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const selectedTerm = initial.terms.find((t) => t.id === termId) ?? null;
  const initialTermId = initial.terms.find((t) => t.status === "active")?.id ?? "";
  const dirty = name !== initial.name || email !== initial.email || termId !== initialTermId;

  function handleCancel() {
    setName(initial.name);
    setEmail(initial.email);
    setTermId(initialTermId);
    setError(null);
    setSaved(false);
  }

  async function handleSave() {
    setPending(true);
    setError(null);
    setSaved(false);

    if (name !== initial.name || email !== initial.email) {
      const result = await updateBranding({ name, email });
      if ("error" in result) {
        setPending(false);
        return setError(result.error);
      }
    }
    if (termId && termId !== initialTermId && initial.academic_year_id) {
      const result = await setActiveTerm(termId, initial.academic_year_id);
      if ("error" in result) {
        setPending(false);
        return setError(result.error);
      }
    }

    setPending(false);
    setSaved(true);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      {canWrite && dirty && (
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" onClick={handleCancel} disabled={pending}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={pending}>
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}
      {saved && !error && !dirty && <p className="text-sm text-success">Saved.</p>}

      <div className="panel max-w-4xl divide-y divide-border">
        <section className="space-y-5 p-5">
          <h2 className="text-[0.8125rem] font-semibold">School profile</h2>
          <Field label="School name" hint="Appears on invoices and report cards.">
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} disabled={!canWrite} />
          </Field>
          <Field label="Contact email" hint="Used as the reply-to on all outgoing messages.">
            <input
              type="email"
              className={inputClass}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={!canWrite}
            />
          </Field>
        </section>

        <section className="space-y-5 p-5">
          <h2 className="text-[0.8125rem] font-semibold">Academic year</h2>
          {initial.terms.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No terms set up yet.{" "}
              <Link href="/academics" className="underline">
                Set up the academic year in Academics
              </Link>
              .
            </p>
          ) : (
            <>
              <Field label="Current term" hint="Switching the active term freezes marks and fee postings on the previous one.">
                <select className={inputClass} value={termId} onChange={(e) => setTermId(e.target.value)} disabled={!canWrite}>
                  {initial.terms.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} {initial.academic_year_name ? `, ${initial.academic_year_name}` : ""}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Term ends">
                <p className="flex h-9 items-center text-[0.875rem]">{selectedTerm ? formatDate(selectedTerm.end_date) : "—"}</p>
              </Field>
              <p className="text-[0.75rem] text-muted-foreground">
                <Link href="/academics" className="underline">
                  Manage academic years, terms and rollover
                </Link>
              </p>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
