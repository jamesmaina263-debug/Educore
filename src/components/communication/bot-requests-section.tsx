"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/status-badge";
import { reviewBotRequestAction } from "@/app/(app)/communication/bot-requests/actions";
import {
  decisionLabel,
  decisionsFor,
  kindLabel,
  statusLabel,
  statusTone,
  type BotRequestDecision,
  type BotRequestRow,
} from "@/lib/bot-requests";

function when(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("en-KE", { timeZone: "Africa/Nairobi", dateStyle: "medium", timeStyle: "short" });
}

function RequestCard({ row }: { row: BotRequestRow }) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const open = row.status === "pending";

  function decide(decision: BotRequestDecision) {
    setError(null);
    startTransition(async () => {
      const res = await reviewBotRequestAction(row.id, decision, note);
      if ("error" in res) setError(res.error);
    });
  }

  return (
    <div className="panel flex flex-col gap-2 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{kindLabel(row.kind)}</span>
        <StatusBadge tone={statusTone(row.status)} label={statusLabel(row.status)} />
        <span className="text-xs text-muted-foreground">{when(row.created_at)}</span>
      </div>
      <div>
        From <span className="font-medium">{row.guardian_name ?? "Unknown guardian"}</span>
        {row.guardian_phone ? <span className="text-muted-foreground"> ({row.guardian_phone})</span> : null}
      </div>
      {row.kind === "absence_report" ? (
        <div>
          <span className="font-medium">{row.student_name ?? "Unknown learner"}</span> will be absent on{" "}
          <span className="font-medium">{row.absence_date ?? "an unknown date"}</span>
          {row.reason ? <> &mdash; {row.reason}</> : null}.
          <p className="mt-1 text-xs text-muted-foreground">This is a note only. Acknowledging it does not change the attendance register.</p>
        </div>
      ) : (
        <div>
          Asks to change their number to <span className="font-medium">{row.new_phone}</span>.
          <p className="mt-1 text-xs text-muted-foreground">
            The bot recognises guardians by phone number. Only change it if you are sure the request is from the guardian (for example, call the current number).
          </p>
          {row.phone_conflict && (
            <p className="mt-1 text-xs text-destructive">Another user at this school already has that number, so it cannot be applied.</p>
          )}
        </div>
      )}
      {!open && (row.review_note || row.reviewed_at) && (
        <div className="text-xs text-muted-foreground">
          {row.reviewed_at ? `Decided ${when(row.reviewed_at)}. ` : ""}
          {row.review_note ?? ""}
        </div>
      )}
      {open && (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={300}
            placeholder="Optional note"
            className="h-9 max-w-xs"
            aria-label="Optional note"
            disabled={pending}
          />
          {decisionsFor(row.kind).map((d) => (
            <Button
              key={d}
              type="button"
              size="sm"
              variant={d === "reject" ? "outline" : "default"}
              disabled={pending || (d === "apply" && row.phone_conflict)}
              onClick={() => decide(d)}
            >
              {decisionLabel(d)}
            </Button>
          ))}
        </div>
      )}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

export function BotRequestsSection({ rows }: { rows: BotRequestRow[] }) {
  const pending = rows.filter((r) => r.status === "pending");
  const decided = rows.filter((r) => r.status !== "pending");
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Waiting for the office ({pending.length})</h2>
        {pending.length === 0 ? (
          <div className="panel border-dashed p-6 text-center text-sm text-muted-foreground">No requests are waiting.</div>
        ) : (
          pending.map((r) => <RequestCard key={r.id} row={r} />)
        )}
      </section>
      {decided.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">Recent decisions</h2>
          {decided.map((r) => (
            <RequestCard key={r.id} row={r} />
          ))}
        </section>
      )}
    </div>
  );
}
