"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { sendTestPushAction } from "@/app/notifications/push-actions";
import { urlBase64ToUint8Array } from "@/lib/push/payload";

type State = "checking" | "unsupported" | "unconfigured" | "blocked" | "off" | "on";

const PUSH_SCOPE = "/push-sw/";

async function waitForActive(reg: ServiceWorkerRegistration): Promise<void> {
  if (reg.active) return;
  const worker = reg.installing ?? reg.waiting;
  if (!worker) throw new Error("The notification service could not start.");
  await new Promise<void>((resolve, reject) => {
    const check = () => {
      if (worker.state === "activated") resolve();
      else if (worker.state === "redundant") reject(new Error("The notification service could not start."));
    };
    worker.addEventListener("statechange", check);
    check();
  });
}

/**
 * Lets the signed-in person turn push notifications on or off for THIS browser. It registers the push-only
 * service worker (/push-sw.js, separate from the offline worker) and stores the subscription through the
 * register_push_subscription database function. Rendered only where the school's flag is on.
 */
export function PushNotificationsToggle({ publicKey }: { publicKey: string | null }) {
  const [state, setState] = useState<State>("checking");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function detect() {
      const supported = typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
      if (!supported) return setState("unsupported");
      if (!publicKey) return setState("unconfigured");
      if (Notification.permission === "denied") return setState("blocked");
      try {
        const reg = await navigator.serviceWorker.getRegistration(PUSH_SCOPE);
        const sub = reg ? await reg.pushManager.getSubscription() : null;
        if (!cancelled) setState(sub ? "on" : "off");
      } catch {
        if (!cancelled) setState("off");
      }
    }
    void detect();
    return () => {
      cancelled = true;
    };
  }, [publicKey]);

  async function enable() {
    if (!publicKey) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "blocked" : "off");
        setError("Notifications were not allowed on this device.");
        return;
      }
      const reg = await navigator.serviceWorker.register("/push-sw.js", { scope: PUSH_SCOPE });
      await waitForActive(reg);
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) }));
      const json = sub.toJSON();
      const supabase = createClient();
      const { error: rpcError } = await supabase.rpc("register_push_subscription", {
        p_endpoint: json.endpoint,
        p_p256dh: json.keys?.p256dh,
        p_auth: json.keys?.auth,
        p_user_agent: navigator.userAgent.slice(0, 300),
      });
      if (rpcError) {
        await sub.unsubscribe().catch(() => undefined);
        setError(rpcError.message);
        setState("off");
        return;
      }
      setState("on");
      setMessage("Notifications are on for this device.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not turn notifications on.");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration(PUSH_SCOPE);
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe().catch(() => undefined);
        await createClient().rpc("revoke_push_subscription", { p_endpoint: endpoint });
      }
      setState("off");
      setMessage("Notifications are off for this device.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not turn notifications off.");
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await sendTestPushAction();
      if ("error" in result) setError(result.error);
      else setMessage(result.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">
        Get alerts from EduCore on this device, even when the app is closed. Each device is turned on separately.
      </p>
      {state === "checking" && <p className="text-sm text-muted-foreground">Checking this device...</p>}
      {state === "unsupported" && (
        <p className="text-sm text-muted-foreground">
          This browser does not support notifications. On an iPhone or iPad, add EduCore to your Home Screen first, then open it from there.
        </p>
      )}
      {state === "unconfigured" && <p className="text-sm text-muted-foreground">Notifications are not available yet. Please try again later.</p>}
      {state === "blocked" && (
        <p className="text-sm text-muted-foreground">Notifications are blocked for this site. Allow them in your browser settings, then reload this page.</p>
      )}
      {state === "off" && (
        <div>
          <Button size="sm" disabled={busy} onClick={enable}>
            {busy ? "Turning on..." : "Turn on notifications"}
          </Button>
        </div>
      )}
      {state === "on" && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={sendTest}>
            Send me a test
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={disable}>
            Turn off
          </Button>
        </div>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {message && <p className="text-sm text-muted-foreground">{message}</p>}
    </div>
  );
}
