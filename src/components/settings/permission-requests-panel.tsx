"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PERMISSION_CATALOG, getPermissionLabel } from "@/lib/permissions-catalog";
import {
  requestPermission,
  cancelPermissionRequest,
  respondToPermissionRequest,
  type PermissionRequestRow,
} from "@/app/(app)/settings/permission-requests-actions";

const STATUS_VARIANT: Record<PermissionRequestRow["status"], "default" | "destructive" | "secondary" | "outline"> = {
  pending: "secondary",
  approved: "default",
  rejected: "destructive",
  cancelled: "outline",
};

export function PermissionRequestsPanel({
  canManagePermissions,
  initialMyRequests,
  initialPendingForReview,
}: {
  canManagePermissions: boolean;
  initialMyRequests: PermissionRequestRow[];
  initialPendingForReview: PermissionRequestRow[];
}) {
  const [myRequests, setMyRequests] = useState(initialMyRequests);
  const [pendingForReview, setPendingForReview] = useState(initialPendingForReview);
  const [permissionKey, setPermissionKey] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleRequest() {
    if (!permissionKey) return;
    setError(null);
    startTransition(async () => {
      const result = await requestPermission(permissionKey, reason);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setMyRequests((prev) => [
        {
          id: crypto.randomUUID(),
          school_user_id: "",
          permission_key: permissionKey,
          reason: reason.trim() || null,
          status: "pending",
          created_at: new Date().toISOString(),
          reviewed_at: null,
          requester_name: "",
        },
        ...prev,
      ]);
      setPermissionKey("");
      setReason("");
    });
  }

  async function handleCancel(id: string) {
    setBusyId(id);
    setError(null);
    const result = await cancelPermissionRequest(id);
    setBusyId(null);
    if ("error" in result) return setError(result.error);
    setMyRequests((prev) => prev.map((r) => (r.id === id ? { ...r, status: "cancelled" } : r)));
  }

  async function handleRespond(id: string, approve: boolean) {
    setBusyId(id);
    setError(null);
    const result = await respondToPermissionRequest(id, approve);
    setBusyId(null);
    if ("error" in result) return setError(result.error);
    setPendingForReview((prev) => prev.filter((r) => r.id !== id));
  }

  return (
    <div className="flex flex-col gap-6">
      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="panel">
        <div className="border-b border-border px-3 py-2">
          <h3 className="text-[0.8125rem] font-semibold">Request a permission</h3>
        </div>
        <div className="flex flex-col gap-3 p-3">
          <Select value={permissionKey} onValueChange={setPermissionKey}>
            <SelectTrigger>
              <SelectValue placeholder="Choose a permission" />
            </SelectTrigger>
            <SelectContent>
              {PERMISSION_CATALOG.map((group) => (
                <div key={group.module}>
                  <p className="px-2 py-1 text-[0.7rem] font-semibold text-muted-foreground">{group.label}</p>
                  {group.permissions.map((perm) => (
                    <SelectItem key={perm.key} value={perm.key}>
                      {perm.label}
                    </SelectItem>
                  ))}
                </div>
              ))}
            </SelectContent>
          </Select>
          <Textarea
            placeholder="Why do you need this? (optional)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
          />
          <div>
            <Button size="sm" disabled={!permissionKey || pending} onClick={handleRequest}>
              {pending ? "Requesting…" : "Request access"}
            </Button>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="border-b border-border px-3 py-2">
          <h3 className="text-[0.8125rem] font-semibold">My requests</h3>
        </div>
        <div className="divide-y divide-border">
          {myRequests.length === 0 && <p className="px-3 py-3 text-sm text-muted-foreground">No requests yet.</p>}
          {myRequests.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-[0.8125rem]">{getPermissionLabel(r.permission_key)}</p>
                {r.reason && <p className="truncate text-[0.7rem] text-muted-foreground">{r.reason}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge variant={STATUS_VARIANT[r.status]}>{r.status}</Badge>
                {r.status === "pending" && (
                  <Button size="sm" variant="ghost" disabled={busyId === r.id} onClick={() => handleCancel(r.id)}>
                    Cancel
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {canManagePermissions && (
        <div className="panel">
          <div className="border-b border-border px-3 py-2">
            <h3 className="text-[0.8125rem] font-semibold">Pending approval</h3>
          </div>
          <div className="divide-y divide-border">
            {pendingForReview.length === 0 && (
              <p className="px-3 py-3 text-sm text-muted-foreground">Nothing waiting on you right now.</p>
            )}
            {pendingForReview.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-[0.8125rem]">
                    {r.requester_name || "A staff member"} — {getPermissionLabel(r.permission_key)}
                  </p>
                  {r.reason && <p className="truncate text-[0.7rem] text-muted-foreground">{r.reason}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button size="sm" disabled={busyId === r.id} onClick={() => handleRespond(r.id, true)}>
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={busyId === r.id}
                    onClick={() => handleRespond(r.id, false)}
                  >
                    Reject
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
