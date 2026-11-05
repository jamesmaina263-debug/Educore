"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { setMyBusAlerts } from "@/app/portal/bus/alerts-actions";

// WP 5.4: a guardian's own on/off choice for bus alert SMS. Opted in by default; the choice is checked again by the
// database every time an alert would be sent.
export function BusAlertsToggle({ initialEnabled }: { initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function choose(next: boolean) {
    setPending(true);
    setError(null);
    const res = await setMyBusAlerts(next);
    setPending(false);
    if ("error" in res) return setError(res.error);
    setEnabled(next);
  }

  return (
    <div className="panel space-y-2 p-4">
      <p className="label-eyebrow">Bus alerts</p>
      <p className="text-sm text-muted-foreground">
        The school may text you when a bus is running late, or when your child gets on or off the bus. You are currently{" "}
        <strong>{enabled ? "receiving" : "not receiving"}</strong> these messages. You can change this at any time.
      </p>
      <Button variant="outline" size="sm" disabled={pending} onClick={() => choose(!enabled)}>
        {pending ? "Saving…" : enabled ? "Stop bus alert messages" : "Turn bus alert messages on"}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
