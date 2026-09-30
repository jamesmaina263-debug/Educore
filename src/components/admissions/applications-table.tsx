"use client";

import { Suspense } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { type ColumnDef } from "@tanstack/react-table";
import { StatusBadge } from "@/components/status-badge";
import { DataTable } from "@/components/ui/data-table";
import { useServerTableParams } from "@/hooks/use-server-table-params";
import { ClaimApplicationButton } from "@/components/admissions/claim-application-button";
import { DeleteApplicationButton } from "@/components/admissions/delete-application-button";
import { useSchoolHref } from "@/components/app-shell/school-slug-context";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

type Tone = "success" | "warning" | "danger" | "info" | "neutral";

export interface ApplicationRow {
  id: string;
  application_number: string;
  full_name: string;
  source_label: string;
  status_tone: Tone;
  status_label: string;
  fee_structure_missing: boolean;
  fee_structure_warning_title: string | null;
  officer_name: string | null;
  is_assigned: boolean;
  submitted_label: string;
  /** Not enrolled/rejected/withdrawn -- there's still a real decision to claim ownership of. */
  can_claim: boolean;
  /** Mirrors the original page's gating: only rejected/withdrawn applications are hard-deletable. */
  can_delete: boolean;
}

type ClaimAction = (applicationId: string) => Promise<{ error: string } | { success: true }>;
type DeleteAction = (applicationId: string) => Promise<{ error: string } | { success: true }>;

const VIEW_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "enrolled", label: "Enrolled" },
  { value: "closed", label: "Rejected / Withdrawn" },
  { value: "all", label: "All applications" },
];

function columns(
  canReview: boolean,
  canWrite: boolean,
  claimAction: ClaimAction,
  deleteAction: DeleteAction,
  toHref: (href: string) => string,
): ColumnDef<ApplicationRow>[] {
  return [
    {
      accessorKey: "full_name",
      header: "Applicant",
      cell: ({ row }) => <span className="font-medium">{row.original.full_name}</span>,
    },
    {
      accessorKey: "application_number",
      header: "Reference",
      cell: ({ row }) => (
        <span className="font-mono text-[0.75rem] text-muted-foreground">{row.original.application_number}</span>
      ),
    },
    {
      accessorKey: "source_label",
      header: "Source",
      cell: ({ row }) => <span className="text-muted-foreground">{row.original.source_label}</span>,
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => {
        const r = row.original;
        return (
          <div className="flex items-center gap-1.5">
            <StatusBadge tone={r.status_tone} label={r.status_label} />
            {r.fee_structure_missing && (
              <span
                className="rounded-full border border-warning/25 bg-warning-subtle px-1.5 py-0.5 text-[0.625rem] font-medium text-warning"
                title={r.fee_structure_warning_title ?? undefined}
              >
                No fee structure
              </span>
            )}
          </div>
        );
      },
      enableSorting: false,
    },
    {
      accessorKey: "officer_name",
      header: "Assigned officer",
      cell: ({ row }) => <span className="text-muted-foreground">{row.original.officer_name ?? "Unassigned"}</span>,
    },
    {
      accessorKey: "submitted_label",
      header: "Submitted",
      cell: ({ row }) => <span className="text-muted-foreground">{row.original.submitted_label}</span>,
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => {
        const r = row.original;
        return (
          <div className="flex items-center justify-end gap-3">
            {canReview && (
              <Link href={toHref(`/admissions/${r.id}`)} className="text-[0.8125rem] font-medium text-primary hover:underline">
                Review
              </Link>
            )}
            {canWrite && r.can_claim && (
              <ClaimApplicationButton applicationId={r.id} isAssigned={r.is_assigned} claimAction={claimAction} />
            )}
            {canWrite && r.can_delete && (
              <DeleteApplicationButton applicationId={r.id} applicantLabel={r.full_name} deleteAction={deleteAction} />
            )}
          </div>
        );
      },
      enableSorting: false,
    },
  ];
}

/**
 * `rows` is one page's worth for the currently selected `view` (the server component already
 * ran the status filter + search + `.range()`) -- not every application the school has ever
 * received. See admissions/page.tsx. Previously this page fetched up to 200 applications of
 * every status (including terminal ones like enrolled/rejected) unfiltered and unpaginated, so
 * the queue kept "piling up" visually and silently truncated past 200 with no indication.
 */
function ApplicationsTableInner({
  rows,
  totalCount,
  pageSize,
  canReview,
  canWrite,
  claimAction,
  deleteAction,
}: {
  rows: ApplicationRow[];
  totalCount: number;
  pageSize: number;
  canReview: boolean;
  canWrite: boolean;
  claimAction: ClaimAction;
  deleteAction: DeleteAction;
}) {
  const router = useRouter();
  const toHref = useSchoolHref();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const manual = useServerTableParams({ totalCount, pageSize });

  const view = searchParams.get("view") ?? "active";

  function handleViewChange(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "active") params.delete("view");
    else params.set("view", value);
    // Changing the filter invalidates whatever page you were on.
    params.delete("page");
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Show</span>
        <Select value={view} onValueChange={handleViewChange}>
          <SelectTrigger className="h-8 w-52 text-[0.8125rem]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {VIEW_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <DataTable
        columns={columns(canReview, canWrite, claimAction, deleteAction, toHref)}
        data={rows}
        searchColumnId="full_name"
        searchPlaceholder="Search applicants by name or reference…"
        pageSize={pageSize}
        manual={manual}
      />
    </div>
  );
}

export function ApplicationsTable(props: {
  rows: ApplicationRow[];
  totalCount: number;
  pageSize: number;
  canReview: boolean;
  canWrite: boolean;
  claimAction: ClaimAction;
  deleteAction: DeleteAction;
}) {
  // useSearchParams requires a Suspense boundary around whatever reads it -- same pattern
  // already used by students-table.tsx / src/app/login/page.tsx.
  return (
    <Suspense fallback={null}>
      <ApplicationsTableInner {...props} />
    </Suspense>
  );
}
