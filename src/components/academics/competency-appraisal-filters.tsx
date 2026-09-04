"use client";

import { useRouter } from "next/navigation";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem, SelectGroup, SelectLabel } from "@/components/ui/select";
import { TYPE_LABEL, type StreamOption, type TermOption, type IndicatorOption } from "@/lib/academics/competency-appraisal-types";

export function CompetencyAppraisalFilters({
  streamOptions,
  termOptions,
  indicatorOptions,
  selectedStreamId,
  selectedTermId,
  selectedIndicatorId,
}: {
  streamOptions: StreamOption[];
  termOptions: TermOption[];
  indicatorOptions: IndicatorOption[];
  selectedStreamId: string;
  selectedTermId: string;
  selectedIndicatorId: string;
}) {
  const router = useRouter();

  function go(next: { stream?: string; term?: string; indicator?: string }) {
    const params = new URLSearchParams({
      stream: next.stream ?? selectedStreamId,
      term: next.term ?? selectedTermId,
      indicator: next.indicator ?? selectedIndicatorId,
    });
    router.push(`/academics/competency-appraisal?${params.toString()}`);
  }

  const grouped = (["core_competency", "value", "pci", "school_authored"] as const).map((type) => ({
    type,
    items: indicatorOptions.filter((i) => i.type === type),
  }));

  return (
    <div className="flex flex-wrap items-center gap-2">
      {streamOptions.length > 1 && (
        <Select value={selectedStreamId} onValueChange={(v) => go({ stream: v })}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {streamOptions.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <Select value={selectedTermId} onValueChange={(v) => go({ term: v })}>
        <SelectTrigger className="w-56">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {termOptions.map((t) => (
            <SelectItem key={t.id} value={t.id}>
              {t.label}
              {t.status === "closed" ? " (closed)" : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={selectedIndicatorId} onValueChange={(v) => go({ indicator: v })}>
        <SelectTrigger className="w-64">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {grouped.map(
            (g) =>
              g.items.length > 0 && (
                <SelectGroup key={g.type}>
                  <SelectLabel>{TYPE_LABEL[g.type]}</SelectLabel>
                  {g.items.map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ),
          )}
        </SelectContent>
      </Select>
    </div>
  );
}
