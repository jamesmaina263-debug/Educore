"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { resolveOnboardingFollowup } from "@/app/(admin)/admin/onboarding/actions";
import { Button } from "@/components/ui/button";
import { PriorityBadge, StatusBadge } from "@/components/admin/onboarding/onboarding-badges";
import { NO_ONE, TeamSelect, type Team } from "@/components/admin/onboarding/team-select";
import { FOLLOWUP_STATUS_LABELS, RULE_LABELS, formatDate, type FollowupQueueRow } from "@/lib/onboarding/onboarding";

// The Customer Success follow-up queue. Alerts here are for a person to act on: nothing on this list sends a message.
// Marking one resolved or dismissed only records that a person has dealt with it.

export function FollowupQueue({ rows, total, team }: { rows: FollowupQueueRow[]; total: number; team: Team }) {
  const [actor, setActor] = useState(NO_ONE);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  function act(id: string, dismiss: boolean) {
    setMessage(null);
    if (actor === NO_ONE) {
      setMessage({ ok: false, text: "Pick your name first." });
      return;
    }
    start(async () => {
      const res = await resolveOnboardingFollowup({ id, dismiss, by: actor });
      setMessage("error" in res ? { ok: false, text: res.error } : { ok: true, text: dismiss ? "Alert dismissed." : "Alert marked as done." });
    });
  }

  return (
    <section aria-labelledby="queue-heading" className="flex flex-col gap-3 rounded-md border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="queue-heading" className="text-sm font-semibold">
            Customer Success follow-up queue
          </h2>
          <p className="text-xs text-muted-foreground">
            Schools that need a person. EduCore contacts none of them automatically beyond the two approved service emails.
          </p>
        </div>
        <TeamSelect team={team} value={actor} onChange={setActor} />
      </div>

      {message && (
        <p role="status" className={message.ok ? "text-xs text-emerald-800" : "text-xs text-destructive"}>
          {message.text}
        </p>
      )}

      {rows.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">Nothing needs follow-up right now.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {rows.map((r) => (
            <li key={r.followup_id} className="flex flex-wrap items-center justify-between gap-3 py-2">
              <div className="flex min-w-0 flex-col gap-0.5">
                <Link href={`/admin/onboarding/${r.school_id}`} className="text-sm font-medium text-primary underline-offset-4 hover:underline">
                  {r.school_name}
                </Link>
                <span className="text-xs text-muted-foreground">
                  {RULE_LABELS[r.rule_key] ?? r.rule_key} · {FOLLOWUP_STATUS_LABELS[r.status] ?? r.status} · raised {formatDate(r.created_at)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {r.admin_name ?? "No administrator on file"}
                  {r.admin_email ? ` · ${r.admin_email}` : ""}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={r.onboarding_status} />
                <PriorityBadge priority={r.priority} />
                {r.kind === "alert" && r.status === "open" && (
                  <>
                    <Button size="sm" variant="outline" disabled={pending} onClick={() => act(r.followup_id, false)}>
                      Done
                    </Button>
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => act(r.followup_id, true)}>
                      Dismiss
                    </Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {total > rows.length && <p className="text-xs text-muted-foreground">Showing the first {rows.length} of {total}.</p>}
    </section>
  );
}
