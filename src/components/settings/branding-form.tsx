"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateBranding } from "@/app/settings/actions";

export interface BrandingData {
  name: string;
  motto: string | null;
  logo_url: string | null;
  primary_color: string | null;
}

export function BrandingForm({ initial, canWrite }: { initial: BrandingData; canWrite: boolean }) {
  const router = useRouter();
  const [form, setForm] = useState({
    name: initial.name,
    motto: initial.motto ?? "",
    logo_url: initial.logo_url ?? "",
    primary_color: initial.primary_color ?? "#2563EB",
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    setPending(true);
    setError(null);
    setSaved(false);
    const result = await updateBranding(form);
    setPending(false);
    if ("error" in result) return setError(result.error);
    setSaved(true);
    router.refresh();
  }

  return (
    <div className="max-w-md space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="school_name">School name</Label>
        <Input
          id="school_name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          disabled={!canWrite}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="motto">Motto (optional)</Label>
        <Input
          id="motto"
          value={form.motto}
          onChange={(e) => setForm({ ...form, motto: e.target.value })}
          disabled={!canWrite}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="logo_url">Logo URL (optional)</Label>
        <Input
          id="logo_url"
          placeholder="https://…"
          value={form.logo_url}
          onChange={(e) => setForm({ ...form, logo_url: e.target.value })}
          disabled={!canWrite}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="primary_color">Primary color</Label>
        <div className="flex items-center gap-2">
          <input
            id="primary_color"
            type="color"
            value={form.primary_color}
            onChange={(e) => setForm({ ...form, primary_color: e.target.value })}
            disabled={!canWrite}
            className="h-10 w-10 rounded border border-border"
          />
          <Input
            value={form.primary_color}
            onChange={(e) => setForm({ ...form, primary_color: e.target.value })}
            disabled={!canWrite}
            className="w-32"
          />
        </div>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}
      {saved && !error && <p className="text-sm text-success">Saved.</p>}

      {canWrite && (
        <Button onClick={handleSave} disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      )}
    </div>
  );
}
