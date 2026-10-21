import { createClient } from "@/lib/supabase/server";
import { countryLabel, deviceLabel, landedOnSignup, parseSignupVisitors } from "@/lib/growth/signup-visitors";

// "Who opened /signup" list under the trial funnel. Anonymous rows from our own visit counter (no names,
// emails, IPs or visitor ids). One read-only call; if it fails the panel says so rather than showing an empty list.

export async function SignupVisitorsPanel({ startIso, endIso }: { startIso: string; endIso: string }) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_signup_visitors", { p_from: startIso, p_to: endIso });
  const visitors = error ? null : parseSignupVisitors(data);

  if (!visitors) {
    return (
      <div className="panel p-4">
        <p className="text-sm font-medium">Who opened /signup</p>
        <p className="mt-1 text-xs text-muted-foreground">
          This could not be loaded{error ? `: ${error.message}` : ""}. If it appeared right after a deploy, refresh in a minute.
        </p>
      </div>
    );
  }

  const multiDay = startIso !== endIso;

  return (
    <div className="panel flex flex-col gap-3 p-4">
      <div>
        <p className="text-sm font-medium">Who opened /signup</p>
        <p className="text-xs text-muted-foreground">
          One row per visitor per day, newest first, times in Kenya. Anonymous: no names or contact details. The same person on two
          days shows twice, and your own test visits are included.
        </p>
      </div>
      {visitors.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nobody opened /signup in this period.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                {multiDay && <th className="pr-3 font-normal">Day</th>}
                <th className="pr-3 font-normal">Arrived</th>
                <th className="pr-3 font-normal">Opened /signup</th>
                <th className="pr-3 font-normal">Landed on</th>
                <th className="pr-3 font-normal">Came from</th>
                <th className="pr-3 font-normal">Country</th>
                <th className="pr-3 font-normal">Device</th>
                <th className="text-right font-normal">Pages</th>
              </tr>
            </thead>
            <tbody>
              {visitors.map((v, i) => (
                <tr key={`${v.day}-${v.firstSeenTime}-${i}`} className="border-t">
                  {multiDay && <td className="py-1.5 pr-3 tabular-nums">{v.day}</td>}
                  <td className="py-1.5 pr-3 tabular-nums">{v.firstSeenTime}</td>
                  <td className="py-1.5 pr-3 tabular-nums">{v.signupTime}</td>
                  <td className="py-1.5 pr-3">{landedOnSignup(v) ? "/signup (directly)" : v.entryPath}</td>
                  <td className="py-1.5 pr-3">
                    {v.source}
                    {v.campaign && <span className="block text-xs text-muted-foreground">{v.campaign}</span>}
                  </td>
                  <td className="py-1.5 pr-3">{countryLabel(v.country)}</td>
                  <td className="py-1.5 pr-3">{deviceLabel(v.device)}</td>
                  <td className="py-1.5 text-right tabular-nums">{v.pages}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {visitors.length >= 100 && <p className="text-xs text-muted-foreground">Showing the latest 100 only.</p>}
    </div>
  );
}
