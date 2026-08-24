"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { StatusBadge } from "@/components/status-badge";

export interface BiometricProfileRow {
  id: string;
  status: "active" | "inactive";
}

export interface BiometricCredentialRow {
  id: string;
  credential_type: "fingerprint" | "face";
  provider: string;
  status: "active" | "revoked";
  enrolled_at: string;
  revoked_at: string | null;
  device_name: string | null;
}

export interface BiometricDeviceOption {
  id: string;
  name: string;
  location: string | null;
}

// Never store the biometric itself here -- credential_reference is the
// opaque ID the device/provider assigned during a real local enrollment
// session (see biometric_credentials' table comment). This form does not
// call out to a device SDK yet, so an administrator enrolls the person on
// the physical device first and then transcribes the reference it
// produced -- not something typed from memory or invented at the desk.
export function BiometricTab({
  personId,
  personType,
  profile: initialProfile,
  credentials: initialCredentials,
  devices,
  canEnroll,
  canRevoke,
}: {
  personId: string;
  personType: "student" | "staff";
  profile: BiometricProfileRow | null;
  credentials: BiometricCredentialRow[];
  devices: BiometricDeviceOption[];
  canEnroll: boolean;
  canRevoke: boolean;
}) {
  const [profile, setProfile] = useState(initialProfile);
  const [credentials, setCredentials] = useState(initialCredentials);
  const [showForm, setShowForm] = useState(false);
  const [deviceId, setDeviceId] = useState(devices[0]?.id ?? "");
  const [credentialType, setCredentialType] = useState<"fingerprint" | "face">("fingerprint");
  const [reference, setReference] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  async function getSchoolUser() {
    const supabase = createClient();
    const { data: me } = await supabase.auth.getUser();
    const { data: schoolUser } = await supabase
      .from("school_users")
      .select("id, school_id")
      .eq("auth_user_id", me.user?.id)
      .maybeSingle();
    if (!schoolUser) throw new Error("Could not resolve your account.");
    return { supabase, schoolUser };
  }

  async function enableProfile() {
    setSaving(true);
    setError(null);
    try {
      const { supabase, schoolUser } = await getSchoolUser();
      const { data, error: insertError } = await supabase
        .from("biometric_profiles")
        .insert({
          school_id: schoolUser.school_id,
          person_type: personType,
          person_id: personId,
          status: "active",
          created_by: schoolUser.id,
        })
        .select("id, status")
        .single();
      if (insertError) throw insertError;
      setProfile(data as BiometricProfileRow);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not enable biometric enrollment.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleProfileStatus() {
    if (!profile) return;
    const nextStatus = profile.status === "active" ? "inactive" : "active";
    setSaving(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error: updateError } = await supabase.from("biometric_profiles").update({ status: nextStatus }).eq("id", profile.id);
      if (updateError) throw updateError;
      setProfile({ ...profile, status: nextStatus });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the profile status.");
    } finally {
      setSaving(false);
    }
  }

  async function enrollCredential() {
    if (!profile) return;
    if (!deviceId) {
      setError("Select which device this was enrolled on.");
      return;
    }
    if (!reference.trim()) {
      setError("Enter the reference ID the device produced during enrollment.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { supabase, schoolUser } = await getSchoolUser();
      const { data, error: insertError } = await supabase
        .from("biometric_credentials")
        .insert({
          school_id: schoolUser.school_id,
          profile_id: profile.id,
          credential_type: credentialType,
          device_id: deviceId,
          credential_reference: reference.trim(),
          enrolled_by: schoolUser.id,
        })
        .select("id, credential_type, provider, status, enrolled_at, revoked_at")
        .single();
      if (insertError) throw insertError;
      const device = devices.find((d) => d.id === deviceId);
      setCredentials((prev) => [{ ...(data as BiometricCredentialRow), device_name: device?.name ?? null }, ...prev]);
      setReference("");
      setShowForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the credential. It may already be registered on this device.");
    } finally {
      setSaving(false);
    }
  }

  async function revokeCredential(credentialId: string) {
    setRevokingId(credentialId);
    setError(null);
    try {
      const { supabase, schoolUser } = await getSchoolUser();
      const { error: updateError } = await supabase
        .from("biometric_credentials")
        .update({ status: "revoked", revoked_by: schoolUser.id, revoked_at: new Date().toISOString() })
        .eq("id", credentialId);
      if (updateError) throw updateError;
      setCredentials((prev) =>
        prev.map((c) => (c.id === credentialId ? { ...c, status: "revoked", revoked_at: new Date().toISOString() } : c)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not revoke the credential.");
    } finally {
      setRevokingId(null);
    }
  }

  if (!profile) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Not yet set up for biometric verification. Enabling this creates a biometric profile that credentials (fingerprint or
          face) can be enrolled against -- it does not store any biometric data itself.
        </p>
        {canEnroll ? (
          <Button size="sm" onClick={enableProfile} disabled={saving}>
            {saving ? "Enabling…" : "Enable biometric enrollment"}
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">You don&apos;t have permission to enable this.</p>
        )}
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    );
  }

  const activeCredentials = credentials.filter((c) => c.status === "active");
  const revokedCredentials = credentials.filter((c) => c.status === "revoked");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-md border border-border p-3">
        <div>
          <p className="text-sm font-medium">Biometric profile</p>
          <p className="text-xs text-muted-foreground">
            {profile.status === "active"
              ? "Active -- credentials enrolled below can be used to verify identity at a gate/device."
              : "Inactive -- no credential on this profile will verify, even if marked active below."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge tone={profile.status === "active" ? "success" : "neutral"} label={profile.status} />
          {canEnroll && (
            <Button size="sm" variant="outline" onClick={toggleProfileStatus} disabled={saving}>
              {profile.status === "active" ? "Deactivate" : "Reactivate"}
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-3">
        <p className="text-sm font-medium">Credentials</p>
        {activeCredentials.length === 0 && <p className="text-sm text-muted-foreground">No active credentials enrolled.</p>}
        {activeCredentials.map((c) => (
          <div key={c.id} className="flex items-center justify-between rounded-md border border-border p-3">
            <div>
              <p className="text-sm font-medium capitalize">{c.credential_type}</p>
              <p className="text-xs text-muted-foreground">
                {c.device_name ?? "Unknown device"} · enrolled {new Date(c.enrolled_at).toLocaleDateString()}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge tone="success" label="active" />
              {canRevoke && (
                <Button size="sm" variant="outline" onClick={() => revokeCredential(c.id)} disabled={revokingId === c.id}>
                  {revokingId === c.id ? "Revoking…" : "Revoke"}
                </Button>
              )}
            </div>
          </div>
        ))}

        {revokedCredentials.length > 0 && (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer select-none">{revokedCredentials.length} revoked credential(s)</summary>
            <div className="mt-2 space-y-2">
              {revokedCredentials.map((c) => (
                <div key={c.id} className="rounded-md border border-border p-2">
                  <p className="capitalize">
                    {c.credential_type} · {c.device_name ?? "Unknown device"}
                  </p>
                  <p>Revoked {c.revoked_at ? new Date(c.revoked_at).toLocaleDateString() : ""}</p>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>

      {canEnroll && !showForm && (
        <Button size="sm" variant="outline" onClick={() => setShowForm(true)} disabled={devices.length === 0}>
          {devices.length === 0 ? "No active devices registered" : "Enroll a credential"}
        </Button>
      )}

      {canEnroll && showForm && (
        <div className="space-y-3 rounded-md border border-border p-3">
          <div className="space-y-1.5">
            <Label>Device</Label>
            <Select value={deviceId} onValueChange={setDeviceId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {devices.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                    {d.location ? ` (${d.location})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select value={credentialType} onValueChange={(v) => setCredentialType(v as "fingerprint" | "face")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fingerprint">Fingerprint</SelectItem>
                <SelectItem value="face">Face</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bio_reference">Reference ID from the device</Label>
            <Input
              id="bio_reference"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="e.g. the template/slot ID the device displayed after enrollment"
            />
            <p className="text-xs text-muted-foreground">
              Enroll {personType === "student" ? "the student" : "the staff member"} on the physical device first, then enter the
              reference it produced. EduCore never stores the fingerprint or face itself.
            </p>
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="flex gap-2">
            <Button size="sm" onClick={enrollCredential} disabled={saving}>
              {saving ? "Saving…" : "Save credential"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowForm(false)} disabled={saving}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {error && !showForm && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
