"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { type ColumnDef } from "@tanstack/react-table";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { StatusBadge } from "@/components/status-badge";
import { DataTable } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";

export interface ParentRow {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  status: string;
  children: string[];
}

type ActionResult = { error: string } | { success: true };
type DeleteGuardianAction = (guardianId: string) => Promise<ActionResult>;
type MergeGuardianAction = (keepId: string, duplicateId: string) => Promise<ActionResult>;

function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function DeleteGuardianButton({ row, deleteAction }: { row: ParentRow; deleteAction: DeleteGuardianAction }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleConfirm() {
    setError(null);
    startTransition(async () => {
      const result = await deleteAction(row.id);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[0.8125rem] font-medium text-danger hover:underline"
      >
        Delete
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Permanently delete {row.full_name}&apos;s account?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This permanently deletes {row.full_name}&apos;s parent account, login, and personal details. This
            can&apos;t be undone.
            {row.children.length > 0 && (
              <>
                {" "}
                <span className="font-medium text-danger">
                  This will also unlink them from {row.children.join(", ")} — do this only if the account is a
                  mistake or duplicate, not to remove a real parent of an enrolled student. If it&apos;s a duplicate
                  account, Merge keeps their history instead of losing it.
                </span>
              </>
            )}
          </p>
          {error && <p className="text-sm text-danger">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={handleConfirm} disabled={pending}>
              {pending ? "Deleting…" : "Delete permanently"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function MergeGuardianButton({
  row,
  otherRows,
  mergeAction,
}: {
  row: ParentRow;
  otherRows: ParentRow[];
  mergeAction: MergeGuardianAction;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [keepId, setKeepId] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const keeper = otherRows.find((r) => r.id === keepId);

  function handleConfirm() {
    if (!keepId) return;
    setError(null);
    startTransition(async () => {
      const result = await mergeAction(keepId, row.id);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setOpen(false);
      setKeepId(undefined);
      router.refresh();
    });
  }

  if (otherRows.length === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="ml-3 text-[0.8125rem] font-medium text-muted-foreground hover:text-foreground hover:underline"
      >
        Merge
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Merge {row.full_name}&apos;s account into another parent</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Use this when the same parent has two accounts by mistake. Pick the account to keep — every child,
            booking, application, and notification history on {row.full_name}&apos;s account moves onto it, then{" "}
            {row.full_name}&apos;s duplicate account is permanently deleted.
          </p>
          <Select value={keepId} onValueChange={setKeepId}>
            <SelectTrigger>
              <SelectValue placeholder="Select the account to keep…" />
            </SelectTrigger>
            <SelectContent>
              {otherRows.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.full_name}
                  {r.children.length > 0 ? ` (${r.children.join(", ")})` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {keeper && (
            <p className="text-sm font-medium text-danger">
              {row.full_name}&apos;s account will be deleted; {keeper.full_name} will keep everything.
            </p>
          )}
          {error && <p className="text-sm text-danger">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={handleConfirm} disabled={pending || !keepId}>
              {pending ? "Merging…" : "Merge accounts"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function buildColumns(
  rows: ParentRow[],
  canDelete: boolean,
  deleteAction?: DeleteGuardianAction,
  mergeAction?: MergeGuardianAction,
): ColumnDef<ParentRow>[] {
  const columns: ColumnDef<ParentRow>[] = [
    {
      accessorKey: "full_name",
      header: "Name",
      cell: ({ row }) => (
        <div className="flex items-center gap-2.5">
          <Avatar className="size-7">
            <AvatarFallback className="text-xs">{initials(row.original.full_name)}</AvatarFallback>
          </Avatar>
          <span className="font-medium">{row.original.full_name}</span>
        </div>
      ),
    },
    {
      id: "children",
      header: "Children",
      cell: ({ row }) =>
        row.original.children.length > 0 ? (
          row.original.children.join(", ")
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      accessorKey: "email",
      header: "Email",
      cell: ({ row }) => row.original.email ?? <span className="text-muted-foreground">—</span>,
    },
    {
      accessorKey: "phone",
      header: "Phone",
      cell: ({ row }) => row.original.phone ?? <span className="text-muted-foreground">—</span>,
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => {
        const status = row.original.status;
        const tone = status === "active" ? "success" : status === "suspended" ? "danger" : "neutral";
        return <StatusBadge tone={tone} label={status} />;
      },
    },
  ];

  if (canDelete && deleteAction) {
    columns.push({
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <div className="flex items-center">
          <DeleteGuardianButton row={row.original} deleteAction={deleteAction} />
          {mergeAction && (
            <MergeGuardianButton
              row={row.original}
              otherRows={rows.filter((r) => r.id !== row.original.id)}
              mergeAction={mergeAction}
            />
          )}
        </div>
      ),
    });
  }

  return columns;
}

export function ParentsTable({
  rows,
  canDelete = false,
  deleteAction,
  mergeAction,
}: {
  rows: ParentRow[];
  canDelete?: boolean;
  deleteAction?: DeleteGuardianAction;
  mergeAction?: MergeGuardianAction;
}) {
  const columns = useMemo(
    () => buildColumns(rows, canDelete, deleteAction, mergeAction),
    [rows, canDelete, deleteAction, mergeAction],
  );
  return (
    <DataTable columns={columns} data={rows} searchColumnId="full_name" searchPlaceholder="Search parents by name…" />
  );
}
