"use client";

import { useRouter, usePathname } from "next/navigation";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface TermOption {
  id: string;
  name: string;
}

export interface StreamOption {
  id: string;
  name: string;
}

export interface CampusOption {
  id: string;
  name: string;
}

export function ReportsFilterBar({
  terms,
  streams,
  campuses,
  selectedTermId,
  selectedStreamId,
  selectedCampusId,
  from,
  to,
}: {
  terms: TermOption[];
  streams: StreamOption[];
  campuses?: CampusOption[];
  selectedTermId: string;
  selectedStreamId: string;
  selectedCampusId?: string;
  from: string;
  to: string;
}) {
  const router = useRouter();
  const pathname = usePathname();

  function setParam(key: string, value: string) {
    const params = new URLSearchParams({
      term: selectedTermId,
      stream: selectedStreamId,
      from,
      to,
      ...(selectedCampusId ? { campus: selectedCampusId } : {}),
    });
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="panel flex flex-wrap items-end gap-4 px-4 py-3">
      {campuses && campuses.length > 0 && (
        <div className="flex flex-col gap-1">
          <Label className="label-eyebrow">Campus</Label>
          <Select value={selectedCampusId || "all"} onValueChange={(v) => setParam("campus", v === "all" ? "" : v)}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All campuses</SelectItem>
              {campuses.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="flex flex-col gap-1">
        <Label className="label-eyebrow">Term</Label>
        <Select value={selectedTermId || "all"} onValueChange={(v) => setParam("term", v === "all" ? "" : v)}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All terms</SelectItem>
            {terms.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        <Label className="label-eyebrow">Class / stream</Label>
        <Select value={selectedStreamId || "all"} onValueChange={(v) => setParam("stream", v === "all" ? "" : v)}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All classes</SelectItem>
            {streams.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        <Label className="label-eyebrow">From</Label>
        <Input type="date" defaultValue={from} className="w-40" onChange={(e) => setParam("from", e.target.value)} />
      </div>
      <div className="flex flex-col gap-1">
        <Label className="label-eyebrow">To</Label>
        <Input type="date" defaultValue={to} className="w-40" onChange={(e) => setParam("to", e.target.value)} />
      </div>
    </div>
  );
}
