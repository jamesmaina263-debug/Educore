"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { createFeatureFlag, setSchoolFeatureFlag, deleteFeatureFlag } from "@/app/(admin)/admin/feature-flags/actions";

export type FeatureFlagRow = { id: string; key: string; label: string; description: string | null };
export type FeatureFlagSchoolRow = { id: string; name: string };

function slugify(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function AdminFeatureFlagsPanel({
  flags,
  schools,
  enabledMap,
}: {
  flags: FeatureFlagRow[];
  schools: FeatureFlagSchoolRow[];
  /** Keyed as `${schoolId}:${flagId}` -- absence means off, same convention as the DB. */
  enabledMap: Record<string, boolean>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");

  function run(fn: () => Promise<{ error: string } | { success: true }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if ("error" in res) setError(res.error);
      else router.refresh();
    });
  }

  function submitNewFlag() {
    const key = slugify(label);
    run(async () => {
      const res = await createFeatureFlag(key, label, description);
      if (!("error" in res)) {
        setLabel("");
        setDescription("");
      }
      return res;
    });
  }

  const key = slugify(label);

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      <div className="panel flex flex-col gap-3 p-4">
        <h2 className="text-sm font-semibold">New flag</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Input placeholder="Label (e.g. CBC Pilot)" value={label} onChange={(e) => setLabel(e.target.value)} />
            {label.trim() && <p className="text-xs text-muted-foreground">Key: {key || "—"}</p>}
          </div>
          <Textarea
            placeholder="What this flag gates (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={1}
          />
        </div>
        <div>
          <Button size="sm" disabled={pending || !label.trim()} onClick={submitNewFlag}>
            Add flag
          </Button>
        </div>
      </div>

      {flags.length === 0 ? (
        <p className="panel p-4 text-sm text-muted-foreground">
          No flags defined yet. Add one above, then toggle it per school below.
        </p>
      ) : schools.length === 0 ? (
        <p className="panel p-4 text-sm text-muted-foreground">No schools to toggle flags for yet.</p>
      ) : (
        <div className="panel overflow-x-auto">
          <table className="table-dense w-full">
            <thead className="bg-muted/70">
              <tr>
                <th>Flag</th>
                {schools.map((s) => (
                  <th key={s.id}>{s.name}</th>
                ))}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {flags.map((flag) => (
                <tr key={flag.id}>
                  <td>
                    <p className="font-medium">{flag.label}</p>
                    <p className="text-xs text-muted-foreground">{flag.key}</p>
                    {flag.description && <p className="mt-0.5 text-xs text-muted-foreground">{flag.description}</p>}
                  </td>
                  {schools.map((school) => {
                    const enabled = enabledMap[`${school.id}:${flag.id}`] === true;
                    return (
                      <td key={school.id}>
                        <div className="flex items-center gap-2">
                          <StatusBadge tone={enabled ? "success" : "neutral"} label={enabled ? "On" : "Off"} />
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={pending}
                            onClick={() => run(() => setSchoolFeatureFlag(school.id, flag.id, !enabled))}
                          >
                            {enabled ? "Turn off" : "Turn on"}
                          </Button>
                        </div>
                      </td>
                    );
                  })}
                  <td>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      title="Delete flag (removes it for every school)"
                      onClick={() => {
                        if (confirm(`Delete flag "${flag.label}"? This removes it for every school.`)) {
                          run(() => deleteFeatureFlag(flag.id));
                        }
                      }}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
