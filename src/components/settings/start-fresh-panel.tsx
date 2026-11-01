"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, CheckCircle2, Eraser } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  resetTrialSchoolData,
  type TrialResetPreviewOutcome,
  type TrialResetSummary,
} from "@/app/(app)/settings/trial-reset-actions";
import {
  ALWAYS_KEPT,
  RESET_GROUPS,
  removeWithDependents,
  withDependencies,
  type ResetGroupKey,
} from "@/lib/settings/trial-reset-groups";

const LABEL = Object.fromEntries(RESET_GROUPS.map((g) => [g.key, g.label])) as Record<ResetGroupKey, string>;

// Everything except the school's set-up. "Select all test data" keeps classes, terms, subjects and fee structures.
const ALL_TEST_DATA: ResetGroupKey[] = ["fees", "academics", "applications", "other", "students"];

export function StartFreshPanel({ preview }: { preview: TrialResetPreviewOutcome }) {
  const [selected, setSelected] = useState<ResetGroupKey[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [step, setStep] = useState<"choose" | "confirm" | "done">("choose");
  const [confirmName, setConfirmName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<TrialResetSummary | null>(null);
  const [pending, startTransition] = useTransition();

  if (!preview.eligible) {
    return (
      <div className="panel border-dashed p-10 text-center text-sm text-muted-foreground">{preview.reason}</div>
    );
  }

  const { schoolName, counts } = preview;
  const totalSelected = selected.reduce((sum, k) => sum + counts[k], 0);

  const toggle = (key: ResetGroupKey, checked: boolean) => {
    setError(null);
    if (checked) {
      const { groups, added } = withDependencies([...selected, key]);
      setSelected(groups);
      setNotice(
        added.length > 0
          ? `Also selected because "${LABEL[key]}" needs them removed too: ${added.map((a) => LABEL[a]).join(", ")}.`
          : null,
      );
    } else {
      const next = removeWithDependents(selected, key);
      const dropped = selected.filter((k) => k !== key && !next.includes(k));
      setSelected(next);
      setNotice(
        dropped.length > 0
          ? `Also unticked because they need "${LABEL[key]}" removed first: ${dropped.map((d) => LABEL[d]).join(", ")}.`
          : null,
      );
    }
  };

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const result = await resetTrialSchoolData({ groups: selected, confirmName, password });
      if ("error" in result) {
        setError(result.error);
        setPassword("");
        return;
      }
      setSummary(result.summary);
      setPassword("");
      setStep("done");
    });
  };

  if (step === "done" && summary) {
    return (
      <div className="panel flex flex-col gap-4 p-6" role="status">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 size-5 text-emerald-600" aria-hidden />
          <div>
            <h2 className="font-medium">Your data has been removed</h2>
            <p className="text-sm text-muted-foreground">
              {summary.rowsRemoved} records were removed. Your school, staff, subscription and settings are unchanged.
            </p>
          </div>
        </div>
        <ul className="list-disc space-y-1 pl-9 text-sm">
          {(Object.entries(summary.byGroup) as [ResetGroupKey, number][]).map(([k, n]) => (
            <li key={k}>
              {LABEL[k]}: {n} removed
            </li>
          ))}
          {summary.filesRemoved > 0 && <li>{summary.filesRemoved} uploaded files removed</li>}
          {summary.loginsRemoved > 0 && <li>{summary.loginsRemoved} parent logins removed</li>}
        </ul>
        {summary.parentsKept > 0 && (
          <p className="pl-9 text-sm text-muted-foreground">
            {summary.parentsKept} parent record{summary.parentsKept === 1 ? " was" : "s were"} kept because other
            records still refer to them.
          </p>
        )}
        {summary.warnings.length > 0 && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-medium">Some clean-up needs attention</p>
            <ul className="mt-1 list-disc pl-5">
              {summary.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
            <p className="mt-1">Please contact support so we can finish this for you.</p>
          </div>
        )}
        <div>
          <Button
            variant="outline"
            onClick={() => {
              setSelected([]);
              setSummary(null);
              setConfirmName("");
              setStep("choose");
              // Counts on the page are now out of date; a refresh loads fresh ones.
              window.location.reload();
            }}
          >
            Done
          </Button>
        </div>
      </div>
    );
  }

  if (step === "confirm") {
    return (
      <div className="panel flex flex-col gap-4 p-6">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 size-5 text-destructive" aria-hidden />
          <div>
            <h2 className="font-medium">Confirm: this cannot be undone</h2>
            <p className="text-sm text-muted-foreground">
              These records will be permanently removed ({totalSelected} in total). We cannot bring them back.
            </p>
          </div>
        </div>
        <ul className="list-disc space-y-1 pl-9 text-sm">
          {selected.map((k) => (
            <li key={k}>
              {LABEL[k]} — {counts[k]} record{counts[k] === 1 ? "" : "s"}
            </li>
          ))}
        </ul>
        <div className="rounded-md bg-muted p-3 text-sm">
          <p className="font-medium">These stay exactly as they are</p>
          <ul className="mt-1 list-disc pl-5 text-muted-foreground">
            {ALWAYS_KEPT.map((k) => (
              <li key={k}>{k}</li>
            ))}
          </ul>
        </div>
        <div className="grid gap-3 sm:max-w-md">
          <div className="grid gap-1.5">
            <Label htmlFor="start-fresh-name">
              Type your school&apos;s name to confirm: <span className="font-semibold">{schoolName}</span>
            </Label>
            <Input
              id="start-fresh-name"
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              autoComplete="off"
              disabled={pending}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="start-fresh-password">Your password</Label>
            <Input
              id="start-fresh-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              disabled={pending}
            />
          </div>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setStep("choose")} disabled={pending}>
            Back
          </Button>
          <Button
            variant="destructive"
            onClick={submit}
            disabled={pending || confirmName.trim() !== schoolName || password.length === 0}
          >
            {pending ? "Removing…" : "Permanently remove selected data"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="panel flex flex-col gap-4 p-6">
        <div className="flex items-start gap-3">
          <Eraser className="mt-0.5 size-5 text-muted-foreground" aria-hidden />
          <div>
            <h2 className="font-medium">Start fresh</h2>
            <p className="text-sm text-muted-foreground">
              While you are on your free trial you can remove the test data you entered, then start again with your real
              records. Tick what you want removed. Your school, staff accounts, subscription and settings always stay.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => { setSelected(ALL_TEST_DATA); setNotice(null); }}>
            Select all test data
          </Button>
          <Button variant="ghost" size="sm" onClick={() => { setSelected([]); setNotice(null); }} disabled={selected.length === 0}>
            Clear selection
          </Button>
        </div>

        <ul className="divide-y rounded-md border">
          {RESET_GROUPS.map((g) => {
            const checked = selected.includes(g.key);
            return (
              <li key={g.key} className="flex items-start gap-3 p-3">
                <Checkbox
                  id={`reset-${g.key}`}
                  checked={checked}
                  onCheckedChange={(v) => toggle(g.key, v === true)}
                  className="mt-1"
                />
                <Label htmlFor={`reset-${g.key}`} className="flex flex-1 cursor-pointer flex-col gap-0.5 font-normal">
                  <span className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium">{g.label}</span>
                    <span className="text-xs text-muted-foreground">
                      {counts[g.key]} record{counts[g.key] === 1 ? "" : "s"}
                    </span>
                  </span>
                  <span className="text-sm text-muted-foreground">{g.description}</span>
                </Label>
              </li>
            );
          })}
        </ul>

        {notice && (
          <p role="status" className="text-sm text-muted-foreground">
            {notice}
          </p>
        )}

        <div>
          <Button onClick={() => { setError(null); setStep("confirm"); }} disabled={selected.length === 0}>
            Continue
          </Button>
        </div>
      </div>
    </div>
  );
}
