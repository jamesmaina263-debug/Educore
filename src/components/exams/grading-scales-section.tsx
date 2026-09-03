"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { createGradingScale, setClassGradingScale } from "@/app/(app)/exams/actions";

export interface GradingScaleRow {
  id: string;
  name: string;
  model_type: "numeric" | "cbc";
  is_default: boolean;
  bands: { id: string; label: string; min_score: number | null; max_score: number | null; level_order: number }[];
}

export interface ClassRow {
  id: string;
  name: string;
  grading_scale_id: string | null;
}

type BandDraft = { label: string; min_score: string; max_score: string; points: string };

const emptyBand: BandDraft = { label: "", min_score: "", max_score: "", points: "" };

// KJSEA-aligned 8-level achievement scale, highest first. Same shape numeric grading_scales
// already supports (label/min/max/points) -- this is a preset that fills the existing form,
// not a new table. Percentage bands per the KJSEA-aligned scale; worth a final cross-check
// against KNEC's own published scale before relying on it for a real national submission.
const KJSEA_PRESET: BandDraft[] = [
  { label: "EE1", min_score: "90", max_score: "100", points: "8" },
  { label: "EE2", min_score: "75", max_score: "89", points: "7" },
  { label: "ME1", min_score: "58", max_score: "74", points: "6" },
  { label: "ME2", min_score: "41", max_score: "57", points: "5" },
  { label: "AE1", min_score: "31", max_score: "40", points: "4" },
  { label: "AE2", min_score: "21", max_score: "30", points: "3" },
  { label: "BE1", min_score: "11", max_score: "20", points: "2" },
  { label: "BE2", min_score: "1", max_score: "10", points: "1" },
];

export function GradingScalesSection({
  scales,
  classes,
  canWrite,
}: {
  scales: GradingScaleRow[];
  classes: ClassRow[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [name, setName] = useState("");
  const [modelType, setModelType] = useState<"numeric" | "cbc">("numeric");
  const [isDefault, setIsDefault] = useState(false);
  const [bands, setBands] = useState<BandDraft[]>([emptyBand, { ...emptyBand }]);

  function updateBand(index: number, patch: Partial<BandDraft>) {
    setBands((prev) => prev.map((b, i) => (i === index ? { ...b, ...patch } : b)));
  }

  async function handleCreate() {
    setPending(true);
    setError(null);
    const result = await createGradingScale({
      name,
      model_type: modelType,
      is_default: isDefault,
      bands: bands
        .filter((b) => b.label.trim() !== "")
        .map((b, i) => ({
          label: b.label,
          min_score: b.min_score === "" ? undefined : Number(b.min_score),
          max_score: b.max_score === "" ? undefined : Number(b.max_score),
          points: b.points === "" ? undefined : Number(b.points),
          level_order: i + 1,
        })),
    });
    setPending(false);
    if ("error" in result) return setError(result.error);
    setOpen(false);
    setName("");
    setModelType("numeric");
    setIsDefault(false);
    setBands([emptyBand, { ...emptyBand }]);
    router.refresh();
  }

  async function handleClassScaleChange(classId: string, scaleId: string) {
    await setClassGradingScale(classId, scaleId === "__default__" ? null : scaleId);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">{scales.length} grading scales configured</p>
          {canWrite && (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline">
                  New grading scale
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>New grading scale</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>Name</Label>
                      <Input
                        placeholder="Standard 8-4-4 Scale"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Model</Label>
                      <Select value={modelType} onValueChange={(v) => setModelType(v as "numeric" | "cbc")}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="numeric">Numeric / Percentage</SelectItem>
                          <SelectItem value="cbc">CBC Competency-Based</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Checkbox id="is_default" checked={isDefault} onCheckedChange={(c) => setIsDefault(c === true)} />
                    <Label htmlFor="is_default">Use as this school&apos;s default scale</Label>
                  </div>

                  <div className="space-y-2">
                    <Label>
                      {modelType === "numeric" ? "Bands (highest first)" : "Competency levels (highest first)"}
                    </Label>
                    {bands.map((b, i) => (
                      <div key={i} className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-2">
                        <Input
                          placeholder={modelType === "numeric" ? "A" : "Exceeding Expectation"}
                          value={b.label}
                          onChange={(e) => updateBand(i, { label: e.target.value })}
                        />
                        {modelType === "numeric" && (
                          <>
                            <Input
                              placeholder="Min"
                              type="number"
                              value={b.min_score}
                              onChange={(e) => updateBand(i, { min_score: e.target.value })}
                            />
                            <Input
                              placeholder="Max"
                              type="number"
                              value={b.max_score}
                              onChange={(e) => updateBand(i, { max_score: e.target.value })}
                            />
                            <Input
                              placeholder="Points"
                              type="number"
                              value={b.points}
                              onChange={(e) => updateBand(i, { points: e.target.value })}
                            />
                          </>
                        )}
                      </div>
                    ))}
                    <Button type="button" size="sm" variant="ghost" onClick={() => setBands((p) => [...p, { ...emptyBand }])}>
                      + Add {modelType === "numeric" ? "band" : "level"}
                    </Button>
                    {modelType === "numeric" && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setName((n) => (n.trim() === "" ? "KJSEA 8-Level Scale" : n));
                          setBands(KJSEA_PRESET.map((b) => ({ ...b })));
                        }}
                      >
                        Use KJSEA 8-level preset
                      </Button>
                    )}
                  </div>

                  {error && <p className="text-sm text-danger">{error}</p>}
                </div>
                <DialogFooter>
                  <Button
                    onClick={handleCreate}
                    disabled={
                      pending ||
                      !name.trim() ||
                      !bands.some((b) =>
                        b.label.trim() !== "" && (modelType === "cbc" || (b.min_score !== "" && b.max_score !== "")),
                      )
                    }
                  >
                    {pending ? "Creating…" : "Create scale"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>

        {scales.length === 0 ? (
          <div className="panel border-dashed p-6 text-center text-sm text-muted-foreground">
            No grading scales yet. A numeric or CBC scale must be configured before marks can be entered.
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {scales.map((scale) => (
              <div key={scale.id} className="panel p-4">
                <div className="mb-2 flex items-center gap-2">
                  <p className="font-medium">{scale.name}</p>
                  <StatusBadge
                    tone={scale.model_type === "cbc" ? "info" : "neutral"}
                    label={scale.model_type === "cbc" ? "CBC" : "Numeric"}
                  />
                  {scale.is_default && <StatusBadge tone="success" label="School default" />}
                </div>
                <div className="flex flex-wrap gap-2">
                  {scale.bands
                    .sort((a, b) => a.level_order - b.level_order)
                    .map((b) => (
                      <Badge key={b.id} variant="outline">
                        {b.label}
                        {b.min_score !== null && b.max_score !== null ? ` (${b.min_score}–${b.max_score})` : ""}
                      </Badge>
                    ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {scales.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">Class-level overrides</p>
          <p className="text-sm text-muted-foreground">
            Leave a class on &quot;School default&quot; unless that grade uses a different model — CBC grades
            typically need their own competency scale.
          </p>
          <div className="panel">
            <div className="overflow-x-auto">
              <Table className="table-dense">
                <TableHeader>
                  <TableRow>
                    <TableHead>Class</TableHead>
                    <TableHead>Grading scale</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {classes.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell>
                        {canWrite ? (
                          <Select
                            value={c.grading_scale_id ?? "__default__"}
                            onValueChange={(v) => handleClassScaleChange(c.id, v)}
                          >
                            <SelectTrigger className="w-56">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__default__">School default</SelectItem>
                              {scales.map((s) => (
                                <SelectItem key={s.id} value={s.id}>
                                  {s.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          scales.find((s) => s.id === c.grading_scale_id)?.name ?? "School default"
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
