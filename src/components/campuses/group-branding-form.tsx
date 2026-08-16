"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { updateGroupBranding } from "@/app/(app)/campuses/actions";

export interface GroupBrandingData {
  logo_url: string | null;
  primary_color: string | null;
  custom_domain: string | null;
  custom_domain_status: "pending" | "verified";
  whitelabel_enabled: boolean;
}

export function GroupBrandingForm({ initial }: { initial: GroupBrandingData }) {
  const router = useRouter();
  const [form, setForm] = useState({
    logo_url: initial.logo_url ?? "",
    primary_color: initial.primary_color ?? "#2563EB",
    custom_domain: initial.custom_domain ?? "",
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    setPending(true);
    setError(null);
    setSaved(false);
    const result = await updateGroupBranding(form);
    setPending(false);
    if ("error" in result) return setError(result.error);
    setSaved(true);
    router.refresh();
  }

  if (!initial.whitelabel_enabled) {
    return (
      <div className="panel max-w-md space-y-2 p-5">
        <p className="text-sm text-muted-foreground">
          White-labeling isn&apos;t enabled for your group yet. This is a Trimora-managed
          entitlement — reach out to Trimora to turn it on for your account.
        </p>
      </div>
    );
  }

  return (
    <div className="panel max-w-md space-y-4 p-5">
      <div className="flex items-center gap-2">
        <Badge>White-label enabled</Badge>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="group_logo_url">Group logo URL</Label>
        <Input
          id="group_logo_url"
          placeholder="https://…"
          value={form.logo_url}
          onChange={(e) => setForm({ ...form, logo_url: e.target.value })}
        />
        <p className="text-xs text-muted-foreground">
          Used across all campuses in this group unless a campus sets its own logo.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="group_primary_color">Primary color</Label>
        <div className="flex items-center gap-2">
          <input
            id="group_primary_color"
            type="color"
            value={form.primary_color}
            onChange={(e) => setForm({ ...form, primary_color: e.target.value })}
            className="h-10 w-10 rounded border border-border"
          />
          <Input
            value={form.primary_color}
            onChange={(e) => setForm({ ...form, primary_color: e.target.value })}
            className="w-32"
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="custom_domain">Custom domain</Label>
        <div className="flex items-center gap-2">
          <Input
            id="custom_domain"
            placeholder="portal.yourschoolgroup.ac.ke"
            value={form.custom_domain}
            onChange={(e) => setForm({ ...form, custom_domain: e.target.value })}
          />
          {initial.custom_domain && (
            <Badge variant={initial.custom_domain_status === "verified" ? "default" : "secondary"}>
              {initial.custom_domain_status === "verified" ? "Verified" : "Pending verification"}
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Saving a domain here records your request — Trimora still needs to verify DNS
          ownership and attach it on our side before it goes live. Changing the domain resets
          verification, since a new domain string means starting the ownership check over.
        </p>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}
      {saved && !error && <p className="text-sm text-success">Saved.</p>}

      <Button onClick={handleSave} disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
    </div>
  );
}
