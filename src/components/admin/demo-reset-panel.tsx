"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { resetDemoAcademyAnnouncementsAction } from "@/app/(admin)/admin/demo-reset/actions";

export function DemoResetPanel() {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<{ kind: "success" | "error"; message: string } | null>(
    null,
  );

  async function handleConfirm() {
    setPending(true);
    setStatus(null);
    const result = await resetDemoAcademyAnnouncementsAction();
    setPending(false);
    setConfirming(false);
    if ("error" in result) {
      setStatus({ kind: "error", message: result.error });
    } else {
      setStatus({ kind: "success", message: "Demo Academy announcements cleared." });
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      {!confirming ? (
        <Button variant="outline" className="w-fit" onClick={() => setConfirming(true)}>
          Reset Demo Academy announcements
        </Button>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-sm">
            This permanently deletes every announcement (and its read/acknowledgement
            records) currently in Demo Academy. This can&apos;t be undone.
          </p>
          <div className="flex gap-2">
            <Button variant="destructive" onClick={handleConfirm} disabled={pending}>
              {pending ? "Resetting…" : "Yes, reset it"}
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(false)} disabled={pending}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {status && (
        <p className={status.kind === "error" ? "text-sm text-destructive" : "text-sm text-green-600"}>
          {status.message}
        </p>
      )}
    </div>
  );
}
