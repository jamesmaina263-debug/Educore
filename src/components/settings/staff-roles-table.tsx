"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { changeStaffRole, setStaffStatus, resetStaffPassword } from "@/app/(app)/settings/actions";
import { UserPermissionsPanel } from "@/components/settings/user-permissions-panel";

export interface StaffRow {
  id: string;
  full_name: string;
  email: string | null;
  status: "active" | "inactive" | "suspended";
  role_id: string;
  role_name: string;
  role_display_name: string;
  must_change_password: boolean;
}

export interface RoleOption {
  id: string;
  name: string;
  display_name: string;
}

function statusTone(status: string) {
  return status === "active" ? "success" : status === "suspended" ? "danger" : "neutral";
}

export function StaffRolesTable({
  rows,
  roles,
  canManage,
  canManagePermissions,
  currentUserId,
}: {
  rows: StaffRow[];
  roles: RoleOption[];
  canManage: boolean;
  canManagePermissions?: boolean;
  currentUserId: string;
}) {
  const router = useRouter();
  const [pendingRoleChange, setPendingRoleChange] = useState<{ row: StaffRow; newRoleId: string } | null>(null);
  const [pendingDeactivate, setPendingDeactivate] = useState<StaffRow | null>(null);
  const [permissionsTarget, setPermissionsTarget] = useState<StaffRow | null>(null);
  const [pendingReset, setPendingReset] = useState<StaffRow | null>(null);
  const [resetTempPassword, setResetTempPassword] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmRoleChange() {
    if (!pendingRoleChange) return;
    setBusy(true);
    setError(null);
    const result = await changeStaffRole(pendingRoleChange.row.id, pendingRoleChange.newRoleId);
    setBusy(false);
    if ("error" in result) return setError(result.error);
    setPendingRoleChange(null);
    router.refresh();
  }

  async function confirmDeactivate() {
    if (!pendingDeactivate) return;
    setBusy(true);
    setError(null);
    const nextStatus = pendingDeactivate.status === "active" ? "inactive" : "active";
    const result = await setStaffStatus(pendingDeactivate.id, nextStatus);
    setBusy(false);
    if ("error" in result) return setError(result.error);
    setPendingDeactivate(null);
    router.refresh();
  }

  async function confirmReset() {
    if (!pendingReset) return;
    setBusy(true);
    setError(null);
    const result = await resetStaffPassword(pendingReset.id);
    setBusy(false);
    if ("error" in result) return setError(result.error);
    setResetTempPassword(result.temporaryPassword);
    router.refresh();
  }

  function closeResetDialog() {
    setPendingReset(null);
    setResetTempPassword(null);
    setError(null);
  }

  const wasClassTeacher = pendingRoleChange?.row.role_name === "class_teacher";
  const isSelf = pendingDeactivate?.id === currentUserId || pendingRoleChange?.row.id === currentUserId;

  return (
    <div className="flex flex-col gap-3">
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="panel">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <h2 className="text-[0.8125rem] font-semibold">Staff accounts</h2>
          <span className="text-[0.75rem] text-muted-foreground">Role assignment</span>
        </div>
        <div className="overflow-x-auto">
      <Table className="table-dense">
        <TableHeader>
          <TableRow>
            <TableHead>User</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Status</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const initials = r.full_name
              .split(" ")
              .filter(Boolean)
              .slice(0, 2)
              .map((p) => p[0]?.toUpperCase())
              .join("");
            return (
              <TableRow key={r.id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span className="grid size-7 shrink-0 place-items-center rounded-full bg-secondary text-[0.6875rem] font-semibold text-secondary-foreground">
                      {initials}
                    </span>
                    <span className="min-w-0 leading-tight">
                      <span className="block truncate font-medium">{r.full_name}</span>
                      <span className="block truncate text-[0.75rem] text-muted-foreground">
                        {r.email ?? "—"}
                      </span>
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  {canManage ? (
                    <Select
                      value={r.role_id}
                      onValueChange={(v) => v !== r.role_id && setPendingRoleChange({ row: r, newRoleId: v })}
                    >
                      <SelectTrigger className="h-8 w-40">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {roles.map((role) => (
                          <SelectItem key={role.id} value={role.id}>
                            {role.display_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    r.role_display_name
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    <StatusBadge tone={statusTone(r.status)} label={r.status} />
                    {r.must_change_password && (
                      <StatusBadge tone="neutral" label="Password not set" />
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-1">
                    {canManagePermissions && (
                      <Button size="sm" variant="ghost" onClick={() => setPermissionsTarget(r)}>
                        Permissions
                      </Button>
                    )}
                    {canManage && (
                      <Button size="sm" variant="ghost" onClick={() => setPendingReset(r)}>
                        Reset password
                      </Button>
                    )}
                    {canManage && (
                      <Button size="sm" variant="ghost" onClick={() => setPendingDeactivate(r)}>
                        {r.status === "active" ? "Deactivate" : "Reactivate"}
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
        </div>
      </div>

      <Dialog open={pendingRoleChange !== null} onOpenChange={(open) => !open && setPendingRoleChange(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change {pendingRoleChange?.row.full_name}&apos;s role?</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm text-muted-foreground">
            {wasClassTeacher && (
              <p>
                This person is assigned as a class teacher for one or more streams. Moving them off Class Teacher
                doesn&apos;t reassign those streams — do that in Academics afterward, or students in that class may
                end up without a class teacher for medical-record access and attendance marking.
              </p>
            )}
            {isSelf && <p>This changes your own access — you may lose access to pages you can currently see.</p>}
            <p>Their access to data changes immediately once you confirm.</p>
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
          <DialogFooter>
            <Button onClick={confirmRoleChange} disabled={busy}>
              {busy ? "Saving…" : "Confirm change"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={pendingDeactivate !== null} onOpenChange={(open) => !open && setPendingDeactivate(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pendingDeactivate?.status === "active" ? "Deactivate" : "Reactivate"} {pendingDeactivate?.full_name}?
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm text-muted-foreground">
            {pendingDeactivate?.status === "active" ? (
              <p>They&apos;ll immediately lose access to sign in and to all school data. This doesn&apos;t delete their record or history.</p>
            ) : (
              <p>They&apos;ll regain access with whatever role is currently set.</p>
            )}
            {isSelf && <p>This is your own account.</p>}
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
          <DialogFooter>
            <Button onClick={confirmDeactivate} disabled={busy} variant={pendingDeactivate?.status === "active" ? "destructive" : "default"}>
              {busy ? "Saving…" : pendingDeactivate?.status === "active" ? "Deactivate" : "Reactivate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={pendingReset !== null} onOpenChange={(open) => !open && closeResetDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {resetTempPassword ? "New temporary password" : `Reset ${pendingReset?.full_name}'s password?`}
            </DialogTitle>
          </DialogHeader>

          {resetTempPassword ? (
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">
                Share this with <span className="font-medium text-foreground">{pendingReset?.full_name}</span>{" "}
                directly — it&apos;s only shown once. They&apos;ll be required to set their own password on next
                login, and this one stops working in 3 days if it&apos;s never used.
              </p>
              <div className="rounded-md border border-border bg-muted p-3 font-mono text-sm">
                <div>{pendingReset?.email}</div>
                <div className="mt-1 font-semibold">{resetTempPassword}</div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              This immediately invalidates their current password. They&apos;ll need the new temporary password
              below to sign in again.
            </p>
          )}

          {error && <p className="text-sm text-danger">{error}</p>}

          <DialogFooter>
            {resetTempPassword ? (
              <Button onClick={closeResetDialog}>Done</Button>
            ) : (
              <Button onClick={confirmReset} disabled={busy}>
                {busy ? "Resetting…" : "Reset password"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <UserPermissionsPanel
        schoolUserId={permissionsTarget?.id ?? null}
        fullName={permissionsTarget?.full_name ?? ""}
        open={permissionsTarget !== null}
        onOpenChange={(open) => !open && setPermissionsTarget(null)}
      />
    </div>
  );
}
