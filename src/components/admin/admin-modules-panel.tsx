"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { StatusBadge } from "@/components/status-badge";
import { cn } from "@/lib/utils";
import { setSchoolModule } from "@/app/(admin)/admin/modules/actions";

export type ModuleRow = { id: string; key: string; label: string; description: string | null; is_core: boolean };
export type ModuleSchoolRow = { id: string; name: string; slug: string; status: string };
export type ModuleOverride = { enabled: boolean; updatedAt: string | null; updatedByName: string | null };

function formatWhen(iso: string | null): string {
  if (!iso) return "";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

// Two views on the same data, not two data sets: "By school" answers "what does School X have
// on/off", the question an admin asks when onboarding or adjusting one school -- the common
// case at any scale. "Overview" answers "which schools have Module Y off", which used to mean
// scanning a module-rows x school-columns table that only worked while both axes were small
// (see the old version of this file). Listing just the exceptions (schools that are OFF -- most
// schools stay on the opt-out default) instead of rendering every cell for every school means
// this never gets slower as schools grow, whether there are 2 schools or 200.
export function AdminModulesPanel({
  modules,
  schools,
  overrideMap,
}: {
  modules: ModuleRow[];
  schools: ModuleSchoolRow[];
  /** Keyed as `${schoolId}:${moduleId}` -- absence means enabled. */
  overrideMap: Record<string, ModuleOverride>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [schoolQuery, setSchoolQuery] = useState("");
  const [selectedSchoolId, setSelectedSchoolId] = useState<string | null>(schools[0]?.id ?? null);
  const [overviewQuery, setOverviewQuery] = useState("");
  // Confirmation only guards turning a module OFF -- narrowing a live school's access is the
  // direction that can surprise their staff; turning it back on is always safe to do instantly.
  const [confirmTarget, setConfirmTarget] = useState<{ school: ModuleSchoolRow; mod: ModuleRow } | null>(null);

  const optionalModules = useMemo(() => modules.filter((m) => !m.is_core), [modules]);
  const coreModules = useMemo(() => modules.filter((m) => m.is_core), [modules]);

  const filteredSchools = useMemo(() => {
    const q = schoolQuery.trim().toLowerCase();
    if (!q) return schools;
    return schools.filter((s) => s.name.toLowerCase().includes(q) || s.slug.toLowerCase().includes(q));
  }, [schools, schoolQuery]);

  const selectedSchool = useMemo(
    () => schools.find((s) => s.id === selectedSchoolId) ?? filteredSchools[0] ?? null,
    [schools, selectedSchoolId, filteredSchools],
  );

  // For each optional module, only the schools currently overridden to OFF -- see the comment
  // on the component above for why this beats a full matrix at scale.
  const offByModule = useMemo(() => {
    const schoolById = new Map(schools.map((s) => [s.id, s]));
    return optionalModules.map((mod) => {
      const offSchools = schools
        .filter((s) => overrideMap[`${s.id}:${mod.id}`]?.enabled === false)
        .map((s) => ({ school: s, override: overrideMap[`${s.id}:${mod.id}`] }));
      return { mod, offSchools, schoolById };
    });
  }, [optionalModules, schools, overrideMap]);

  const filteredOffByModule = useMemo(() => {
    const q = overviewQuery.trim().toLowerCase();
    if (!q) return offByModule;
    return offByModule
      .filter(({ mod }) => mod.label.toLowerCase().includes(q) || mod.key.toLowerCase().includes(q))
      .concat(
        offByModule.filter(
          ({ mod, offSchools }) =>
            !mod.label.toLowerCase().includes(q) &&
            !mod.key.toLowerCase().includes(q) &&
            offSchools.some((o) => o.school.name.toLowerCase().includes(q)),
        ),
      );
  }, [offByModule, overviewQuery]);

  function run(fn: () => Promise<{ error: string } | { success: true }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if ("error" in res) setError(res.error);
      else router.refresh();
    });
  }

  function toggle(school: ModuleSchoolRow, mod: ModuleRow, nextEnabled: boolean) {
    if (!nextEnabled) {
      setConfirmTarget({ school, mod });
      return;
    }
    run(() => setSchoolModule(school.id, mod.id, true));
  }

  function confirmTurnOff() {
    if (!confirmTarget) return;
    const { school, mod } = confirmTarget;
    run(async () => {
      const res = await setSchoolModule(school.id, mod.id, false);
      if (!("error" in res)) setConfirmTarget(null);
      return res;
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

      <Tabs defaultValue="by-school">
        <TabsList>
          <TabsTrigger value="by-school">By school</TabsTrigger>
          <TabsTrigger value="overview">Overview</TabsTrigger>
        </TabsList>

        <TabsContent value="by-school">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-[280px_1fr]">
            <div className="flex flex-col gap-2">
              <Input
                placeholder="Search schools..."
                value={schoolQuery}
                onChange={(e) => setSchoolQuery(e.target.value)}
              />
              <div className="panel flex max-h-[520px] flex-col overflow-y-auto">
                {filteredSchools.length === 0 ? (
                  <p className="p-3 text-sm text-muted-foreground">No schools match &quot;{schoolQuery}&quot;.</p>
                ) : (
                  filteredSchools.map((school) => (
                    <button
                      key={school.id}
                      type="button"
                      onClick={() => setSelectedSchoolId(school.id)}
                      className={cn(
                        "flex flex-col gap-0.5 border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted/60",
                        selectedSchool?.id === school.id && "bg-muted",
                      )}
                    >
                      <span className="font-medium">{school.name}</span>
                      <span className="text-xs text-muted-foreground">/{school.slug}</span>
                    </button>
                  ))
                )}
              </div>
            </div>

            <div className="panel flex flex-col gap-3 p-4">
              {!selectedSchool ? (
                <p className="text-sm text-muted-foreground">Pick a school to see its modules.</p>
              ) : (
                <>
                  <div>
                    <h2 className="text-base font-semibold">{selectedSchool.name}</h2>
                    <p className="text-xs text-muted-foreground">/{selectedSchool.slug}</p>
                  </div>
                  <div className="flex flex-col divide-y">
                    {optionalModules.map((mod) => {
                      const override = overrideMap[`${selectedSchool.id}:${mod.id}`];
                      const enabled = override?.enabled !== false;
                      return (
                        <div key={mod.id} className="flex items-center justify-between gap-3 py-2.5">
                          <div className="min-w-0">
                            <p className="text-sm font-medium">{mod.label}</p>
                            {mod.description && <p className="text-xs text-muted-foreground">{mod.description}</p>}
                            {override && (
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                Changed {formatWhen(override.updatedAt)}
                                {override.updatedByName ? ` by ${override.updatedByName}` : ""}
                              </p>
                            )}
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <StatusBadge tone={enabled ? "success" : "warning"} label={enabled ? "On" : "Off"} />
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={pending}
                              onClick={() => toggle(selectedSchool, mod, !enabled)}
                            >
                              {enabled ? "Turn off" : "Turn on"}
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                    {coreModules.map((mod) => (
                      <div key={mod.id} className="flex items-center justify-between gap-3 py-2.5">
                        <p className="text-sm font-medium text-muted-foreground">{mod.label}</p>
                        <StatusBadge tone="neutral" label="Always on" />
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="overview">
          <div className="flex flex-col gap-3">
            <Input
              placeholder="Search by module or school..."
              value={overviewQuery}
              onChange={(e) => setOverviewQuery(e.target.value)}
            />
            <div className="flex flex-col gap-3">
              {filteredOffByModule.map(({ mod, offSchools }) => (
                <div key={mod.id} className="panel p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold">{mod.label}</p>
                      {mod.description && <p className="text-xs text-muted-foreground">{mod.description}</p>}
                    </div>
                    <StatusBadge
                      tone={offSchools.length === 0 ? "success" : "warning"}
                      label={offSchools.length === 0 ? "On for every school" : `Off for ${offSchools.length}`}
                    />
                  </div>
                  {offSchools.length > 0 && (
                    <div className="mt-2 flex flex-col divide-y border-t">
                      {offSchools.map(({ school, override }) => (
                        <div key={school.id} className="flex items-center justify-between gap-3 py-2">
                          <div>
                            <p className="text-sm">{school.name}</p>
                            <p className="text-xs text-muted-foreground">
                              Changed {formatWhen(override?.updatedAt ?? null)}
                              {override?.updatedByName ? ` by ${override.updatedByName}` : ""}
                            </p>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={pending}
                            onClick={() => run(() => setSchoolModule(school.id, mod.id, true))}
                          >
                            Turn on
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={confirmTarget !== null} onOpenChange={(open) => !open && setConfirmTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Turn off {confirmTarget?.mod.label}?</DialogTitle>
            <DialogDescription>
              Staff at {confirmTarget?.school.name} immediately lose access to this module -- the
              sidebar link disappears and the pages 404. Reverse it any time with Turn on.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmTarget(null)} disabled={pending}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmTurnOff} disabled={pending}>
              Turn off
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
