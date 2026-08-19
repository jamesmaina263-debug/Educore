"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { submitApplication, type ApplyState } from "./actions";

export interface DocumentRequirement {
  category: string;
  label: string;
  required: boolean;
}

const applyInitialState: ApplyState = { error: null };

export function ApplicationForm({
  schoolSlug,
  documentRequirements,
}: {
  schoolSlug: string;
  documentRequirements: DocumentRequirement[];
}) {
  const [state, formAction, pending] = useActionState(submitApplication, applyInitialState);
  const [formLoadedAt] = useState(() => Date.now());
  const [gender, setGender] = useState<"male" | "female" | "">("");
  const [relationship, setRelationship] = useState<"mother" | "father" | "guardian" | "other">("mother");

  if (state.success) {
    return (
      <div className="space-y-3 text-center">
        <p className="text-base font-semibold text-success">Application received</p>
        <p className="text-sm text-muted-foreground">
          Your reference is <span className="font-mono font-medium">{state.applicationNumber}</span>. The
          school will review your application and get in touch on the phone number you provided.
        </p>
        {state.accessToken && (
          <div className="rounded-md border border-dashed border-border p-3 text-left">
            <p className="text-[0.8125rem] font-medium">Check your status or add documents later</p>
            <p className="mt-1 break-all text-[0.75rem] text-muted-foreground">
              {`${typeof window !== "undefined" ? window.location.origin : ""}/apply/${schoolSlug}/status/${state.accessToken}`}
            </p>
          </div>
        )}
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4" encType="multipart/form-data">
      <input type="hidden" name="school_slug" value={schoolSlug} />
      <input type="hidden" name="form_loaded_at" value={formLoadedAt} />
      {/* Honeypot — hidden from real users via CSS, left unfilled by them; bots that fill every
          field will trip it. Not a visible field, so no label/id needed for accessibility. */}
      <div className="absolute -left-[9999px]" aria-hidden="true">
        <label htmlFor="website">Leave this field blank</label>
        <input type="text" id="website" name="website" tabIndex={-1} autoComplete="off" />
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium">Student details</h2>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="first_name">First name</Label>
            <Input id="first_name" name="first_name" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="last_name">Last name</Label>
            <Input id="last_name" name="last_name" required />
          </div>
        </div>
        <div className="mt-3 space-y-1.5">
          <Label htmlFor="other_names">Other names (optional)</Label>
          <Input id="other_names" name="other_names" />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="date_of_birth">Date of birth</Label>
            <Input id="date_of_birth" name="date_of_birth" type="date" required />
          </div>
          <div className="space-y-1.5">
            <Label>Gender</Label>
            <Select value={gender} onValueChange={(v: "male" | "female") => setGender(v)}>
              <SelectTrigger>
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="male">Male</SelectItem>
                <SelectItem value="female">Female</SelectItem>
              </SelectContent>
            </Select>
            <input type="hidden" name="gender" value={gender} />
          </div>
        </div>
        <div className="mt-3 space-y-1.5">
          <Label htmlFor="notes">Grade applying for / notes (optional)</Label>
          <Textarea
            id="notes"
            name="notes"
            rows={2}
            placeholder="e.g. Applying for Grade 4, transferring from..."
          />
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium">Parent / guardian details</h2>
        <div className="space-y-1.5">
          <Label htmlFor="guardian_phone">Phone</Label>
          <Input id="guardian_phone" name="guardian_phone" type="tel" placeholder="+2547XXXXXXXX" required />
        </div>
        <div className="mt-3 space-y-1.5">
          <Label htmlFor="guardian_name">Full name</Label>
          <Input id="guardian_name" name="guardian_name" required />
        </div>
        <div className="mt-3 space-y-1.5">
          <Label htmlFor="guardian_email">Email (optional)</Label>
          <Input id="guardian_email" name="guardian_email" type="email" />
        </div>
        <div className="mt-3 space-y-1.5">
          <Label>Relationship to student</Label>
          <Select value={relationship} onValueChange={(v: typeof relationship) => setRelationship(v)}>
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
          <input type="hidden" name="relationship" value={relationship} />
        </div>
      </div>

      {documentRequirements.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-medium">Documents</h2>
          <p className="mb-2 text-[0.75rem] text-muted-foreground">
            You can also add these later using the link on your confirmation screen.
          </p>
          <div className="space-y-3">
            {documentRequirements.map((req) => (
              <div key={req.category} className="space-y-1.5">
                <Label htmlFor={`document_${req.category}`}>
                  {req.label} {req.required ? <span className="text-danger">*</span> : <span className="text-muted-foreground">(optional)</span>}
                </Label>
                <Input id={`document_${req.category}`} name={`document_${req.category}`} type="file" accept=".pdf,.jpg,.jpeg,.png" />
              </div>
            ))}
          </div>
        </div>
      )}

      {state.needsGuardianVerification && (
        <div className="space-y-2 rounded-md border border-border bg-muted/40 p-3">
          <p className="text-[0.8125rem] font-medium">Confirm it&apos;s you (optional)</p>
          {state.guardianVerificationNotice && (
            <p className="text-[0.75rem] text-muted-foreground">{state.guardianVerificationNotice}</p>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="guardian_otp_code">6-digit code</Label>
            <Input
              id="guardian_otp_code"
              name="guardian_otp_code"
              inputMode="numeric"
              maxLength={6}
              placeholder="000000"
            />
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              type="submit"
              name="guardian_verification_intent"
              value="verify"
              disabled={pending}
              className="flex-1"
            >
              {pending ? "Checking…" : "Confirm & submit"}
            </Button>
            <Button
              type="submit"
              name="guardian_verification_intent"
              value="skip"
              variant="outline"
              disabled={pending}
              className="flex-1"
            >
              Submit without confirming
            </Button>
          </div>
          <button
            type="submit"
            name="guardian_verification_intent"
            value="resend"
            disabled={pending}
            className="text-[0.75rem] text-muted-foreground underline underline-offset-2 disabled:opacity-50"
          >
            Resend code
          </button>
        </div>
      )}

      {state.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}

      {!state.needsGuardianVerification && (
        <Button type="submit" className="w-full" disabled={pending || !gender}>
          {pending ? "Submitting…" : "Submit application"}
        </Button>
      )}
    </form>
  );
}
