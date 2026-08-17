"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { PERMISSION_CATALOG } from "@/lib/permissions-catalog";
import {
  getEffectivePermissionsForUser,
  setUserPermissionOverride,
  clearUserPermissionOverride,
  type EffectivePermission,
} from "@/app/(app)/settings/permissions-actions";

export function UserPermissionsPanel({
  schoolUserId,
  fullName,
  open,
  onOpenChange,
}: {
  schoolUserId: string | null;
  fullName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [roleName, setRoleName] = useState("");
  const [permissions, setPermissions] = useState<Map<string, EffectivePermission>>(new Map());
  const [savingKey, setSavingKey] = useState<string | null>(null);
  // Tracks which user's data is currently in `permissions`, so `loading` can
  // be derived instead of set synchronously inside the effect below.
  const [loadedForUserId, setLoadedForUserId] = useState<string | null>(null);

  const loading = open && schoolUserId !== null && loadedForUserId !== schoolUserId && !error;

  useEffect(() => {
    if (!open || !schoolUserId) return;
    let cancelled = false;
    getEffectivePermissionsForUser(schoolUserId).then((res) => {
      if (cancelled) return;
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setError(null);
      setRoleName(res.roleName);
      setPermissions(new Map(res.permissions.map((p) => [p.key, p])));
      setLoadedForUserId(schoolUserId);
    });
    return () => {
      cancelled = true;
    };
  }, [open, schoolUserId]);

  async function handleSet(key: string, allowed: boolean) {
    if (!schoolUserId) return;
    setSavingKey(key);
    setError(null);
    const result = await setUserPermissionOverride(schoolUserId, key, allowed);
    setSavingKey(null);
    if ("error" in result) return setError(result.error);
    setPermissions((prev) => {
      const next = new Map(prev);
      next.set(key, { key, allowed, source: "user_override", isUserOverride: true });
      return next;
    });
  }

  async function handleReset(key: string) {
    if (!schoolUserId) return;
    setSavingKey(key);
    setError(null);
    const result = await clearUserPermissionOverride(schoolUserId, key);
    setSavingKey(null);
    if ("error" in result) return setError(result.error);
    // Re-fetch this one key's role-derived state by refetching the whole set —
    // simplest correct option since role defaults/overrides aren't cached client-side.
    if (schoolUserId) {
      const res = await getEffectivePermissionsForUser(schoolUserId);
      if ("success" in res) setPermissions(new Map(res.permissions.map((p) => [p.key, p])));
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{fullName}&apos;s permissions</SheetTitle>
        </SheetHeader>
        <p className="text-sm text-muted-foreground">
          Role: <span className="font-medium text-foreground">{roleName}</span>. Overrides below apply only to this
          person and take priority over their role&apos;s defaults.
        </p>
        {error && <p className="text-sm text-danger">{error}</p>}
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="flex flex-col gap-4">
            {PERMISSION_CATALOG.map((group) => (
              <div key={group.module} className="panel">
                <div className="border-b border-border px-3 py-2">
                  <h3 className="text-[0.8125rem] font-semibold">{group.label}</h3>
                </div>
                <div className="divide-y divide-border">
                  {group.permissions.map((perm) => {
                    const effective = permissions.get(perm.key);
                    const busy = savingKey === perm.key;
                    return (
                      <div key={perm.key} className="flex items-center justify-between gap-3 px-3 py-2">
                        <div className="min-w-0">
                          <p className="truncate text-[0.8125rem]">{perm.label}</p>
                          {effective?.isUserOverride ? (
                            <Badge variant={effective.allowed ? "default" : "destructive"} className="mt-1">
                              Overridden: {effective.allowed ? "Allowed" : "Denied"}
                            </Badge>
                          ) : (
                            <span className="text-[0.7rem] text-muted-foreground">
                              From role: {effective?.allowed ? "allowed" : "not allowed"}
                            </span>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <Button
                            size="sm"
                            variant={effective?.isUserOverride && effective.allowed ? "default" : "outline"}
                            disabled={busy}
                            onClick={() => handleSet(perm.key, true)}
                          >
                            Allow
                          </Button>
                          <Button
                            size="sm"
                            variant={effective?.isUserOverride && !effective.allowed ? "destructive" : "outline"}
                            disabled={busy}
                            onClick={() => handleSet(perm.key, false)}
                          >
                            Deny
                          </Button>
                          {effective?.isUserOverride && (
                            <Button size="sm" variant="ghost" disabled={busy} onClick={() => handleReset(perm.key)}>
                              Reset
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
