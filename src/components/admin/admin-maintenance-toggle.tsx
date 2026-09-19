"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { setMaintenanceMode, type MaintenanceStatus } from "@/app/(admin)/admin/broadcast/maintenance-actions";

export function AdminMaintenanceToggle({ status }: { status: MaintenanceStatus }) {
  const router = useRouter();
  const [message, setMessage] = useState(status.message ?? "");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const enabled = status.enabled;

  function handleToggle() {
    setError(null);
    startTransition(async () => {
      const res = await setMaintenanceMode(!enabled, message);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setConfirmOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="panel flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-[0.8125rem] font-semibold">Maintenance mode</h2>
          <p className="text-sm text-muted-foreground">
            {enabled
              ? "ON — every school is blocked from the app and sees a maintenance page. The admin console stays reachable."
              : "OFF — all schools have normal access. Turn this on before starting risky maintenance work."}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
            enabled ? "bg-danger/10 text-danger" : "bg-success/10 text-success"
          }`}
        >
          {enabled ? "ON" : "OFF"}
        </span>
      </div>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      {!enabled && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Message shown on the maintenance page (optional)</p>
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="We're doing planned maintenance. Back shortly."
            rows={2}
          />
        </div>
      )}

      <div>
        <Button variant={enabled ? "outline" : "default"} onClick={() => setConfirmOpen(true)} disabled={pending}>
          {enabled ? "Turn maintenance mode off" : "Turn maintenance mode on"}
        </Button>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{enabled ? "Turn maintenance mode off?" : "Block every school right now?"}</DialogTitle>
            <DialogDescription>
              {enabled
                ? "Every school regains normal access immediately."
                : "Every active staff account at every school will be redirected to a maintenance page and unable to use the app until you turn this back off. The platform admin console stays reachable so you can turn it off from here."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={handleToggle} disabled={pending}>
              {pending ? "Saving…" : enabled ? "Turn off" : "Turn on"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
