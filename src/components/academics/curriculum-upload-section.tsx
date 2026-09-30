"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { StatusBadge } from "@/components/status-badge";
import { uploadCurriculumDocument, deleteCurriculumSubStrand } from "@/app/(app)/academics/curriculum/actions";
import { updateCurriculumSubStrandContent } from "@/app/(app)/exams/actions";

export interface SubjectOption {
  id: string;
  name: string;
}

export interface DraftSubStrand {
  id: string;
  name: string;
  learningOutcomes: string | null;
  keyInquiryQuestions: string | null;
  rubricText: string | null;
  contentSource: "school_authored" | "kicd_licensed" | "draft";
}

export interface BatchStrand {
  id: string;
  name: string;
  subStrands: DraftSubStrand[];
}

export interface BatchWithDrafts {
  id: string;
  fileName: string;
  status: "processing" | "extracted" | "failed";
  failureCategory: string | null;
  strandsExtracted: number | null;
  subStrandsExtracted: number | null;
  createdAt: string;
  strands: BatchStrand[];
}

interface Props {
  subjectOptions: SubjectOption[];
  selectedSubjectId: string | null;
  batches: BatchWithDrafts[];
  canUpload: boolean;
  canReview: boolean;
}

const FAILURE_MESSAGES: Record<string, string> = {
  no_text_layer: "No readable text was found in this PDF (it may be a scan). Try a different file, or record content manually.",
  pdf_parse_error: "This PDF couldn't be read. It may be corrupted or password-protected.",
  timeout: "Extraction timed out. Try again.",
  network: "A connection problem interrupted extraction. Try again.",
  rate_limit: "AI extraction was temporarily busy. Try again shortly.",
  no_structure_found: "No usable curriculum structure was found in this document.",
};

export function CurriculumUploadSection({ subjectOptions, selectedSubjectId, batches, canUpload, canReview }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleSubjectChange(subjectId: string) {
    router.push(`/academics/curriculum?subject=${subjectId}`);
  }

  function handleUpload() {
    if (!selectedSubjectId) return;
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setUploadError("Please choose a PDF file first.");
      return;
    }
    setUploadError(null);
    setUploadNotice(null);
    const formData = new FormData();
    formData.set("file", file);
    startTransition(async () => {
      const result = await uploadCurriculumDocument(selectedSubjectId, formData);
      if ("error" in result) {
        setUploadError(result.error);
        return;
      }
      setUploadNotice(
        `Extracted ${result.subStrandsExtracted} sub-strand(s) across ${result.strandsExtracted} strand(s) as drafts, ready for review.` +
          (result.lowConfidenceCount > 0 ? ` ${result.lowConfidenceCount} flagged as low-confidence — check those closely.` : "") +
          (result.documentTruncated ? " Note: the document was long and only the first portion was used." : ""),
      );
      if (fileInputRef.current) fileInputRef.current.value = "";
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="panel flex flex-wrap items-center gap-2 p-4">
        <Select value={selectedSubjectId ?? undefined} onValueChange={handleSubjectChange}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder="Select a subject" />
          </SelectTrigger>
          <SelectContent>
            {subjectOptions.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {canUpload && selectedSubjectId && (
          <div className="flex flex-wrap items-center gap-2">
            <input ref={fileInputRef} type="file" accept="application/pdf" className="text-sm" />
            <Button onClick={handleUpload} disabled={pending}>
              {pending ? "Extracting…" : "Upload & Extract"}
            </Button>
          </div>
        )}
      </div>

      {uploadError && <p className="panel border-destructive/40 p-3 text-sm text-destructive">{uploadError}</p>}
      {uploadNotice && <p className="panel border-primary/30 p-3 text-sm">{uploadNotice}</p>}

      {!selectedSubjectId ? (
        <p className="panel border-dashed p-10 text-center text-sm text-muted-foreground">Select a subject to see or upload curriculum content.</p>
      ) : batches.length === 0 ? (
        <p className="panel border-dashed p-10 text-center text-sm text-muted-foreground">
          No curriculum document uploaded for this subject yet.
        </p>
      ) : (
        batches.map((batch) => <BatchCard key={batch.id} batch={batch} canReview={canReview} />)
      )}
    </div>
  );
}

function BatchCard({ batch, canReview }: { batch: BatchWithDrafts; canReview: boolean }) {
  const pendingReviewCount = batch.strands.reduce(
    (sum, s) => sum + s.subStrands.filter((ss) => ss.contentSource === "draft").length,
    0,
  );

  return (
    <div className="panel flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">{batch.fileName}</p>
          <p className="text-xs text-muted-foreground">{new Date(batch.createdAt).toLocaleString()}</p>
        </div>
        <div className="flex items-center gap-2">
          {batch.status === "extracted" && pendingReviewCount > 0 && (
            <StatusBadge tone="warning" label={`${pendingReviewCount} pending review`} />
          )}
          {batch.status === "extracted" && pendingReviewCount === 0 && <StatusBadge tone="success" label="Reviewed" />}
          {batch.status === "processing" && <StatusBadge tone="info" label="Processing" />}
          {batch.status === "failed" && (
            <StatusBadge tone="neutral" label={(batch.failureCategory && FAILURE_MESSAGES[batch.failureCategory]) || "Failed"} />
          )}
        </div>
      </div>

      {batch.strands.map((strand) => (
        <div key={strand.id} className="flex flex-col gap-2 rounded border p-3">
          <p className="text-sm font-semibold">{strand.name}</p>
          {strand.subStrands.map((sub) => (
            <SubStrandRow key={sub.id} subStrand={sub} canReview={canReview} />
          ))}
        </div>
      ))}
    </div>
  );
}

function SubStrandRow({ subStrand, canReview }: { subStrand: DraftSubStrand; canReview: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState(subStrand.learningOutcomes ?? "");
  const [questions, setQuestions] = useState(subStrand.keyInquiryQuestions ?? "");
  const [rubric, setRubric] = useState(subStrand.rubricText ?? "");

  function save(nextContentSource: "draft" | "school_authored") {
    setError(null);
    startTransition(async () => {
      const result = await updateCurriculumSubStrandContent({
        sub_strand_id: subStrand.id,
        learning_outcomes: outcomes || null,
        key_inquiry_questions: questions || null,
        rubric_text: rubric || null,
        content_source: nextContentSource,
      });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  function reject() {
    setError(null);
    startTransition(async () => {
      const result = await deleteCurriculumSubStrand(subStrand.id);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-1.5 rounded border border-dashed p-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">{subStrand.name}</p>
        <StatusBadge
          tone={subStrand.contentSource === "school_authored" ? "success" : "warning"}
          label={subStrand.contentSource === "draft" ? "Draft — needs review" : "Approved"}
        />
      </div>

      {editing ? (
        <div className="flex flex-col gap-1.5">
          <Textarea value={outcomes} onChange={(e) => setOutcomes(e.target.value)} placeholder="Learning outcomes" rows={2} />
          <Textarea value={questions} onChange={(e) => setQuestions(e.target.value)} placeholder="Key inquiry questions" rows={2} />
          <Textarea value={rubric} onChange={(e) => setRubric(e.target.value)} placeholder="Assessment guidance" rows={2} />
        </div>
      ) : (
        <div className="text-xs text-muted-foreground">
          {subStrand.learningOutcomes && <p>Outcomes: {subStrand.learningOutcomes}</p>}
          {subStrand.keyInquiryQuestions && <p>Questions: {subStrand.keyInquiryQuestions}</p>}
          {subStrand.rubricText && <p>Assessment: {subStrand.rubricText}</p>}
        </div>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}

      {canReview && (
        <div className="flex flex-wrap gap-2">
          {editing ? (
            <>
              <Button size="sm" variant="outline" onClick={() => setEditing(false)} disabled={pending}>
                Cancel
              </Button>
              <Button size="sm" onClick={() => save(subStrand.contentSource === "school_authored" ? "school_authored" : "draft")} disabled={pending}>
                Save edits
              </Button>
            </>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setEditing(true)} disabled={pending}>
              Edit
            </Button>
          )}
          {subStrand.contentSource === "draft" && (
            <>
              <Button size="sm" onClick={() => save("school_authored")} disabled={pending}>
                Approve
              </Button>
              <Button size="sm" variant="destructive" onClick={reject} disabled={pending}>
                Reject
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
