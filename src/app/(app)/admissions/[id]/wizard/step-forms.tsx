"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import Link from "next/link";
import {
  updateAdmissionDetails,
  updateApplicantIdentity,
  checkForDuplicateStudents,
  createOrLinkStudent,
  previewNextAdmissionNumberForWizard,
  searchGuardians,
  linkGuardianToApplication,
  verifyDocumentAction,
  rejectDocumentAction,
  uploadDocumentAsStaff,
  setAcademicPlacement,
  allocateBoardingForApplication,
  removeBoardingForApplication,
  assignTransportForApplication,
  removeTransportForApplication,
  saveHealthProfileForApplication,
  getFeePreview,
  saveFinanceDecision,
  getAdmissionChecklist,
  completeEnrollmentAction,
  type AdmissionDetailsInput,
  type ApplicantIdentityInput,
  type HealthProfileInput,
  type DuplicateCandidate,
  type GuardianSearchResult,
  type FeeChargeLine,
  type ChecklistItem,
  type EnrollmentResult,
} from "./actions";
import { useOfflineSync } from "@/hooks/use-offline-sync";
import { queueMutation } from "@/lib/offline/queue";
import { AdmissionsOfflineBanner } from "@/components/admissions/offline-banner";
import { MpesaPushTrigger } from "@/components/finance/mpesa-push-trigger";
import { DocumentPreviewButton } from "@/components/document-preview-dialog";

// Shared shell every step form renders inside, matching the wizard panel's existing look.
function StepPanel({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

function ErrorText({ error }: { error: string | null }) {
  if (!error) return null;
  return <p className="rounded-md border border-danger/25 bg-destructive-subtle px-3 py-2 text-sm text-danger">{error}</p>;
}

function SuccessDot() {
  return <span className="inline-block h-1.5 w-1.5 rounded-full bg-success" aria-hidden />;
}

// ============================================================================
// Step 1 — Admission Details
// ============================================================================

export interface AcademicYearOption { id: string; name: string; status: string }
export interface TermOption { id: string; academic_year_id: string; name: string; term_number: number; status: string }
export interface StreamOption { id: string; label: string; class_id: string; capacity: number | null; occupied: number }

export function AdmissionDetailsStep({
  applicationId,
  academicYears,
  terms,
  initial,
}: {
  applicationId: string;
  academicYears: AcademicYearOption[];
  terms: TermOption[];
  initial: {
    admission_type: string;
    academic_year_id: string | null;
    term_id: string | null;
    boarding_preference: string | null;
    transport_required: boolean;
    previous_school: string | null;
    previous_class: string | null;
  };
}) {
  const router = useRouter();
  const { online, pendingCount, failed, syncing, sync, discard } = useOfflineSync("admissions");
  const [form, setForm] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const termsForYear = terms.filter((t) => t.academic_year_id === form.academic_year_id);

  function save() {
    setError(null);
    setSaved(false);
    const input: AdmissionDetailsInput = {
      admission_type: form.admission_type as "new" | "transfer" | "re_admission",
      academic_year_id: form.academic_year_id,
      term_id: form.term_id,
      intended_class_id: null,
      boarding_preference: (form.boarding_preference as "day" | "boarding" | null) ?? null,
      transport_required: form.transport_required,
      previous_school: form.previous_school ?? undefined,
      previous_class: form.previous_class ?? undefined,
    };
    startTransition(async () => {
      if (!online) {
        await queueMutation("admissions", "updateAdmissionDetails", { applicationId, input });
        setSaved(true);
        return;
      }
      const result = await updateAdmissionDetails(applicationId, input);
      if ("error" in result) { setError(result.error); return; }
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <StepPanel title="Admission Details" hint="Admission type, academic year, term, and day/boarding + transport preference — these drive which later steps apply.">
      <AdmissionsOfflineBanner online={online} pendingCount={pendingCount} failed={failed} syncing={syncing} sync={sync} discard={discard} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Admission type</Label>
          <Select value={form.admission_type} onValueChange={(v) => setForm({ ...form, admission_type: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="new">New</SelectItem>
              <SelectItem value="transfer">Transfer</SelectItem>
              <SelectItem value="re_admission">Re-admission</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Academic year</Label>
          <Select value={form.academic_year_id ?? ""} onValueChange={(v) => setForm({ ...form, academic_year_id: v, term_id: null })}>
            <SelectTrigger><SelectValue placeholder="Select year" /></SelectTrigger>
            <SelectContent>
              {academicYears.map((y) => <SelectItem key={y.id} value={y.id}>{y.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Term</Label>
          <Select value={form.term_id ?? ""} onValueChange={(v) => setForm({ ...form, term_id: v })} disabled={!form.academic_year_id}>
            <SelectTrigger><SelectValue placeholder="Select term" /></SelectTrigger>
            <SelectContent>
              {termsForYear.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Day or boarding</Label>
          <Select value={form.boarding_preference ?? ""} onValueChange={(v) => setForm({ ...form, boarding_preference: v })}>
            <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="day">Day</SelectItem>
              <SelectItem value="boarding">Boarding</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="previous_school">Previous school</Label>
          <Input id="previous_school" value={form.previous_school ?? ""} onChange={(e) => setForm({ ...form, previous_school: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="previous_class">Previous class</Label>
          <Input id="previous_class" value={form.previous_class ?? ""} onChange={(e) => setForm({ ...form, previous_class: e.target.value })} />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox id="transport_required" checked={form.transport_required} onCheckedChange={(c) => setForm({ ...form, transport_required: c === true })} />
        <Label htmlFor="transport_required" className="font-normal">Requires school transport</Label>
      </div>
      <ErrorText error={error} />
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={save} disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
        {saved && !pending && <span className="flex items-center gap-1.5 text-xs text-success"><SuccessDot />Saved</span>}
      </div>
    </StepPanel>
  );
}

// ============================================================================
// Step 2 — Student Biodata + Duplicate Detection
// ============================================================================

export function StudentStep({
  applicationId,
  applicantSummary,
  resultingStudentId,
}: {
  applicationId: string;
  applicantSummary: { first_name: string; last_name: string; other_names?: string | null; date_of_birth: string; gender: string };
  resultingStudentId: string | null;
}) {
  const router = useRouter();
  const { online, pendingCount, failed, syncing, sync, discard } = useOfflineSync("admissions");
  const [admissionNumber, setAdmissionNumber] = useState<string | null>(null);

  useEffect(() => {
    previewNextAdmissionNumberForWizard().then((result) => {
      if ("admissionNumber" in result) setAdmissionNumber(result.admissionNumber);
    });
  }, []);
  const [candidates, setCandidates] = useState<DuplicateCandidate[] | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const hasIdentity = Boolean(applicantSummary.first_name && applicantSummary.last_name && applicantSummary.date_of_birth && applicantSummary.gender);
  const [editingIdentity, setEditingIdentity] = useState(!hasIdentity);
  const [identity, setIdentity] = useState({
    first_name: applicantSummary.first_name ?? "",
    last_name: applicantSummary.last_name ?? "",
    other_names: applicantSummary.other_names ?? "",
    date_of_birth: applicantSummary.date_of_birth ?? "",
    gender: applicantSummary.gender ?? "",
  });

  function saveIdentity() {
    if (!identity.first_name.trim() || !identity.last_name.trim() || !identity.date_of_birth || !identity.gender) {
      setError("Name, date of birth, and gender are all required.");
      return;
    }
    setError(null);
    const input: ApplicantIdentityInput = {
      first_name: identity.first_name,
      last_name: identity.last_name,
      other_names: identity.other_names,
      date_of_birth: identity.date_of_birth,
      gender: identity.gender as "male" | "female",
    };
    startTransition(async () => {
      if (!online) {
        // Duplicate-checking and student creation (the next actions in this
        // step) both need a live connection regardless -- this just makes
        // sure typed-in identity details aren't lost if the connection was
        // already down before the officer got that far.
        await queueMutation("admissions", "updateApplicantIdentity", { applicationId, input });
        setEditingIdentity(false);
        return;
      }
      const result = await updateApplicantIdentity(applicationId, input);
      if ("error" in result) { setError(result.error); return; }
      setEditingIdentity(false);
      router.refresh();
    });
  }

  function runDuplicateCheck() {
    setError(null);
    startTransition(async () => {
      const result = await checkForDuplicateStudents(applicationId);
      if ("error" in result) { setError(result.error); return; }
      setCandidates(result.candidates);
    });
  }

  function createNew(overrideDuplicate: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await createOrLinkStudent(applicationId, {
        admission_number: "",
        override_duplicate: overrideDuplicate,
        overridden_candidate_ids: overrideDuplicate ? (candidates ?? []).map((c) => c.id) : undefined,
      });
      if ("error" in result) { setError(result.error); return; }
      router.refresh();
    });
  }

  function linkExisting(studentId: string) {
    setError(null);
    startTransition(async () => {
      const result = await createOrLinkStudent(applicationId, {
        admission_number: "",
        override_duplicate: true,
        link_existing_student_id: studentId,
        overridden_candidate_ids: (candidates ?? []).map((c) => c.id),
      });
      if ("error" in result) { setError(result.error); return; }
      router.refresh();
    });
  }

  // Once the Student record exists, identity is authoritative on the students table (not just
  // the application snapshot) — updateApplicantIdentity's underlying RPC keeps both rows in
  // sync, so editing here after linking is safe and no longer locked. Still shows the same
  // form; only the surrounding lock screen and Cancel option differ.
  if (resultingStudentId && !editingIdentity) {
    return (
      <StepPanel title="Student">
        <p className="flex items-center gap-1.5 text-sm text-success"><SuccessDot />Student record linked ({applicantSummary.first_name} {applicantSummary.last_name}).</p>
        <Button size="sm" variant="ghost" onClick={() => setEditingIdentity(true)}>Edit details</Button>
      </StepPanel>
    );
  }

  if (editingIdentity) {
    return (
      <StepPanel title="Student" hint="Enter the applicant's name, date of birth, and gender — these identify the student and are used to check for an existing record.">
        <AdmissionsOfflineBanner online={online} pendingCount={pendingCount} failed={failed} syncing={syncing} sync={sync} discard={discard} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="first_name">First name</Label>
            <Input id="first_name" value={identity.first_name} onChange={(e) => setIdentity({ ...identity, first_name: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="last_name">Last name</Label>
            <Input id="last_name" value={identity.last_name} onChange={(e) => setIdentity({ ...identity, last_name: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="other_names">Other names (optional)</Label>
            <Input id="other_names" value={identity.other_names} onChange={(e) => setIdentity({ ...identity, other_names: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="date_of_birth">Date of birth</Label>
            <Input id="date_of_birth" type="date" value={identity.date_of_birth} onChange={(e) => setIdentity({ ...identity, date_of_birth: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Gender</Label>
            <Select value={identity.gender} onValueChange={(v) => setIdentity({ ...identity, gender: v })}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="male">Male</SelectItem>
                <SelectItem value="female">Female</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        {resultingStudentId && (
          <p className="text-xs text-muted-foreground">
            This student has already been enrolled — saving here corrects both the admission record and the student&apos;s own record, and is logged in Settings &gt; Audit Log.
          </p>
        )}
        <ErrorText error={error} />
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={saveIdentity} disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
          {resultingStudentId && (
            <Button size="sm" variant="ghost" onClick={() => { setError(null); setIdentity({ first_name: applicantSummary.first_name ?? "", last_name: applicantSummary.last_name ?? "", other_names: applicantSummary.other_names ?? "", date_of_birth: applicantSummary.date_of_birth ?? "", gender: applicantSummary.gender ?? "" }); setEditingIdentity(false); }} disabled={pending}>
              Cancel
            </Button>
          )}
        </div>
      </StepPanel>
    );
  }

  return (
    <StepPanel title="Student" hint="Verify the applicant's details, check for a possible existing student, then create the master Student record.">
      <AdmissionsOfflineBanner online={online} pendingCount={pendingCount} failed={failed} syncing={syncing} sync={sync} discard={discard} />
      <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
        <div><dt className="text-muted-foreground">Name</dt><dd>{applicantSummary.first_name} {applicantSummary.last_name}</dd></div>
        <div><dt className="text-muted-foreground">Date of birth</dt><dd>{applicantSummary.date_of_birth}</dd></div>
        <div><dt className="text-muted-foreground">Gender</dt><dd className="capitalize">{applicantSummary.gender}</dd></div>
      </dl>
      <Button size="sm" variant="ghost" onClick={() => setEditingIdentity(true)}>Edit details</Button>

      {candidates === null ? (
        <Button size="sm" variant="outline" onClick={runDuplicateCheck} disabled={pending}>
          {pending ? "Checking…" : "Check for existing student"}
        </Button>
      ) : candidates.length > 0 ? (
        <div className="rounded-md border border-warning/25 bg-warning-subtle p-3">
          <p className="mb-2 text-sm font-medium text-warning">Possible existing student found</p>
          <ul className="space-y-2">
            {candidates.map((c) => (
              <li key={c.id} className="flex items-center justify-between rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm">
                <span>{c.first_name} {c.last_name} · {c.admission_number} · {c.date_of_birth} <span className="text-muted-foreground">({c.reason})</span></span>
                <Button size="sm" variant="outline" onClick={() => linkExisting(c.id)} disabled={pending}>Link this student</Button>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex items-end gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="admission_number">Admission number (new student)</Label>
              <Input id="admission_number" value={admissionNumber ?? "Assigning…"} disabled readOnly className="w-48" />
            </div>
            <Button size="sm" variant="destructive" onClick={() => createNew(true)} disabled={pending}>
              None of these — create new student
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-end gap-2">
          <p className="text-sm text-muted-foreground">No matching students found.</p>
        </div>
      )}

      {candidates !== null && candidates.length === 0 && (
        <div className="flex items-end gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="admission_number2">Admission number</Label>
            <Input id="admission_number2" value={admissionNumber ?? "Assigning…"} disabled readOnly className="w-48" />
          </div>
          <Button size="sm" onClick={() => createNew(false)} disabled={pending}>{pending ? "Creating…" : "Create student record"}</Button>
        </div>
      )}
      <ErrorText error={error} />
    </StepPanel>
  );
}

// ============================================================================
// Step 3 — Guardian
// ============================================================================

export function GuardianStep({ applicationId, resultingStudentId }: { applicationId: string; resultingStudentId: string | null }) {
  const router = useRouter();
  const [mode, setMode] = useState<"search" | "new">("search");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GuardianSearchResult[]>([]);
  const [relationship, setRelationship] = useState<"mother" | "father" | "guardian" | "other">("mother");
  const [newGuardian, setNewGuardian] = useState({ full_name: "", phone: "", email: "" });
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [linked, setLinked] = useState(false);

  function runSearch(q: string) {
    setQuery(q);
    startTransition(async () => {
      const result = await searchGuardians(q);
      if ("success" in result) setResults(result.results);
    });
  }

  function link(guardianId?: string) {
    if (!resultingStudentId) { setError("Complete the Student step first."); return; }
    setError(null);
    startTransition(async () => {
      const result = await linkGuardianToApplication(applicationId, {
        mode: guardianId ? "existing" : "new",
        guardian_id: guardianId,
        new_guardian: guardianId ? undefined : newGuardian,
        relationship,
        primary_contact: true,
      });
      if ("error" in result) { setError(result.error); return; }
      setLinked(true);
      router.refresh();
    });
  }

  return (
    <StepPanel title="Guardian" hint="Search for an existing guardian and link them, or create a new one.">
      <div className="flex gap-1.5">
        <Button size="sm" variant={mode === "search" ? "default" : "outline"} onClick={() => setMode("search")}>Search existing</Button>
        <Button size="sm" variant={mode === "new" ? "default" : "outline"} onClick={() => setMode("new")}>New guardian</Button>
      </div>

      <div className="space-y-1.5">
        <Label>Relationship to student</Label>
        <Select value={relationship} onValueChange={(v) => setRelationship(v as typeof relationship)}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="mother">Mother</SelectItem>
            <SelectItem value="father">Father</SelectItem>
            <SelectItem value="guardian">Guardian</SelectItem>
            <SelectItem value="other">Other</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {mode === "search" ? (
        <div className="space-y-2">
          <Input placeholder="Search by name or phone" value={query} onChange={(e) => runSearch(e.target.value)} />
          {results.length > 0 && (
            <ul className="space-y-1.5">
              {results.map((g) => (
                <li key={g.id} className="flex items-center justify-between rounded-md border border-border px-2.5 py-1.5 text-sm">
                  <span>{g.full_name} · {g.phone}</span>
                  <Button size="sm" variant="outline" onClick={() => link(g.id)} disabled={pending}>Link</Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="g_name">Full name</Label>
            <Input id="g_name" value={newGuardian.full_name} onChange={(e) => setNewGuardian({ ...newGuardian, full_name: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="g_phone">Phone</Label>
            <Input id="g_phone" value={newGuardian.phone} onChange={(e) => setNewGuardian({ ...newGuardian, phone: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="g_email">Email (optional)</Label>
            <Input id="g_email" value={newGuardian.email} onChange={(e) => setNewGuardian({ ...newGuardian, email: e.target.value })} />
          </div>
          <div className="flex items-end">
            <Button size="sm" onClick={() => link(undefined)} disabled={pending || !newGuardian.full_name || !newGuardian.phone}>
              {pending ? "Linking…" : "Create and link"}
            </Button>
          </div>
        </div>
      )}
      <ErrorText error={error} />
      {linked && <p className="flex items-center gap-1.5 text-xs text-success"><SuccessDot />Guardian linked</p>}
    </StepPanel>
  );
}

// ============================================================================
// Step 4 — Documents
// ============================================================================

export interface DocumentRequirement { category: string; label: string; required: boolean }
export interface ApplicationDocument {
  id: string;
  category: string;
  file_name: string;
  storage_path: string;
  storage_bucket: string;
  verification_status: string;
  verification_comment: string | null;
}

export function DocumentsStep({
  applicationId,
  requirements,
  documents,
}: {
  applicationId: string;
  requirements: DocumentRequirement[];
  documents: ApplicationDocument[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectComment, setRejectComment] = useState("");
  const docByCategory = new Map(documents.map((d) => [d.category, d]));

  function upload(category: string, file: File) {
    setError(null);
    const formData = new FormData();
    formData.append("file", file);
    startTransition(async () => {
      const result = await uploadDocumentAsStaff(applicationId, category, formData);
      if ("error" in result) { setError(result.error); return; }
      router.refresh();
    });
  }

  function verify(documentId: string) {
    setError(null);
    startTransition(async () => {
      const result = await verifyDocumentAction(documentId);
      if ("error" in result) { setError(result.error); return; }
      router.refresh();
    });
  }

  function reject(documentId: string) {
    if (!rejectComment.trim()) { setError("Explain why this document is being rejected."); return; }
    setError(null);
    startTransition(async () => {
      const result = await rejectDocumentAction(documentId, rejectComment);
      if ("error" in result) { setError(result.error); return; }
      setRejectingId(null);
      setRejectComment("");
      router.refresh();
    });
  }

  return (
    <StepPanel title="Documents" hint="Documents already submitted online appear pre-filled — upload, verify, or reject anything missing.">
      <ul className="space-y-2">
        {requirements.map((req) => {
          const doc = docByCategory.get(req.category);
          return (
            <li key={req.category} className="rounded-md border border-border p-2.5">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">
                  {req.label} {req.required && <span className="text-danger">*</span>}
                </span>
                {doc ? (
                  <span className={`text-xs ${doc.verification_status === "verified" ? "text-success" : doc.verification_status === "rejected" ? "text-danger" : "text-muted-foreground"}`}>
                    {doc.file_name} — {doc.verification_status}
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">Not submitted</span>
                )}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <Input type="file" accept=".pdf,.jpg,.jpeg,.png" className="h-8 max-w-64 text-xs"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(req.category, f); }} />
                {doc && (
                  <DocumentPreviewButton bucket={doc.storage_bucket} storagePath={doc.storage_path} fileName={doc.file_name} />
                )}
                {doc && doc.verification_status !== "verified" && (
                  <Button size="sm" variant="outline" onClick={() => verify(doc.id)} disabled={pending}>Verify</Button>
                )}
                {doc && doc.verification_status !== "rejected" && (
                  <Button size="sm" variant="ghost" onClick={() => setRejectingId(doc.id)} disabled={pending}>Reject</Button>
                )}
              </div>
              {rejectingId === doc?.id && (
                <div className="mt-2 flex items-center gap-2">
                  <Input placeholder="Reason for rejection" value={rejectComment} onChange={(e) => setRejectComment(e.target.value)} className="h-8" />
                  <Button size="sm" variant="destructive" onClick={() => reject(doc!.id)} disabled={pending}>Confirm reject</Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <ErrorText error={error} />
    </StepPanel>
  );
}

// ============================================================================
// Step 5 — Academic Placement
// ============================================================================

export function AcademicsStep({
  applicationId,
  streamOptions,
  currentStreamId,
}: {
  applicationId: string;
  streamOptions: StreamOption[];
  currentStreamId: string | null;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState(currentStreamId ?? "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function save() {
    if (!selected) { setError("Select a class/stream."); return; }
    setError(null);
    startTransition(async () => {
      const result = await setAcademicPlacement(applicationId, selected);
      if ("error" in result) { setError(result.error); return; }
      router.refresh();
    });
  }

  return (
    <StepPanel title="Academic Placement" hint="Live capacity from Academics — full streams are shown but disabled.">
      <div className="space-y-1.5">
        <Label>Class / stream</Label>
        <Select value={selected} onValueChange={setSelected}>
          <SelectTrigger className="w-72"><SelectValue placeholder="Select a stream" /></SelectTrigger>
          <SelectContent>
            {streamOptions.map((s) => {
              const full = s.capacity != null && s.occupied >= s.capacity;
              return (
                <SelectItem key={s.id} value={s.id} disabled={full}>
                  {s.label} — {s.occupied}/{s.capacity ?? "∞"}{full ? " (full)" : ""}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>
      <ErrorText error={error} />
      <Button size="sm" onClick={save} disabled={pending}>{pending ? "Saving…" : "Save placement"}</Button>
    </StepPanel>
  );
}

// ============================================================================
// Step 6 — Boarding
// ============================================================================

export interface BedOption { id: string; bed_number: string; available: boolean; status: string }
export interface RoomOption { id: string; room_number: string; gender: string; beds: BedOption[] }
export interface DormOption { id: string; name: string; gender: string; rooms: RoomOption[] }
export interface HouseOption { id: string; name: string; gender: string; dormitories: DormOption[] }

export function BoardingStep({
  applicationId,
  houseOptions,
  currentBedId,
}: {
  applicationId: string;
  houseOptions: HouseOption[];
  currentBedId: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function allocate(bedId: string) {
    setError(null);
    startTransition(async () => {
      const result = await allocateBoardingForApplication(applicationId, bedId);
      if ("error" in result) { setError(result.error); return; }
      router.refresh();
    });
  }

  function remove() {
    setError(null);
    startTransition(async () => {
      const result = await removeBoardingForApplication(applicationId);
      if ("error" in result) { setError(result.error); return; }
      router.refresh();
    });
  }

  if (currentBedId) {
    return (
      <StepPanel title="Boarding">
        <p className="flex items-center gap-1.5 text-sm text-success"><SuccessDot />Bed allocated.</p>
        <Button size="sm" variant="outline" onClick={remove} disabled={pending}>Remove allocation</Button>
        <ErrorText error={error} />
      </StepPanel>
    );
  }

  return (
    <StepPanel title="Boarding" hint="Live bed availability, written to the Boarding module the moment you allocate.">
      <div className="max-h-80 space-y-3 overflow-y-auto">
        {houseOptions.map((h) => (
          <div key={h.id}>
            <p className="text-xs font-medium text-muted-foreground">{h.name} ({h.gender})</p>
            {h.dormitories.map((d) => (
              <div key={d.id} className="mt-1 pl-2">
                <p className="text-xs">{d.name}</p>
                <div className="flex flex-wrap gap-1.5 pl-2 pt-1">
                  {d.rooms.flatMap((r) => r.beds.map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      disabled={!b.available || pending}
                      onClick={() => allocate(b.id)}
                      className={`rounded border px-2 py-1 text-xs ${b.available ? "border-border hover:border-primary" : "border-border bg-muted text-muted-foreground opacity-50"}`}
                      title={`Room ${r.room_number}`}
                    >
                      {r.room_number}-{b.bed_number}
                    </button>
                  )))}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
      <ErrorText error={error} />
    </StepPanel>
  );
}

// ============================================================================
// Step 7 — Transport
// ============================================================================

export interface RouteOption { id: string; name: string; fee_amount: number | null; stops: { id: string; name: string }[] }
export interface VehicleOption { id: string; label: string; capacity: number | null }

export function TransportStep({
  applicationId,
  routeOptions,
  vehicleOptions,
  hasAssignment,
}: {
  applicationId: string;
  routeOptions: RouteOption[];
  vehicleOptions: VehicleOption[];
  hasAssignment: boolean;
}) {
  const router = useRouter();
  const [routeId, setRouteId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [pickupPoint, setPickupPoint] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const stops = routeOptions.find((r) => r.id === routeId)?.stops ?? [];

  function assign() {
    if (!routeId) { setError("Select a route."); return; }
    setError(null);
    startTransition(async () => {
      const result = await assignTransportForApplication(applicationId, { route_id: routeId, vehicle_id: vehicleId || undefined, pickup_point: pickupPoint || undefined });
      if ("error" in result) { setError(result.error); return; }
      router.refresh();
    });
  }

  function remove() {
    setError(null);
    startTransition(async () => {
      const result = await removeTransportForApplication(applicationId);
      if ("error" in result) { setError(result.error); return; }
      router.refresh();
    });
  }

  if (hasAssignment) {
    return (
      <StepPanel title="Transport">
        <p className="flex items-center gap-1.5 text-sm text-success"><SuccessDot />Transport assigned.</p>
        <Button size="sm" variant="outline" onClick={remove} disabled={pending}>Remove assignment</Button>
        <ErrorText error={error} />
      </StepPanel>
    );
  }

  return (
    <StepPanel title="Transport" hint="Live route capacity, written to the Transport module the moment you assign.">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Route</Label>
          <Select value={routeId} onValueChange={(v) => { setRouteId(v); setPickupPoint(""); }}>
            <SelectTrigger><SelectValue placeholder="Select route" /></SelectTrigger>
            <SelectContent>{routeOptions.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Pickup point</Label>
          <Select value={pickupPoint} onValueChange={setPickupPoint} disabled={!routeId}>
            <SelectTrigger><SelectValue placeholder="Select stop" /></SelectTrigger>
            <SelectContent>{stops.map((s) => <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Vehicle (optional)</Label>
          <Select value={vehicleId} onValueChange={setVehicleId}>
            <SelectTrigger><SelectValue placeholder="Select vehicle" /></SelectTrigger>
            <SelectContent>{vehicleOptions.map((v) => <SelectItem key={v.id} value={v.id}>{v.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>
      <ErrorText error={error} />
      <Button size="sm" onClick={assign} disabled={pending}>{pending ? "Assigning…" : "Assign transport"}</Button>
    </StepPanel>
  );
}

// ============================================================================
// Step 8 — Health
// ============================================================================

export function HealthStep({
  applicationId,
  initial,
  canWrite,
}: {
  applicationId: string;
  initial: { blood_group: string | null; allergies: string | null; conditions: string | null; emergency_contact_name: string | null; emergency_contact_phone: string | null; notes: string | null };
  canWrite: boolean;
}) {
  const router = useRouter();
  const { online, pendingCount, failed, syncing, sync, discard } = useOfflineSync("admissions");
  const [form, setForm] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function save() {
    setError(null);
    setSaved(false);
    const input: HealthProfileInput = {
      blood_group: form.blood_group ?? undefined,
      allergies: form.allergies ?? undefined,
      conditions: form.conditions ?? undefined,
      emergency_contact_name: form.emergency_contact_name ?? undefined,
      emergency_contact_phone: form.emergency_contact_phone ?? undefined,
      notes: form.notes ?? undefined,
    };
    startTransition(async () => {
      if (!online) {
        await queueMutation("admissions", "saveHealthProfileForApplication", { applicationId, input });
        setSaved(true);
        return;
      }
      const result = await saveHealthProfileForApplication(applicationId, input);
      if ("error" in result) { setError(result.error); return; }
      setSaved(true);
      router.refresh();
    });
  }

  if (!canWrite) {
    return (
      <StepPanel title="Health">
        <p className="text-sm text-muted-foreground">
          You don&apos;t have medical-record permissions. A nurse or authorized staff member should complete this step — you can move on and come back later.
        </p>
      </StepPanel>
    );
  }

  return (
    <StepPanel title="Health" hint="Initial profile only — full medical detail is managed by the Health module, not here.">
      <AdmissionsOfflineBanner online={online} pendingCount={pendingCount} failed={failed} syncing={syncing} sync={sync} discard={discard} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="blood_group">Blood group</Label>
          <Input id="blood_group" value={form.blood_group ?? ""} onChange={(e) => setForm({ ...form, blood_group: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="emergency_contact_phone">Emergency contact phone</Label>
          <Input id="emergency_contact_phone" value={form.emergency_contact_phone ?? ""} onChange={(e) => setForm({ ...form, emergency_contact_phone: e.target.value })} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="emergency_contact_name">Emergency contact name</Label>
        <Input id="emergency_contact_name" value={form.emergency_contact_name ?? ""} onChange={(e) => setForm({ ...form, emergency_contact_name: e.target.value })} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="allergies">Allergies</Label>
        <Textarea id="allergies" value={form.allergies ?? ""} onChange={(e) => setForm({ ...form, allergies: e.target.value })} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="conditions">Known conditions</Label>
        <Textarea id="conditions" value={form.conditions ?? ""} onChange={(e) => setForm({ ...form, conditions: e.target.value })} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="notes">Special medical requirements</Label>
        <Textarea id="notes" value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      </div>
      <ErrorText error={error} />
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={save} disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
        {saved && !pending && <span className="flex items-center gap-1.5 text-xs text-success"><SuccessDot />Saved</span>}
      </div>
    </StepPanel>
  );
}

// ============================================================================
// Step 9 — Finance
// ============================================================================

export function FinanceStep({
  applicationId,
  hasStudentAndTerm,
  canWrite,
  initial,
  resultingStudentId,
  mpesaActive,
}: {
  applicationId: string;
  hasStudentAndTerm: boolean;
  canWrite: boolean;
  initial: { initial_payment_amount: number | null; initial_payment_method: string | null };
  resultingStudentId: string | null;
  mpesaActive: boolean;
}) {
  const [charges, setCharges] = useState<FeeChargeLine[] | null>(null);
  const [total, setTotal] = useState(0);
  const [invoiceId, setInvoiceId] = useState<string | null>(null);
  const [amount, setAmount] = useState(initial.initial_payment_amount?.toString() ?? "");
  const [method, setMethod] = useState(initial.initial_payment_method ?? "");
  const [pushPhone, setPushPhone] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function loadPreview() {
    setError(null);
    startTransition(async () => {
      const result = await getFeePreview(applicationId);
      if ("error" in result) { setError(result.error); return; }
      setCharges(result.charges);
      setTotal(result.total);
      setInvoiceId(result.invoiceId);
    });
  }

  function save() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await saveFinanceDecision(applicationId, {
        initial_payment_amount: amount ? Number(amount) : null,
        initial_payment_method: (method || null) as "cash" | "mpesa" | "bank" | "cheque" | null,
      });
      if ("error" in result) { setError(result.error); return; }
      setSaved(true);
    });
  }

  if (!hasStudentAndTerm) {
    return (
      <StepPanel title="Finance">
        <p className="text-sm text-muted-foreground">Complete the Student and Admission Details steps first to preview applicable charges.</p>
      </StepPanel>
    );
  }

  if (!canWrite) {
    return (
      <StepPanel title="Finance">
        <p className="text-sm text-muted-foreground">
          You don&apos;t have finance permissions. A Bursar or authorized Finance staff member should complete this step — you can move on and come back later.
        </p>
      </StepPanel>
    );
  }

  return (
    <StepPanel title="Finance" hint="Charges resolved from the same fee configuration Finance uses for invoicing. Loading them also creates this student's real invoice for the term.">
      {charges === null ? (
        <Button size="sm" variant="outline" onClick={loadPreview} disabled={pending}>{pending ? "Loading…" : "Load charges"}</Button>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="table-dense w-full">
            <tbody>
              {charges.map((c, i) => (
                <tr key={i}><td>{c.item_name}</td><td className="text-right">KES {Number(c.amount).toLocaleString()}</td></tr>
              ))}
              <tr className="font-semibold"><td>Total</td><td className="text-right">KES {total.toLocaleString()}</td></tr>
            </tbody>
          </table>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="initial_payment">Record initial payment (optional)</Label>
          <Input id="initial_payment" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount, KES" />
          {/* Task 9: informational only, using data already fetched by loadPreview above — no
              new validation, since a legitimate partial or advance payment can legitimately be
              less than or more than the term total. */}
          {charges !== null && amount.trim() !== "" && !Number.isNaN(Number(amount)) && (
            <p className="text-[0.75rem] text-muted-foreground">
              You entered KES {Number(amount).toLocaleString()} — the fee total for this term is KES {total.toLocaleString()}
              {Number(amount) !== total && Number(amount) > total && " (more than the total — likely covers a future term or is a deliberate advance)"}
              {Number(amount) !== total && Number(amount) < total && " (less than the total — a partial payment)"}
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label>Method</Label>
          <Select value={method} onValueChange={setMethod}>
            <SelectTrigger><SelectValue placeholder="Select method" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="cash">Cash</SelectItem>
              <SelectItem value="mpesa">M-Pesa</SelectItem>
              <SelectItem value="bank">Bank</SelectItem>
              <SelectItem value="cheque">Cheque</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      {method === "mpesa" && resultingStudentId && (
        <div className="flex flex-col gap-2 rounded-md border border-dashed p-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="push_phone">Phone number to push to</Label>
              <Input id="push_phone" value={pushPhone} onChange={(e) => setPushPhone(e.target.value)} placeholder="2547XXXXXXXX" />
            </div>
            <div className="flex items-end">
              <MpesaPushTrigger
                studentId={resultingStudentId}
                amount={amount}
                phoneNumber={pushPhone}
                invoiceId={invoiceId ?? undefined}
                notes="Admission initial payment"
                isActive={mpesaActive}
                canPush={canWrite}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            A confirmed push applies straight to this student&apos;s invoice automatically — no further action
            needed once Safaricom confirms it.
          </p>
        </div>
      )}
      <p className="text-xs text-muted-foreground">Leave blank to skip payment for now — a cash/bank/cheque payment recorded here is applied when enrollment is completed; M-Pesa applies as soon as it&apos;s confirmed.</p>
      <ErrorText error={error} />
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={save} disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
        {saved && !pending && <span className="flex items-center gap-1.5 text-xs text-success"><SuccessDot />Saved</span>}
      </div>
    </StepPanel>
  );
}

// ============================================================================
// Step 10 — Final Review (Brief 4.16.10, 4.16.13)
// ============================================================================

const CHECKLIST_STEP_BY_ITEM: Record<string, string> = {
  student: "student",
  guardian: "guardian",
  documents: "documents",
  academics: "academics",
  finance: "finance",
  boarding: "boarding",
  transport: "transport",
};

export interface ReviewSummary {
  admissionType: string;
  academicYearLabel: string | null;
  termLabel: string | null;
  studentName: string;
  admissionNumber: string | null;
  guardianName: string | null;
  guardianRelationship: string | null;
  documentsSummary: string;
  streamLabel: string | null;
  boardingLabel: string | null;
  transportLabel: string | null;
  financeTotal: number | null;
}

// "Editable inline" (Brief 4.16.13) is delivered by letting every section jump straight back to
// its own step — which already has the full, live form — rather than re-implementing every field
// a third time on this screen; fixing something here means one click, not a re-typed duplicate.
export function ReviewStep({ applicationId, summary, onNavigateToStep }: { applicationId: string; summary: ReviewSummary; onNavigateToStep: (stepId: string) => void }) {
  const [missing, setMissing] = useState<ChecklistItem[] | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function loadChecklist() {
    setError(null);
    startTransition(async () => {
      const result = await getAdmissionChecklist(applicationId);
      if ("error" in result) { setError(result.error); return; }
      setMissing(result.missing);
    });
  }

  const rows: { label: string; value: string; stepId: string }[] = [
    { label: "Admission type", value: summary.admissionType, stepId: "admission_details" },
    { label: "Academic year / term", value: `${summary.academicYearLabel ?? "—"} / ${summary.termLabel ?? "—"}`, stepId: "admission_details" },
    { label: "Student", value: `${summary.studentName}${summary.admissionNumber ? ` · ${summary.admissionNumber}` : ""}`, stepId: "student" },
    { label: "Guardian", value: summary.guardianName ? `${summary.guardianName} (${summary.guardianRelationship ?? "—"})` : "Not linked", stepId: "guardian" },
    { label: "Documents", value: summary.documentsSummary, stepId: "documents" },
    { label: "Class / stream", value: summary.streamLabel ?? "Not placed", stepId: "academics" },
    { label: "Boarding", value: summary.boardingLabel ?? "Day / not applicable", stepId: "boarding" },
    { label: "Transport", value: summary.transportLabel ?? "Not applicable", stepId: "transport" },
    { label: "Finance", value: summary.financeTotal != null ? `KES ${summary.financeTotal.toLocaleString()} charged this term` : "Not previewed", stepId: "finance" },
  ];

  return (
    <StepPanel title="Final Review" hint="Review every step before completing enrollment. Click any row to jump back and fix it.">
      <ul className="divide-y divide-border rounded-md border border-border">
        {rows.map((r) => (
          <li key={r.label} className="flex items-center justify-between px-3 py-2 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">{r.label}</p>
              <p>{r.value}</p>
            </div>
            <Button size="sm" variant="ghost" onClick={() => onNavigateToStep(r.stepId)}>Edit</Button>
          </li>
        ))}
      </ul>

      {missing === null ? (
        <Button size="sm" variant="outline" onClick={loadChecklist} disabled={pending}>{pending ? "Checking…" : "Run readiness check"}</Button>
      ) : missing.length === 0 ? (
        <p className="flex items-center gap-1.5 text-sm text-success"><SuccessDot />Everything required is in place — ready to complete enrollment.</p>
      ) : (
        <div className="rounded-md border border-danger/25 bg-destructive-subtle p-3">
          <p className="mb-1.5 text-sm font-medium text-danger">Not ready to complete</p>
          <ul className="space-y-1">
            {missing.map((m) => (
              <li key={m.item} className="flex items-center justify-between text-sm">
                <span>{m.message}</span>
                <Button size="sm" variant="ghost" onClick={() => onNavigateToStep(CHECKLIST_STEP_BY_ITEM[m.item] ?? "student")}>Fix</Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <ErrorText error={error} />
    </StepPanel>
  );
}

// ============================================================================
// Step 11 — Complete Enrollment + Completion Screen (Brief 4.16.11–4.16.13)
// ============================================================================

export function CompleteStep({
  applicationId,
  applicantName,
  alreadyEnrolled,
  onCompleted,
}: {
  applicationId: string;
  applicantName: string;
  alreadyEnrolled: EnrollmentResult | null;
  onCompleted: (result: EnrollmentResult) => void;
}) {
  const [result, setResult] = useState<EnrollmentResult | null>(alreadyEnrolled);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  function complete() {
    setError(null);
    startTransition(async () => {
      const outcome = await completeEnrollmentAction(applicationId);
      if ("error" in outcome) { setError(outcome.error); return; }
      setResult(outcome.result);
      onCompleted(outcome.result);
    });
  }

  function sendConfirmation() {
    startTransition(async () => {
      const outcome = await completeEnrollmentAction(applicationId); // idempotent — also re-triggers the best-effort send
      if (!("error" in outcome)) { setSent(true); setResult(outcome.result); }
    });
  }

  if (!result) {
    return (
      <StepPanel title="Complete Enrollment" hint="This creates the enrollment record in a single, safe step — clicking twice never creates duplicates.">
        <p className="text-sm">Ready to enroll <span className="font-medium">{applicantName}</span>.</p>
        <ErrorText error={error} />
        <Button onClick={complete} disabled={pending}>{pending ? "Completing…" : "Complete Enrollment"}</Button>
      </StepPanel>
    );
  }

  return (
    <StepPanel title="Enrollment Complete">
      <div className="rounded-md border border-success/25 bg-success-subtle p-4">
        <p className="flex items-center gap-1.5 text-sm font-medium text-success"><SuccessDot />{applicantName} is now enrolled.</p>
        <dl className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          <div><dt className="text-xs text-muted-foreground">Admission number</dt><dd>{result.admission_number}</dd></div>
          {result.total_amount != null && <div><dt className="text-xs text-muted-foreground">Fee balance</dt><dd>KES {Number(result.total_amount).toLocaleString()}</dd></div>}
          {result.payment_reference && <div><dt className="text-xs text-muted-foreground">Payment reference</dt><dd>{result.payment_reference}</dd></div>}
        </dl>
      </div>
      {/* Task 10: complete_enrollment() already returns invoice_id -- a null here means the
          fee-structure gap (see Task 4's Aug-25 fix) was hit and the invoice creation was
          skipped, but the enrollment itself still succeeded. Purely a UI branch on data
          already returned -- complete_enrollment() itself is untouched. */}
      {result.invoice_id === null && (
        <div className="rounded-md border border-warning/25 bg-warning-subtle p-3">
          <p className="text-sm font-medium text-warning">Enrollment completed, but the fee invoice could not be created</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Finance has been notified via the audit log. A fee structure will need to be configured for this class/term before an invoice can be raised.
          </p>
        </div>
      )}
      {/* Task 11: completeEnrollmentAction() now returns confirmation_sent/confirmation_note --
          set right after the same best-effort send this button re-triggers. Makes the "no
          template configured" (or no guardian, or send failure) case visible instead of it
          silently doing nothing. Purely a UI branch on data already returned. */}
      {!result.confirmation_sent && result.confirmation_note && (
        <div className="rounded-md border border-warning/25 bg-warning-subtle p-3">
          <p className="text-sm font-medium text-warning">No confirmation message sent automatically</p>
          <p className="mt-1 text-sm text-muted-foreground">{result.confirmation_note} Use &quot;Send Parent Confirmation&quot; below.</p>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm"><Link href={`/students/${result.student_id}`}>View Student</Link></Button>
        <Button asChild size="sm" variant="outline"><Link href={`/students/${result.student_id}/id-card`}>Print Student Details</Link></Button>
        {result.invoice_id && (
          <Button asChild size="sm" variant="outline"><Link href="/finance">View Fee Statement</Link></Button>
        )}
        <Button size="sm" variant="outline" onClick={sendConfirmation} disabled={pending}>
          {sent ? "Sent" : pending ? "Sending…" : "Send Parent Confirmation"}
        </Button>
        <Button asChild size="sm" variant="outline"><Link href="/admissions">Start New Admission</Link></Button>
      </div>
    </StepPanel>
  );
}
