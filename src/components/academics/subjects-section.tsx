"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusBadge } from "@/components/status-badge";
import { activateSubjects, deactivateSubject } from "@/app/(app)/academics/actions";

export interface SubjectRow {
  id: string;
  catalogue_id: string;
  name: string;
  code: string | null;
  is_core: boolean;
  is_active: boolean;
}

export interface CatalogueSubjectRow {
  id: string;
  pathway: string;
  category: string;
  name: string;
  code: string | null;
  is_core: boolean;
  display_order: number;
}

const PATHWAY_ORDER = ["Core", "STEM", "Social Sciences", "Arts & Sports Science"];

export function SubjectsSection({
  subjects,
  catalogue,
  canWrite,
}: {
  subjects: SubjectRow[];
  catalogue: CatalogueSubjectRow[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null); // catalogue_id or subject_id currently in flight
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const activeByCatalogueId = useMemo(() => {
    const map = new Map<string, SubjectRow>();
    for (const s of subjects) map.set(s.catalogue_id, s);
    return map;
  }, [subjects]);

  const activeCount = subjects.filter((s) => s.is_active).length;

  const grouped = useMemo(() => {
    const byPathway = new Map<string, Map<string, CatalogueSubjectRow[]>>();
    for (const c of catalogue) {
      if (!byPathway.has(c.pathway)) byPathway.set(c.pathway, new Map());
      const byCategory = byPathway.get(c.pathway)!;
      if (!byCategory.has(c.category)) byCategory.set(c.category, []);
      byCategory.get(c.category)!.push(c);
    }
    return PATHWAY_ORDER.filter((p) => byPathway.has(p)).map((pathway) => ({
      pathway,
      categories: Array.from(byPathway.get(pathway)!.entries()).map(([category, items]) => ({
        category,
        items: items.sort((a, b) => a.display_order - b.display_order),
      })),
    }));
  }, [catalogue]);

  function toggleSelected(catalogueId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(catalogueId)) next.delete(catalogueId);
      else next.add(catalogueId);
      return next;
    });
  }

  async function handleActivateSelected() {
    if (selected.size === 0) return;
    setPending("bulk");
    setError(null);
    const result = await activateSubjects(Array.from(selected));
    setPending(null);
    if ("error" in result) return setError(result.error);
    setSelected(new Set());
    router.refresh();
  }

  async function handleToggle(catalogueRow: CatalogueSubjectRow) {
    setError(null);
    const existing = activeByCatalogueId.get(catalogueRow.id);
    if (existing?.is_active) {
      setPending(existing.id);
      const result = await deactivateSubject(existing.id);
      setPending(null);
      if ("error" in result) return setError(result.error);
    } else {
      setPending(catalogueRow.id);
      const result = await activateSubjects([catalogueRow.id]);
      setPending(null);
      if ("error" in result) return setError(result.error);
    }
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="panel">
        <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <div>
            <h2 className="text-[0.8125rem] font-semibold">Subjects</h2>
            <p className="text-[0.6875rem] text-muted-foreground">
              Kenyan CBC/CBE Senior School master catalogue — activate the subjects this school offers.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[0.6875rem] text-muted-foreground">
              {activeCount} active of {catalogue.length}
            </span>
            {canWrite && selected.size > 0 && (
              <Button size="sm" onClick={handleActivateSelected} disabled={pending === "bulk"}>
                {pending === "bulk" ? "Activating…" : `Activate ${selected.size} selected`}
              </Button>
            )}
          </div>
        </header>
        {error && <p className="px-4 pt-3 text-sm text-danger">{error}</p>}

        {catalogue.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">
            The master subject catalogue hasn&apos;t been loaded yet — contact support.
          </p>
        ) : (
          <div className="divide-y divide-border">
            {grouped.map(({ pathway, categories }) => (
              <div key={pathway} className="px-4 py-3">
                <h3 className="mb-2 text-[0.75rem] font-semibold text-foreground">{pathway}</h3>
                <div className="space-y-3">
                  {categories.map(({ category, items }) => (
                    <div key={category}>
                      <p className="mb-1.5 text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">
                        {category}
                      </p>
                      <div className="overflow-x-auto">
                        <table className="table-dense w-full">
                          <tbody>
                            {items.map((c) => {
                              const activated = activeByCatalogueId.get(c.id);
                              const isActive = activated?.is_active ?? false;
                              const rowPending = pending === c.id || pending === activated?.id;
                              return (
                                <tr key={c.id}>
                                  {canWrite && (
                                    <td className="w-8">
                                      {!isActive && (
                                        <Checkbox
                                          checked={selected.has(c.id)}
                                          onCheckedChange={() => toggleSelected(c.id)}
                                        />
                                      )}
                                    </td>
                                  )}
                                  <td className="font-medium">{c.name}</td>
                                  <td className="text-muted-foreground">{c.code ?? "—"}</td>
                                  <td>
                                    {c.is_core && <StatusBadge tone="info" label="Core" />}
                                  </td>
                                  <td>
                                    <StatusBadge
                                      tone={isActive ? "success" : "neutral"}
                                      label={isActive ? "Active" : "Not offered"}
                                    />
                                  </td>
                                  {canWrite && (
                                    <td className="text-right">
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        disabled={rowPending}
                                        onClick={() => handleToggle(c)}
                                      >
                                        {rowPending ? "…" : isActive ? "Deactivate" : "Activate"}
                                      </Button>
                                    </td>
                                  )}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
