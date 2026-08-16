"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { createStudentWithGuardian, previewNextAdmissionNumber } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const STEPS = ["Student info", "Guardian info", "Documents"] as const;

export default function NewStudentPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [createdStudentId, setCreatedStudentId] = useState<string | null>(null);
  const [admissionPreview, setAdmissionPreview] = useState<string | null>(null);

  const [studentInfo, setStudentInfo] = useState({
    upi_number: "",
    first_name: "",
    last_name: "",
    other_names: "",
    date_of_birth: "",
    gender: "male" as "male" | "female",
  });

  useEffect(() => {
    previewNextAdmissionNumber().then((result) => {
      if ("admissionNumber" in result) setAdmissionPreview(result.admissionNumber);
    });
  }, []);

  const [guardianInfo, setGuardianInfo] = useState({
    phone: "",
    full_name: "",
    email: "",
    relationship: "mother" as "mother" | "father" | "guardian" | "other",
  });

  const [documentCategory, setDocumentCategory] = useState("birth_certificate");
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  function goNext() {
    setError(null);
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }
  function goBack() {
    setError(null);
    setStep((s) => Math.max(s - 1, 0));
  }

  async function handleCreate() {
    setError(null);
    setPending(true);
    try {
      const result = await createStudentWithGuardian({
        ...studentInfo,
        // Always sent blank -- the DB assigns the real admission number atomically at
        // insert time (students_before_insert trigger). admissionPreview above is display-only.
        admission_number: "",
        upi_number: studentInfo.upi_number || undefined,
        other_names: studentInfo.other_names || undefined,
        guardian: {
          ...guardianInfo,
          email: guardianInfo.email || undefined,
        },
      });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setAdmissionPreview(result.admissionNumber);
      setCreatedStudentId(result.studentId);
      goNext();
    } finally {
      setPending(false);
    }
  }

  async function handleDocumentUploadAndFinish() {
    if (!documentFile || !createdStudentId) {
      router.push(`/students/${createdStudentId}`);
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const supabase = createClient();
      const [{ data: schoolId }, { data: authData }] = await Promise.all([
        supabase.rpc("auth_school_id"),
        supabase.auth.getUser(),
      ]);
      const { data: me } = await supabase
        .from("school_users")
        .select("id")
        .eq("auth_user_id", authData.user!.id)
        .single();

      const path = `${schoolId}/${createdStudentId}/${crypto.randomUUID()}-${documentFile.name}`;
      const { error: uploadError } = await supabase.storage
        .from("student-documents")
        .upload(path, documentFile);
      if (uploadError) throw uploadError;

      const { error: insertError } = await supabase.from("documents").insert({
        school_id: schoolId,
        student_id: createdStudentId,
        category: documentCategory,
        file_name: documentFile.name,
        storage_path: path,
        uploaded_by: me!.id,
      });
      if (insertError) throw insertError;

      router.push(`/students/${createdStudentId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not upload the document.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-10">
      <h1 className="mb-1 text-lg font-semibold">Register student</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Step {step + 1} of {STEPS.length}: {STEPS[step]}
      </p>

      <div className="mb-6 flex gap-1.5">
        {STEPS.map((s, i) => (
          <div
            key={s}
            className={cn("h-1 flex-1 rounded-full", i <= step ? "bg-primary" : "bg-muted")}
          />
        ))}
      </div>

      <div className="rounded-md border border-border bg-surface p-6">
        {step === 0 && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="admission_number">Admission number</Label>
                <Input
                  id="admission_number"
                  value={admissionPreview ?? "Assigning…"}
                  disabled
                  readOnly
                />
                <p className="text-xs text-muted-foreground">Assigned automatically — next available number.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="upi_number">UPI number (optional)</Label>
                <Input
                  id="upi_number"
                  value={studentInfo.upi_number}
                  onChange={(e) => setStudentInfo({ ...studentInfo, upi_number: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="first_name">First name</Label>
                <Input
                  id="first_name"
                  value={studentInfo.first_name}
                  onChange={(e) => setStudentInfo({ ...studentInfo, first_name: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="last_name">Last name</Label>
                <Input
                  id="last_name"
                  value={studentInfo.last_name}
                  onChange={(e) => setStudentInfo({ ...studentInfo, last_name: e.target.value })}
                  required
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="other_names">Other names (optional)</Label>
              <Input
                id="other_names"
                value={studentInfo.other_names}
                onChange={(e) => setStudentInfo({ ...studentInfo, other_names: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="date_of_birth">Date of birth</Label>
                <Input
                  id="date_of_birth"
                  type="date"
                  value={studentInfo.date_of_birth}
                  onChange={(e) =>
                    setStudentInfo({ ...studentInfo, date_of_birth: e.target.value })
                  }
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label>Gender</Label>
                <Select
                  value={studentInfo.gender}
                  onValueChange={(v: "male" | "female") =>
                    setStudentInfo({ ...studentInfo, gender: v })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="male">Male</SelectItem>
                    <SelectItem value="female">Female</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              A student must have at least one primary-contact guardian before their profile
              becomes active. If this phone number is already registered, we&apos;ll link the
              existing account instead of creating a new one.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="g_phone">Guardian phone</Label>
              <Input
                id="g_phone"
                type="tel"
                placeholder="+2547XXXXXXXX"
                value={guardianInfo.phone}
                onChange={(e) => setGuardianInfo({ ...guardianInfo, phone: e.target.value })}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="g_name">Guardian full name</Label>
              <Input
                id="g_name"
                value={guardianInfo.full_name}
                onChange={(e) => setGuardianInfo({ ...guardianInfo, full_name: e.target.value })}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="g_email">Guardian email (optional)</Label>
              <Input
                id="g_email"
                type="email"
                value={guardianInfo.email}
                onChange={(e) => setGuardianInfo({ ...guardianInfo, email: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Relationship</Label>
              <Select
                value={guardianInfo.relationship}
                onValueChange={(v: "mother" | "father" | "guardian" | "other") =>
                  setGuardianInfo({ ...guardianInfo, relationship: v })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mother">Mother</SelectItem>
                  <SelectItem value="father">Father</SelectItem>
                  <SelectItem value="guardian">Guardian</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Optional — you can also add documents later from the student&apos;s profile.
            </p>
            <div className="space-y-1.5">
              <Label>Document type</Label>
              <Select value={documentCategory} onValueChange={setDocumentCategory}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="birth_certificate">Birth certificate</SelectItem>
                  <SelectItem value="id_scan">ID scan</SelectItem>
                  <SelectItem value="report_card">Report card</SelectItem>
                  <SelectItem value="transfer_letter">Transfer letter</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="doc_file">File</Label>
              <Input
                id="doc_file"
                type="file"
                onChange={(e) => setDocumentFile(e.target.files?.[0] ?? null)}
              />
            </div>
          </div>
        )}

        {error && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {error}
          </p>
        )}

        <div className="mt-6 flex justify-between">
          <Button variant="outline" onClick={goBack} disabled={step === 0 || pending || uploading}>
            Back
          </Button>

          {step === 0 && <Button onClick={goNext}>Next</Button>}
          {step === 1 && (
            <Button onClick={handleCreate} disabled={pending}>
              {pending ? "Creating…" : "Create student"}
            </Button>
          )}
          {step === 2 && (
            <Button onClick={handleDocumentUploadAndFinish} disabled={uploading}>
              {uploading ? "Uploading…" : documentFile ? "Upload & finish" : "Skip & finish"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
