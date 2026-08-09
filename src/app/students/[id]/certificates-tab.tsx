"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";

export interface CertificateRow {
  id: string;
  certificate_type: string;
  title: string;
  description: string | null;
  issued_date: string;
}

const TYPES = [
  { value: "completion", label: "Completion" },
  { value: "achievement", label: "Achievement" },
  { value: "good_conduct", label: "Good Conduct" },
  { value: "sports", label: "Sports" },
  { value: "academic_excellence", label: "Academic Excellence" },
  { value: "other", label: "Other" },
];

export function CertificatesTab({
  studentId,
  certificates,
  canIssue,
}: {
  studentId: string;
  certificates: CertificateRow[];
  canIssue: boolean;
}) {
  const [rows, setRows] = useState(certificates);
  const [showForm, setShowForm] = useState(false);
  const [certificateType, setCertificateType] = useState("achievement");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function issue() {
    if (!title.trim()) {
      setError("A title is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data: me } = await supabase.auth.getUser();
      const { data: schoolUser } = await supabase
        .from("school_users")
        .select("id, school_id")
        .eq("auth_user_id", me.user?.id)
        .maybeSingle();
      if (!schoolUser) throw new Error("Could not resolve your account.");

      const { data, error: insertError } = await supabase
        .from("certificates")
        .insert({
          school_id: schoolUser.school_id,
          student_id: studentId,
          certificate_type: certificateType,
          title: title.trim(),
          description: description.trim() || null,
          issued_by: schoolUser.id,
        })
        .select("id, certificate_type, title, description, issued_date")
        .single();
      if (insertError) throw insertError;

      setRows((prev) => [data as CertificateRow, ...prev]);
      setTitle("");
      setDescription("");
      setShowForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not issue the certificate.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {rows.length === 0 && <p className="text-sm text-muted-foreground">No certificates issued yet.</p>}
      {rows.map((c) => (
        <div key={c.id} className="rounded-md border border-border p-3">
          <div className="flex items-center justify-between">
            <p className="font-medium">{c.title}</p>
            <span className="text-xs text-muted-foreground">{c.issued_date}</span>
          </div>
          <p className="text-xs capitalize text-muted-foreground">{c.certificate_type.replace("_", " ")}</p>
          {c.description && <p className="mt-1 text-sm">{c.description}</p>}
        </div>
      ))}

      {canIssue && !showForm && (
        <Button size="sm" variant="outline" onClick={() => setShowForm(true)}>
          Issue certificate
        </Button>
      )}

      {canIssue && showForm && (
        <div className="space-y-3 rounded-md border border-border p-3">
          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select value={certificateType} onValueChange={setCertificateType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cert_title">Title</Label>
            <Input id="cert_title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cert_description">Description (optional)</Label>
            <Textarea id="cert_description" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="flex gap-2">
            <Button size="sm" onClick={issue} disabled={saving}>
              {saving ? "Issuing…" : "Issue"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowForm(false)} disabled={saving}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
