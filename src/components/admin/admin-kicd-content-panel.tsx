"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { KICD_GRADES } from "@/lib/kicd-grade";
import { catalogueOptionLabel } from "@/lib/subject-catalogue-label";
import {
  importKicdDocument,
  setKicdSourceEnabled,
  updateKicdSubStrand,
  deleteKicdSubStrand,
  deleteKicdSource,
  setKicdLearningAreaCatalogue,
} from "@/app/(admin)/admin/kicd-content/actions";

export type KicdSubStrandRow = {
  id: string;
  name: string;
  learning_outcomes: string | null;
  key_inquiry_questions: string | null;
  rubric_text: string | null;
};
export type KicdStrandRow = {
  id: string;
  name: string;
  grade: string;
  kicd_learning_areas: { name: string } | null;
  kicd_sub_strands: KicdSubStrandRow[];
};
export type KicdSourceRow = {
  id: string;
  name: string;
  licence_reference: string;
  licence_scope: string | null;
  attribution: string;
  source_document: string | null;
  is_enabled: boolean;
  created_at: string;
  schools?: { name: string } | null;
  kicd_strands: KicdStrandRow[];
};

export type KicdLearningAreaRow = { id: string; name: string; catalogue_id: string | null };
export type CatalogueOption = { id: string; name: string; grade_band?: string | null };
export type SubjectOption = { id: string; label: string };

type Result = { error: string } | { success: true };

// Two uses. Platform admin console: pass learningAreas + catalogue (free-text
// learning area on import, plus the area -> catalogue link editor). School
// management page: pass `subjects` (the school's own subjects) instead -- the
// import is attached to one of them, and the link editor is not shown.
export function AdminKicdContentPanel({
  sources,
  learningAreas = [],
  catalogue = [],
  subjects,
}: {
  sources: KicdSourceRow[];
  learningAreas?: KicdLearningAreaRow[];
  catalogue?: CatalogueOption[];
  subjects?: SubjectOption[];
}) {
  const schoolMode = subjects !== undefined;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [grade, setGrade] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({ source_name: "", licence_reference: "", licence_scope: "", attribution: "", learning_area: "" });

  function run(fn: () => Promise<Result>) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const r = await fn();
      if ("error" in r) setError(r.error);
      else router.refresh();
    });
  }

  function handleImport() {
    const file = fileRef.current?.files?.[0];
    if (!file) return setError("Choose a PDF first.");
    const fd = new FormData();
    Object.entries(form).forEach(([k, v]) => fd.set(k, v));
    fd.set("grade", grade);
    if (schoolMode) fd.set("subject_id", subjectId);
    fd.set("file", file);
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const r = await importKicdDocument(fd);
      if ("error" in r) return setError(r.error);
      setNotice(
        `Imported ${r.subStrands} sub-strand(s) in ${r.strands} strand(s) as an unpublished draft. Review below, then publish.` +
          (r.truncated ? " The document was long; only the first portion was used." : ""),
      );
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    });
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="flex flex-col gap-4">
      <div className="panel flex flex-col gap-3 p-4">
        <p className="text-sm font-medium">{schoolMode ? "Import a curriculum document" : "Import a KICD document"}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Import name</Label>
            <Input value={form.source_name} onChange={set("source_name")} placeholder="e.g. Grade 6 Mathematics design" />
          </div>
          <div className="space-y-1.5">
            <Label>Licence reference (required)</Label>
            <Input value={form.licence_reference} onChange={set("licence_reference")} />
          </div>
          <div className="space-y-1.5">
            <Label>Attribution line (required)</Label>
            <Input value={form.attribution} onChange={set("attribution")} />
          </div>
          <div className="space-y-1.5">
            <Label>Licence scope (optional)</Label>
            <Input value={form.licence_scope} onChange={set("licence_scope")} placeholder="Grades / learning areas covered" />
          </div>
          {schoolMode ? (
            <div className="space-y-1.5">
              <Label>Subject</Label>
              <Select value={subjectId || undefined} onValueChange={setSubjectId}>
                <SelectTrigger aria-label="Subject this document covers">
                  <SelectValue placeholder="Choose a subject" />
                </SelectTrigger>
                <SelectContent>
                  {(subjects ?? []).map((sub) => (
                    <SelectItem key={sub.id} value={sub.id}>
                      {sub.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label>Learning area</Label>
              <Input value={form.learning_area} onChange={set("learning_area")} placeholder="e.g. Mathematics" />
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Grade</Label>
            <Select value={grade || undefined} onValueChange={setGrade}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a grade" />
              </SelectTrigger>
              <SelectContent>
                {KICD_GRADES.map((g) => (
                  <SelectItem key={g.value} value={g.value}>
                    {g.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileRef} type="file" accept="application/pdf" className="text-sm" />
          <Button onClick={handleImport} disabled={pending}>
            {pending ? "Working…" : "Upload & extract"}
          </Button>
        </div>
      </div>

      {!schoolMode && learningAreas.length > 0 && (
        <div className="panel flex flex-col gap-2 p-4">
          <p className="text-sm font-medium">Learning area → school subject link</p>
          <p className="text-xs text-muted-foreground">
            Schools only receive a learning area&apos;s content in subjects linked to the same catalogue entry. Unlinked learning areas
            ground nothing.
          </p>
          {learningAreas.map((a) => (
            <div key={a.id} className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm">{a.name}</span>
              <Select
                value={a.catalogue_id ?? "none"}
                onValueChange={(v) => run(() => setKicdLearningAreaCatalogue(a.id, v === "none" ? null : v))}
                disabled={pending}
              >
                <SelectTrigger className="w-64" aria-label={`Catalogue subject for ${a.name}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not linked</SelectItem>
                  {catalogue.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {catalogueOptionLabel(c.name, c.grade_band)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
      )}

      {error && <p className="panel border-destructive/40 p-3 text-sm text-destructive">{error}</p>}
      {notice && <p className="panel p-3 text-sm">{notice}</p>}

      {sources.length === 0 ? (
        <p className="panel border-dashed p-8 text-center text-sm text-muted-foreground">
          {schoolMode ? "Nothing imported for your school yet." : "No KICD content imported yet."}
        </p>
      ) : (
        sources.map((s) => (
          <div key={s.id} className="panel flex flex-col gap-2 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium">{s.name}</p>
                <p className="text-xs text-muted-foreground">
                  Licence: {s.licence_reference} · {s.attribution}
                  {s.source_document ? ` · ${s.source_document}` : ""}
                  {s.schools?.name ? ` · Private to ${s.schools.name}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge tone={s.is_enabled ? "success" : "warning"} label={s.is_enabled ? "Published" : "Unpublished"} />
                <Button size="sm" variant={s.is_enabled ? "outline" : "default"} disabled={pending} onClick={() => run(() => setKicdSourceEnabled(s.id, !s.is_enabled))}>
                  {s.is_enabled ? "Withdraw" : "Publish"}
                </Button>
                {!s.is_enabled && (
                  <Button size="sm" variant="destructive" disabled={pending} onClick={() => run(() => deleteKicdSource(s.id))}>
                    Discard
                  </Button>
                )}
              </div>
            </div>
            <details>
              <summary className="cursor-pointer text-xs text-muted-foreground">
                Review content ({s.kicd_strands.reduce((n, k) => n + k.kicd_sub_strands.length, 0)} sub-strands)
              </summary>
              <div className="mt-2 flex flex-col gap-2">
                {s.kicd_strands.map((k) => (
                  <div key={k.id} className="rounded border p-2">
                    <p className="text-sm font-semibold">
                      {k.kicd_learning_areas?.name} · {k.grade} · {k.name}
                    </p>
                    {k.kicd_sub_strands.map((sub) => (
                      <SubStrandEditor key={sub.id} sub={sub} run={run} pending={pending} />
                    ))}
                  </div>
                ))}
              </div>
            </details>
          </div>
        ))
      )}
    </div>
  );
}

function SubStrandEditor({ sub, run, pending }: { sub: KicdSubStrandRow; run: (fn: () => Promise<Result>) => void; pending: boolean }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState({
    name: sub.name,
    learning_outcomes: sub.learning_outcomes ?? "",
    key_inquiry_questions: sub.key_inquiry_questions ?? "",
    rubric_text: sub.rubric_text ?? "",
  });
  return (
    <div className="mt-1 flex flex-col gap-1 rounded border border-dashed p-2">
      {editing ? (
        <>
          <Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
          <Textarea rows={2} value={v.learning_outcomes} onChange={(e) => setV({ ...v, learning_outcomes: e.target.value })} placeholder="Learning outcomes" />
          <Textarea rows={2} value={v.key_inquiry_questions} onChange={(e) => setV({ ...v, key_inquiry_questions: e.target.value })} placeholder="Key inquiry questions" />
          <Textarea rows={2} value={v.rubric_text} onChange={(e) => setV({ ...v, rubric_text: e.target.value })} placeholder="Assessment guidance" />
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setEditing(false)} disabled={pending}>Cancel</Button>
            <Button size="sm" disabled={pending} onClick={() => run(async () => { const r = await updateKicdSubStrand(sub.id, v); if ("success" in r) setEditing(false); return r; })}>Save</Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm">{sub.name}</p>
          <div className="text-xs text-muted-foreground">
            {sub.learning_outcomes && <p>Outcomes: {sub.learning_outcomes}</p>}
            {sub.key_inquiry_questions && <p>Questions: {sub.key_inquiry_questions}</p>}
            {sub.rubric_text && <p>Assessment: {sub.rubric_text}</p>}
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setEditing(true)} disabled={pending}>Edit</Button>
            <Button size="sm" variant="destructive" disabled={pending} onClick={() => run(() => deleteKicdSubStrand(sub.id))}>Remove</Button>
          </div>
        </>
      )}
    </div>
  );
}
