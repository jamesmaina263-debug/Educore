"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusBadge } from "@/components/status-badge";
import { cn } from "@/lib/utils";

export interface SchoolListRow {
  id: string;
  name: string;
  slug: string;
  status: "trial" | "active" | "suspended" | "cancelled";
  student_count: number;
  staff_count: number;
  plan_name: string | null;
}

const STATUS_TONE: Record<SchoolListRow["status"], "success" | "warning" | "danger" | "neutral"> = {
  active: "success",
  trial: "warning",
  suspended: "danger",
  cancelled: "neutral",
};

type FilterKey = "all" | "active" | "suspended";

export function AdminSchoolList({ schools }: { schools: SchoolListRow[] }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return schools.filter((s) => {
      if (filter === "active" && s.status !== "active") return false;
      if (filter === "suspended" && s.status !== "suspended") return false;
      if (q && !s.name.toLowerCase().includes(q) && !s.slug.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [schools, query, filter]);

  return (
    <div className="flex flex-col gap-3">
      <Input
        placeholder="Search schools..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <Tabs value={filter} onValueChange={(v) => setFilter(v as FilterKey)}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="active">Active</TabsTrigger>
          <TabsTrigger value="suspended">Suspended</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="flex flex-col gap-2">
        {filtered.length === 0 ? (
          <p className="panel p-4 text-sm text-muted-foreground">No schools match this filter.</p>
        ) : (
          filtered.map((school) => (
            <div key={school.id} className="panel-interactive flex items-center justify-between gap-3 p-4">
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    "flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold uppercase",
                  )}
                >
                  {school.name.slice(0, 1)}
                </div>
                <div>
                  <p className="text-sm font-semibold">{school.name}</p>
                  <p className="text-xs text-muted-foreground">/{school.slug}</p>
                  <p className="text-xs text-muted-foreground">
                    {school.student_count} student{school.student_count === 1 ? "" : "s"} ·{" "}
                    {school.staff_count} staff
                  </p>
                </div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <StatusBadge tone={STATUS_TONE[school.status]} label={school.status} />
                <span className="text-xs text-muted-foreground">{school.plan_name ?? "No plan"}</span>
                <Link
                  href="/admin/billing"
                  className="flex items-center gap-0.5 text-xs text-primary hover:underline"
                >
                  Manage <ArrowRight className="size-3" />
                </Link>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
