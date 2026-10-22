import { createClient } from "@/lib/supabase/server";
import { isSmallSample } from "@/lib/growth/report";
import { deliveryRates, parseEmailDeliverySummary } from "@/lib/email-delivery";

// "Email delivery" panel: did outreach and campaign emails reach inboxes? Counts come from Resend's webhook
// (recorded in email_delivery_events). One read-only call; if it fails the panel says so rather than showing
// zeros, and if no event has ever been recorded it explains how to connect the webhook.

export async function EmailDeliveryPanel({ startIso, endIso }: { startIso: string; endIso: string }) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_email_delivery_summary", { p_from: startIso, p_to: endIso });
  const summary = error ? null : parseEmailDeliverySummary(data);

  if (!summary) {
    return (
      <div className="panel p-4">
        <p className="text-sm font-medium">Email delivery</p>
        <p className="mt-1 text-xs text-muted-foreground">
          This could not be loaded{error ? `: ${error.message}` : ""}. If it appeared right after a deploy, refresh in a minute.
        </p>
      </div>
    );
  }

  if (summary.totalEvents === 0) {
    return (
      <div className="panel flex flex-col gap-2 p-4">
        <p className="text-sm font-medium">Email delivery</p>
        <p className="text-xs text-muted-foreground">
          No delivery events have been recorded yet, so this cannot say whether your emails reach inboxes. To connect it: in Resend,
          open Webhooks and add an endpoint with the URL <span className="font-mono">https://www.educoreafrica.com/api/webhooks/resend</span>,
          tick delivered, bounced, complained, delivery delayed and failed, then copy its signing secret into the Vercel environment
          variable <span className="font-mono">RESEND_WEBHOOK_SECRET</span> and redeploy. Events appear here from then on; earlier
          emails are not recorded.
        </p>
      </div>
    );
  }

  const { totals, senders, problems } = summary;
  const rates = deliveryRates(totals);
  const since = summary.trackingSince ? summary.trackingSince.slice(0, 10) : null;

  return (
    <div className="panel flex flex-col gap-4 p-4">
      <div>
        <p className="text-sm font-medium">Email delivery</p>
        <p className="text-xs text-muted-foreground">
          From Resend, for events in this period (Kenya time){since ? `. Recording since ${since}` : ""}. Bounce rate is bounced out of
          delivered plus bounced; complaint rate is spam reports out of delivered.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          ["Delivered", totals.delivered],
          ["Bounced", totals.bounced],
          ["Spam reports", totals.complained],
          ["Delayed", totals.delayed],
          ["Failed", totals.failed],
        ].map(([label, value]) => (
          <div key={label as string}>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-lg font-semibold tabular-nums">{(value as number).toLocaleString()}</p>
          </div>
        ))}
      </div>

      <p className="text-sm">
        Bounce rate <span className="font-semibold">{rates.bounceRate ?? "—"}</span>
        <span className="mx-2 text-muted-foreground">·</span>
        Complaint rate <span className="font-semibold">{rates.complaintRate ?? "—"}</span>
      </p>
      {isSmallSample(rates.outcomes) && (
        <p className="text-xs text-muted-foreground">Only {rates.outcomes} emails: read the rates as anecdotes, not a trend.</p>
      )}

      {senders.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="pr-3 font-normal">Sent from</th>
                <th className="pr-3 text-right font-normal">Delivered</th>
                <th className="pr-3 text-right font-normal">Bounced</th>
                <th className="text-right font-normal">Spam reports</th>
              </tr>
            </thead>
            <tbody>
              {senders.map((s) => (
                <tr key={s.fromAddress} className="border-t">
                  <td className="py-1.5 pr-3">{s.fromAddress}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{s.delivered}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{s.bounced}</td>
                  <td className="py-1.5 text-right tabular-nums">{s.complained}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {problems.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium">Latest bounces and spam reports</p>
          <ul className="flex flex-col gap-1.5 text-sm">
            {problems.map((p, i) => (
              <li key={`${p.kenyaTime}-${p.to}-${i}`}>
                <span className="tabular-nums text-muted-foreground">{p.kenyaTime}</span> · {p.type === "complained" ? "Spam report" : "Bounced"} ·{" "}
                {p.to}
                {(p.bounceType || p.reason) && (
                  <span className="block text-xs text-muted-foreground">{[p.bounceType, p.reason].filter(Boolean).join(": ")}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
