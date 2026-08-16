"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { rolloverAcademicYear } from "@/app/(app)/academics/actions";
import type { AcademicYearRow } from "./years-terms-section";

export type StudentOption = {
  id: string;
  admission_number: string;
  first_name: string;
  last_name: string;
};

export function RolloverSection({
  years,
  students,
}: {
  years: AcademicYearRow[];
  students: StudentOption[];
}) {
  const [fromYear, setFromYear] = useState<string>("");
  const [toYear, setToYear] = useState<string>("");
  const [repeaters, setRepeaters] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ promoted: number; repeated: number; graduated: number } | null>(null);
  const [confirming, setConfirming] = useState(false);

  const toggleRepeater = (id: string) => {
    setRepeaters((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const runRollover = () => {
    setError(null);
    setResult(null);
    startTransition(async () => {
      const res = await rolloverAcademicYear({
        from_academic_year_id: fromYear,
        to_academic_year_id: toYear,
        repeat_student_ids: Array.from(repeaters),
      });
      setConfirming(false);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setResult({ promoted: res.promoted, repeated: res.repeated, graduated: res.graduated });
    });
  };

  const ready = fromYear && toYear && fromYear !== toYear;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Bulk-promotes every active student from one academic year to the next, matching same-named
        streams. Mark individual students as repeating below — everyone else is promoted one level,
        and students at the school&apos;s highest class level are marked graduated.
      </p>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>From academic year</Label>
          <Select value={fromYear} onValueChange={setFromYear}>
            <SelectTrigger>
              <SelectValue placeholder="Select year" />
            </SelectTrigger>
            <SelectContent>
              {years.map((y) => (
                <SelectItem key={y.id} value={y.id}>
                  {y.name} ({y.status})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>To academic year</Label>
          <Select value={toYear} onValueChange={setToYear}>
            <SelectTrigger>
              <SelectValue placeholder="Select year" />
            </SelectTrigger>
            <SelectContent>
              {years.map((y) => (
                <SelectItem key={y.id} value={y.id}>
                  {y.name} ({y.status})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <p className="mb-2 text-sm font-medium">Repeating students (optional)</p>
        <div className="panel max-h-64 overflow-y-auto">
          {students.length === 0 && (
            <p className="p-3 text-sm text-muted-foreground">No active students.</p>
          )}
          {students.map((s) => (
            <label
              key={s.id}
              className="flex items-center gap-2 border-b border-border p-2 text-sm last:border-b-0"
            >
              <Checkbox
                checked={repeaters.has(s.id)}
                onCheckedChange={() => toggleRepeater(s.id)}
              />
              {s.first_name} {s.last_name} ({s.admission_number})
            </label>
          ))}
        </div>
      </div>

      {!confirming ? (
        <Button disabled={!ready} onClick={() => setConfirming(true)} className="w-fit">
          Run rollover
        </Button>
      ) : (
        <div className="flex items-center gap-2">
          <p className="text-sm text-muted-foreground">
            This will move every active student and cannot be easily undone. Continue?
          </p>
          <Button disabled={pending} onClick={runRollover}>
            {pending ? "Running…" : "Yes, run rollover"}
          </Button>
          <Button variant="ghost" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {result && (
        <p className="text-sm text-success">
          Done — {result.promoted} promoted, {result.repeated} repeated, {result.graduated} graduated.
        </p>
      )}
    </div>
  );
}
