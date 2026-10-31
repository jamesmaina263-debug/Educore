import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/sales/pipeline";
import { PriorityBadge, ProgressBar, StatusBadge } from "@/components/admin/onboarding/onboarding-badges";
import { SchoolActions } from "@/components/admin/onboarding/school-actions";
import {
  AUDIT_EVENT_LABELS,
  FOLLOWUP_STATUS_LABELS,
  RULE_LABELS,
  buildTimeline,
  daysLabel,
  formatDate,
  formatDateTime,
  recommendedNextAction,
  type SchoolDetail,
} from "@/lib/onboarding/onboarding";

export const dynamic = "force-dynamic";

// One school's onboarding: timeline, account and login history, milestones, every reminder and alert, the audit trail,
// a recommended next action, and admin notes. Super admin only; the database function re-checks that.
export default async function AdminOnboardingSchoolPage({ params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  if (!isUuid(schoolId)) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: isSuperAdmin } = await supabase.rpc("auth_is_super_admin");
  if (isSuperAdmin !== true) redirect("/dashboard");

  const [detailRes, teamRes] = await Promise.all([
    supabase.rpc("admin_onboarding_school_detail", { p_school_id: schoolId }),
    supabase.from("platform_team_members").select("id, name").eq("active", true).order("name"),
  ]);
  if (detailRes.error) {
    if (/not found/i.test(detailRes.error.message)) notFound();
    return (
      <div className="flex flex-col gap-2">
        <Link href="/admin/onboarding" className="text-xs text-muted-foreground underline">
          Back to school onboarding
        </Link>
        <p className="text-xs text-destructive" role="alert">
          This school could not be read ({detailRes.error.message}).
        </p>
      </div>
    );
  }

  const detail = detailRes.data as SchoolDetail;
  const s = detail.school;
  const team = (teamRes.data ?? []) as { id: string; name: string }[];
  const timeline = buildTimeline(detail);
  const action = recommendedNextAction(s, detail.milestone_config);
  const enabled = detail.milestone_config.filter((m) => m.enabled);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link href="/admin/onboarding" className="text-xs text-muted-foreground underline">
          Back to school onboarding
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold">{s.school_name}</h1>
          <StatusBadge status={s.status} />
          <PriorityBadge priority={s.priority} />
        </div>
        <p className="text-sm text-muted-foreground">
          Registered {formatDate(s.registered_at)} · {s.school_status} · last activity {daysLabel(s.days_since_activity)}
          {s.days_since_activity === 0 ? "" : " ago"}
        </p>
      </div>

      <section aria-labelledby="next-heading" className="rounded-md border border-primary/30 bg-primary-subtle p-4">
        <h2 id="next-heading" className="text-sm font-semibold">
          Recommended next action
        </h2>
        <p className="text-sm">{action}</p>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-labelledby="account-heading" className="flex flex-col gap-2 rounded-md border border-border bg-surface p-4">
          <h2 id="account-heading" className="text-sm font-semibold">
            Account
          </h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Administrator</dt>
            <dd>{s.admin_name ?? "—"}</dd>
            <dt className="text-muted-foreground">Email</dt>
            <dd>{s.admin_email ?? "—"}</dd>
            <dt className="text-muted-foreground">Email verified</dt>
            <dd>{formatDateTime(s.email_verified_at)}</dd>
            <dt className="text-muted-foreground">Password changed</dt>
            <dd>{formatDateTime(s.password_changed_at)}</dd>
            <dt className="text-muted-foreground">First login</dt>
            <dd>{formatDateTime(s.first_login_at)}</dd>
            <dt className="text-muted-foreground">Last login</dt>
            <dd>{formatDateTime(s.last_login_at)}</dd>
            <dt className="text-muted-foreground">Last seen in the app</dt>
            <dd>{formatDateTime(s.last_seen_at)}</dd>
          </dl>
        </section>

        <section aria-labelledby="milestones-heading" className="flex flex-col gap-2 rounded-md border border-border bg-surface p-4">
          <div className="flex items-center justify-between">
            <h2 id="milestones-heading" className="text-sm font-semibold">
              Milestones
            </h2>
            <ProgressBar pct={s.progress_pct} />
          </div>
          <ul className="flex flex-col gap-1 text-sm">
            {enabled.map((m) => {
              const done = s.milestones[m.key] === true;
              return (
                <li key={m.key} className="flex items-center justify-between">
                  <span>
                    {m.label}
                    {m.required && <span className="ml-1 text-xs text-muted-foreground">(required)</span>}
                  </span>
                  <span className={done ? "text-emerald-800" : "text-muted-foreground"}>{done ? "Done" : "Not yet"}</span>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-muted-foreground">
            {s.student_count} students · {s.class_count} classes · {s.academic_year_count} academic years · {s.fee_structure_count} fee structures · {s.user_count} staff accounts
          </p>
        </section>
      </div>

      <SchoolActions schoolId={s.school_id} status={s.status} notes={detail.notes} team={team} />

      <section aria-labelledby="timeline-heading" className="flex flex-col gap-2 rounded-md border border-border bg-surface p-4">
        <h2 id="timeline-heading" className="text-sm font-semibold">
          Onboarding timeline
        </h2>
        <ol className="flex flex-col divide-y divide-border">
          {timeline.slice(0, 60).map((e, i) => (
            <li key={`${e.at}-${i}`} className="flex flex-wrap justify-between gap-2 py-1.5 text-sm">
              <span>{e.label}</span>
              <span className="text-xs text-muted-foreground">{formatDateTime(e.at)}</span>
            </li>
          ))}
        </ol>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-labelledby="reminders-heading" className="flex flex-col gap-2 rounded-md border border-border bg-surface p-4">
          <h2 id="reminders-heading" className="text-sm font-semibold">
            Reminders and alerts
          </h2>
          {detail.followups.length === 0 && detail.messages.length === 0 ? (
            <p className="text-xs text-muted-foreground">None yet.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border text-sm">
              {detail.followups.map((f) => (
                <li key={f.id} className="flex flex-wrap justify-between gap-2 py-1.5">
                  <span>{RULE_LABELS[f.rule_key] ?? f.rule_key}</span>
                  <span className="text-xs text-muted-foreground">
                    {FOLLOWUP_STATUS_LABELS[f.status] ?? f.status} · {formatDate(f.created_at)}
                  </span>
                </li>
              ))}
              {detail.messages.map((m) => (
                <li key={m.id} className="flex flex-wrap justify-between gap-2 py-1.5">
                  <span>
                    Email {m.auto_rule ? "(automatic)" : "(by the team)"}: {m.subject}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {m.status} · {formatDate(m.sent_at ?? m.queued_at ?? m.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="audit-heading" className="flex flex-col gap-2 rounded-md border border-border bg-surface p-4">
          <h2 id="audit-heading" className="text-sm font-semibold">
            Audit trail
          </h2>
          {detail.audit.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nothing recorded yet.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border text-sm">
              {detail.audit.slice(0, 40).map((a, i) => (
                <li key={`${a.created_at}-${i}`} className="flex flex-wrap justify-between gap-2 py-1.5">
                  <span>
                    {AUDIT_EVENT_LABELS[a.event] ?? a.event}
                    <span className="ml-1 text-xs text-muted-foreground">({a.actor === "system" ? "automatic" : "team"})</span>
                  </span>
                  <span className="text-xs text-muted-foreground">{formatDateTime(a.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
