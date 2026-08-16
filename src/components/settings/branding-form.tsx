"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { updateBranding } from "@/app/(app)/settings/actions";

// Platform default, used only when neither the school nor its group has set a value.
const PLATFORM_DEFAULT_LOGO_URL = "/branding/educore-default-logo.svg";
const PLATFORM_DEFAULT_COLOR = "#2563EB";

type BrandingSource = "school" | "group" | "platform";

function resolveSource(
  schoolValue: string | null,
  groupValue: string | null | undefined
): BrandingSource {
  if (schoolValue) return "school";
  if (groupValue) return "group";
  return "platform";
}

function SourceBadge({ source }: { source: BrandingSource }) {
  if (source === "school") return null; // an active override doesn't need a badge
  return (
    <Badge variant="secondary" className="text-xs">
      {source === "group" ? "Inherited from group" : "Platform default"}
    </Badge>
  );
}

export interface BrandingData {
  name: string;
  motto: string | null;
  logo_url: string | null;
  primary_color: string | null;
}

export function BrandingForm({
  initial,
  canWrite,
  groupFallback = null,
}: {
  initial: BrandingData;
  canWrite: boolean;
  groupFallback?: { logo_url: string | null; primary_color: string | null } | null;
}) {
  const router = useRouter();
  // form.logo_url / form.primary_color hold the RAW override (may be blank — blank means
  // "inherit"). We resolve what's actually shown/saved-as-fallback separately below, so the
  // input can stay blank while the placeholder shows what it'll fall back to.
  const [form, setForm] = useState({
    name: initial.name,
    motto: initial.motto ?? "",
    logo_url: initial.logo_url ?? "",
    primary_color: initial.primary_color ?? "",
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const logoSource = resolveSource(initial.logo_url, groupFallback?.logo_url);
  const colorSource = resolveSource(initial.primary_color, groupFallback?.primary_color);
  const logoFallbackValue = groupFallback?.logo_url || PLATFORM_DEFAULT_LOGO_URL;
  const colorFallbackValue = groupFallback?.primary_color || PLATFORM_DEFAULT_COLOR;
  const resolvedColor = form.primary_color || colorFallbackValue;

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
    <div className="panel max-w-md space-y-4 p-5">
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
        <div className="flex items-center justify-between">
          <Label htmlFor="logo_url">Logo URL (optional)</Label>
          <SourceBadge source={logoSource} />
        </div>
        <Input
          id="logo_url"
          placeholder={logoFallbackValue}
          value={form.logo_url}
          onChange={(e) => setForm({ ...form, logo_url: e.target.value })}
          disabled={!canWrite}
        />
        {form.logo_url && canWrite && (
          <button
            type="button"
            onClick={() => setForm({ ...form, logo_url: "" })}
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Clear — revert to {groupFallback?.logo_url ? "group logo" : "platform default"}
          </button>
        )}
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="primary_color">Primary color</Label>
          <SourceBadge source={colorSource} />
        </div>
        <div className="flex items-center gap-2">
          <input
            id="primary_color"
            type="color"
            value={resolvedColor}
            onChange={(e) => setForm({ ...form, primary_color: e.target.value })}
            disabled={!canWrite}
            className="h-10 w-10 rounded border border-border"
          />
          <Input
            placeholder={colorFallbackValue}
            value={form.primary_color}
            onChange={(e) => setForm({ ...form, primary_color: e.target.value })}
            disabled={!canWrite}
            className="w-32"
          />
        </div>
        {form.primary_color && canWrite && (
          <button
            type="button"
            onClick={() => setForm({ ...form, primary_color: "" })}
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Clear — revert to {groupFallback?.primary_color ? "group color" : "platform default"}
          </button>
        )}
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
