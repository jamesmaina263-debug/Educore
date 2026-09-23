"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { setSchoolModule } from "@/app/(admin)/admin/modules/actions";

export type ModuleRow = { id: string; key: string; label: string; description: string | null; is_core: boolean };
export type ModuleSchoolRow = { id: string; name: string };

export function AdminModulesPanel({
  modules,
  schools,
  enabledMap,
}: {
  modules: ModuleRow[];
  schools: ModuleSchoolRow[];
  /** Keyed as `${schoolId}:${moduleId}` -- absence means enabled, opposite of the feature-flags convention. */
  enabledMap: Record<string, boolean>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<{ error: string } | { success: true }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if ("error" in res) setError(res.error);
      else router.refresh();
    });
  }

  if (schools.length === 0) {
    return <p className="panel p-4 text-sm text-muted-foreground">No schools to toggle modules for yet.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="panel overflow-x-auto">
        <table className="table-dense w-full">
          <thead className="bg-muted/70">
            <tr>
              <th>Module</th>
              {schools.map((s) => (
                <th key={s.id}>{s.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {modules.map((mod) => (
              <tr key={mod.id}>
                <td>
                  <p className="font-medium">{mod.label}</p>
                  <p className="text-xs text-muted-foreground">{mod.key}</p>
                  {mod.description && <p className="mt-0.5 text-xs text-muted-foreground">{mod.description}</p>}
                </td>
                {schools.map((school) => {
                  if (mod.is_core) {
                    return (
                      <td key={school.id}>
                        <StatusBadge tone="neutral" label="Always on" />
                      </td>
                    );
                  }
                  const enabled = enabledMap[`${school.id}:${mod.id}`] !== false;
                  return (
                    <td key={school.id}>
                      <div className="flex items-center gap-2">
                        <StatusBadge tone={enabled ? "success" : "warning"} label={enabled ? "On" : "Off"} />
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={pending}
                          onClick={() => run(() => setSchoolModule(school.id, mod.id, !enabled))}
                        >
                          {enabled ? "Turn off" : "Turn on"}
                        </Button>
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
