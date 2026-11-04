"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { recordBusBoarding, saveBusAlertMode, sendDelayAlert, sendTestBusAlert, type BusActionResult } from "@/app/(app)/transport/alerts/actions";
import { DELAY_MAX_MINUTES, DELAY_MIN_MINUTES, DELAY_NOTE_MAX, MODE_LABELS, type BoardingKind, type BusAlertMode } from "@/lib/bus-alerts";

export interface AlertSettings {
  mode: BusAlertMode;
  testPhone: string | null;
  testSent: boolean;
}
export interface RouteOption {
  id: string;
  name: string;
}
export interface RiderOption {
  studentId: string;
  name: string;
  route: string;
}
export interface ReconRow {
  student_id: string;
  student_name: string;
  route_name: string;
  roll_call_present: boolean;
  gate_in: boolean;
  gate_out: boolean;
  boarded: boolean;
  dropped_off: boolean;
}
export interface AlertLogRow {
  id: string;
  created_at: string;
  kind: string;
  mode: string;
  outcome: string;
}

const selectClass = "h-9 rounded-md border border-border bg-background px-2 text-sm";
const yn = (v: boolean) => (v ? "Yes" : "-");

function Notice({ result }: { result: BusActionResult | null }) {
  if (!result) return null;
  if ("error" in result) {
    return (
      <p role="alert" className="text-sm text-danger">
        {result.error}
      </p>
    );
  }
  return (
    <p role="status" className={result.warning ? "text-sm text-amber-700 dark:text-amber-400" : "text-sm text-success"}>
      {result.message}
    </p>
  );
}

export function BusAlertsPanel({
  settings,
  routes,
  riders,
  recon,
  log,
  canWrite,
}: {
  settings: AlertSettings;
  routes: RouteOption[];
  riders: RiderOption[];
  recon: ReconRow[];
  log: AlertLogRow[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<BusAlertMode>(settings.mode);
  const [phone, setPhone] = useState(settings.testPhone ?? "");
  const [route, setRoute] = useState("");
  const [minutes, setMinutes] = useState("20");
  const [note, setNote] = useState("");
  const [learner, setLearner] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [res, setRes] = useState<Record<string, BusActionResult | null>>({});

  async function run(key: string, fn: () => Promise<BusActionResult>) {
    setPending(key);
    setRes((r) => ({ ...r, [key]: null }));
    const out = await fn();
    setPending(null);
    setRes((r) => ({ ...r, [key]: out }));
    router.refresh();
  }

  const phoneChanged = phone.replace(/[\s-]/g, "") !== (settings.testPhone ?? "");
  const liveBlocked = !settings.testSent || phoneChanged;

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      {/* 1. Settings: test first */}
      <section className="panel space-y-3 p-4">
        <div>
          <h2 className="text-sm font-semibold">Bus alerts</h2>
          <p className="text-sm text-muted-foreground">
            Guardians can get an SMS when a bus is delayed or their child boards or gets off. Nothing is sent automatically: a staff member sends each delay alert or records each boarding. Start with{" "}
            <strong>Test</strong>, which sends only to your own phone and never to a guardian.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="ba-mode">Mode</Label>
            <select id="ba-mode" className={selectClass} value={mode} disabled={!canWrite} onChange={(e) => setMode(e.target.value as BusAlertMode)}>
              {(["off", "test", "live"] as BusAlertMode[]).map((m) => (
                <option key={m} value={m} disabled={m === "live" && liveBlocked}>
                  {MODE_LABELS[m]}
                </option>
              ))}
            </select>
            {liveBlocked && <span className="text-xs text-muted-foreground">Live unlocks after a test alert has been sent to the current test phone.</span>}
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="ba-phone">Staff test phone</Label>
            <Input id="ba-phone" inputMode="tel" placeholder="0712345678" value={phone} disabled={!canWrite} onChange={(e) => setPhone(e.target.value)} />
            <span className="text-xs text-muted-foreground">A staff member&apos;s own number, not a guardian&apos;s.</span>
          </div>
        </div>
        {canWrite && (
          <div className="flex flex-wrap gap-2">
            <Button disabled={pending !== null} onClick={() => run("mode", () => saveBusAlertMode({ mode, testPhone: phone.trim() || null }))}>
              {pending === "mode" ? "Saving…" : "Save"}
            </Button>
            <Button
              variant="outline"
              disabled={pending !== null || !settings.testPhone || settings.mode === "off" || phoneChanged}
              onClick={() => run("test", () => sendTestBusAlert())}
            >
              {pending === "test" ? "Sending…" : "Send a test alert"}
            </Button>
          </div>
        )}
        <Notice result={res.mode ?? null} />
        <Notice result={res.test ?? null} />
        {!canWrite && <p className="text-sm text-muted-foreground">You can view bus alerts but only transport staff can change them or send alerts.</p>}
      </section>

      {/* 2. Delay alert */}
      {canWrite && (
        <section className="panel space-y-3 p-4">
          <h2 className="text-sm font-semibold">Send a delay alert</h2>
          <p className="text-sm text-muted-foreground">Tells the guardians of everyone on a route that their bus is running late. Sending the same route again is blocked for 10 minutes.</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="ba-route">Route</Label>
              <select id="ba-route" className={selectClass} value={route} onChange={(e) => setRoute(e.target.value)}>
                <option value="">Choose a route…</option>
                {routes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="ba-min">Minutes late</Label>
              <Input id="ba-min" type="number" min={DELAY_MIN_MINUTES} max={DELAY_MAX_MINUTES} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1 sm:col-span-3">
              <Label htmlFor="ba-note">Note (optional)</Label>
              <Input id="ba-note" maxLength={DELAY_NOTE_MAX} placeholder="For example: heavy traffic on Ngong Road" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>
          <Button disabled={pending !== null || !route || settings.mode === "off"} onClick={() => run("delay", () => sendDelayAlert({ routeId: route, minutes: Number(minutes), note: note.trim() || null }))}>
            {pending === "delay" ? "Sending…" : settings.mode === "test" ? "Send test delay alert" : "Send delay alert"}
          </Button>
          {settings.mode === "off" && <p className="text-sm text-muted-foreground">Bus alerts are off. Switch to Test above first.</p>}
          <Notice result={res.delay ?? null} />
        </section>
      )}

      {/* 3. Bus roll-call */}
      {canWrite && (
        <section className="panel space-y-3 p-4">
          <h2 className="text-sm font-semibold">Bus roll-call</h2>
          <p className="text-sm text-muted-foreground">
            Record that a learner boarded or got off the bus. The guardian is messaged according to the mode above. School-gate scans are not used to message anyone; they are only compared below.
          </p>
          <div className="flex flex-col gap-1">
            <Label htmlFor="ba-learner">Learner</Label>
            <select id="ba-learner" className={selectClass} value={learner} onChange={(e) => setLearner(e.target.value)}>
              <option value="">Choose a learner…</option>
              {riders.map((r) => (
                <option key={r.studentId} value={r.studentId}>
                  {r.name} ({r.route})
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap gap-2">
            {(["boarded", "dropped_off"] as BoardingKind[]).map((k) => (
              <Button key={k} variant="outline" disabled={pending !== null || !learner} onClick={() => run("board", () => recordBusBoarding({ studentId: learner, kind: k }))}>
                {pending === "board" ? "Recording…" : k === "boarded" ? "Boarded the bus" : "Got off the bus"}
              </Button>
            ))}
          </div>
          <Notice result={res.board ?? null} />
        </section>
      )}

      {/* 4. Reconciliation */}
      <section className="panel space-y-3 p-4">
        <h2 className="text-sm font-semibold">Today: bus roll-call against class roll-call and the school gate</h2>
        <p className="text-sm text-muted-foreground">Read-only. It sends nothing. Use it to spot, for example, a learner scanned out at the gate who was never recorded boarding.</p>
        {recon.length === 0 ? (
          <p className="text-sm text-muted-foreground">No learners with an active bus assignment.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="py-1 pr-3">Learner</th>
                  <th className="py-1 pr-3">Route</th>
                  <th className="py-1 pr-3">Class roll-call</th>
                  <th className="py-1 pr-3">Gate in</th>
                  <th className="py-1 pr-3">Gate out</th>
                  <th className="py-1 pr-3">Boarded</th>
                  <th className="py-1 pr-3">Got off</th>
                </tr>
              </thead>
              <tbody>
                {recon.map((r) => (
                  <tr key={r.student_id} className="border-b border-border/50">
                    <td className="py-1 pr-3">{r.student_name}</td>
                    <td className="py-1 pr-3">{r.route_name}</td>
                    <td className="py-1 pr-3">{yn(r.roll_call_present)}</td>
                    <td className="py-1 pr-3">{yn(r.gate_in)}</td>
                    <td className="py-1 pr-3">{yn(r.gate_out)}</td>
                    <td className="py-1 pr-3">{yn(r.boarded)}</td>
                    <td className="py-1 pr-3">{yn(r.dropped_off)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Recent log */}
      <section className="panel space-y-2 p-4">
        <h2 className="text-sm font-semibold">Recent alert activity</h2>
        {log.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing yet.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {log.map((l) => (
              <li key={l.id} className="flex flex-wrap gap-x-3 text-muted-foreground">
                <span>{new Date(l.created_at).toLocaleString("en-KE", { timeZone: "Africa/Nairobi", dateStyle: "short", timeStyle: "short" })}</span>
                <span>{l.kind.replace("_", " ")}</span>
                <span>{l.mode === "test" ? "TEST" : "live"}</span>
                <span>{l.outcome.replaceAll("_", " ")}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
