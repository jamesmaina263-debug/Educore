"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/status-badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { createReviewAction } from "@/app/performance/actions";

export interface ReviewRow {
  id: string;
  teacher_id: string;
  reviewer_name: string;
  review_type: "termly" | "annual";
  period_label: string;
  competency_scores: Record<string, number>;
  overall_rating: number | null;
  notes: string | null;
  created_at: string;
}

export interface StaffOption {
  id: string;
  full_name: string;
}

const DEFAULT_COMPETENCIES = ["Classroom management", "Subject knowledge", "Punctuality", "Collaboration"];

export function PerformanceSection({
  reviews,
  staffOptions,
  academicYearId,
  terms,
  canReview,
  selfViewOnly,
}: {
  reviews: ReviewRow[];
  staffOptions: StaffOption[];
  academicYearId: string;
  terms: { id: string; name: string }[];
  canReview: boolean;
  selfViewOnly: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [teacherId, setTeacherId] = useState("");
  const [reviewType, setReviewType] = useState<"termly" | "annual">("termly");
  const [termId, setTermId] = useState(terms[0]?.id ?? "");
  const [scores, setScores] = useState<Record<string, string>>(Object.fromEntries(DEFAULT_COMPETENCIES.map((c) => [c, ""])));
  const [notes, setNotes] = useState("");

  async function handleCreate() {
    setPending(true);
    setError(null);
    const competency_scores = Object.fromEntries(
      Object.entries(scores).filter(([, v]) => v !== "").map(([k, v]) => [k, Number(v)]),
    );
    const result = await createReviewAction({
      teacher_id: teacherId,
      academic_year_id: academicYearId,
      term_id: reviewType === "termly" ? termId : null,
      review_type: reviewType,
      competency_scores,
      notes,
    });
    setPending(false);
    if ("error" in result) return setError(result.error);
    setOpen(false);
    setTeacherId("");
    setNotes("");
    setScores(Object.fromEntries(DEFAULT_COMPETENCIES.map((c) => [c, ""])));
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="panel">
        <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <div className="flex items-center gap-3">
            <h2 className="text-[0.8125rem] font-semibold">Reviews</h2>
            <span className="text-[0.6875rem] text-muted-foreground">
              {reviews.length} review{reviews.length === 1 ? "" : "s"}
            </span>
          </div>
          {canReview && (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline">
                  New review
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>New performance review</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label>Staff member</Label>
                    <Select value={teacherId} onValueChange={setTeacherId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select staff member" />
                      </SelectTrigger>
                      <SelectContent>
                        {staffOptions.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.full_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>Type</Label>
                      <Select value={reviewType} onValueChange={(v) => setReviewType(v as "termly" | "annual")}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="termly">Termly</SelectItem>
                          <SelectItem value="annual">Annual</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {reviewType === "termly" && (
                      <div className="space-y-1.5">
                        <Label>Term</Label>
                        <Select value={termId} onValueChange={setTermId}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {terms.map((t) => (
                              <SelectItem key={t.id} value={t.id}>
                                {t.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label>Competency scores (1–5)</Label>
                    {Object.keys(scores).map((c) => (
                      <div key={c} className="grid grid-cols-[2fr_1fr] items-center gap-2">
                        <span className="text-sm">{c}</span>
                        <Input
                          type="number"
                          min={1}
                          max={5}
                          value={scores[c]}
                          onChange={(e) => setScores((p) => ({ ...p, [c]: e.target.value }))}
                        />
                      </div>
                    ))}
                  </div>

                  <div className="space-y-1.5">
                    <Label>Notes</Label>
                    <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
                  </div>
                  {error && <p className="text-sm text-danger">{error}</p>}
                </div>
                <DialogFooter>
                  <Button onClick={handleCreate} disabled={pending || !teacherId || (reviewType === "termly" && !termId)}>
                    {pending ? "Saving…" : "Save review"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </header>

        {reviews.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">
            {selfViewOnly ? "No performance reviews yet." : "No reviews recorded yet."}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {reviews.map((r) => (
              <li key={r.id} className="p-4">
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <StatusBadge tone="neutral" label={r.review_type} />
                    <span className="text-[0.8125rem] text-muted-foreground">{r.period_label}</span>
                  </div>
                  {r.overall_rating !== null && <p className="text-[0.8125rem] font-medium">Overall: {r.overall_rating}/5</p>}
                </div>
                <div className="mb-2 flex flex-wrap gap-2 text-[0.8125rem] text-muted-foreground">
                  {Object.entries(r.competency_scores).map(([k, v]) => (
                    <span key={k}>
                      {k}: {v}
                    </span>
                  ))}
                </div>
                {r.notes && <p className="text-[0.8125rem]">{r.notes}</p>}
                <p className="mt-2 text-[0.6875rem] text-muted-foreground">
                  Reviewed by {r.reviewer_name} on {new Date(r.created_at).toLocaleDateString()}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
