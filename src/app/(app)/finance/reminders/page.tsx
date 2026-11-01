import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hasFeatureFlag } from "@/lib/feature-flags";
import { loadFinanceContext } from "../_data";
import { FinancePageShell } from "@/components/finance/finance-page-shell";
import { FeeRemindersSection, type ReminderRow, type TemplateOption } from "@/components/finance/fee-reminders-section";
import { DEFAULT_SCHEDULE, REMINDER_FLAG, templateProblem, type DeliveryStatus, type ReminderSchedule } from "@/lib/fee-reminders";

export default async function FinanceRemindersPage() {
  const supabase = await createClient();

  // Hidden entirely unless the school has the flag. hasFeatureFlag fails closed (any error => false).
  if (!(await hasFeatureFlag(supabase, REMINDER_FLAG))) notFound();

  const ctx = await loadFinanceContext([]);

  let schedule: ReminderSchedule = DEFAULT_SCHEDULE;
  let reminders: ReminderRow[] = [];
  let templates: TemplateOption[] = [];

  if (ctx.canRead && ctx.canWrite) {
    const { data: s } = await supabase
      .from("fee_reminder_schedules")
      .select("enabled, frequency, run_weekday, run_day_of_month, channel, min_balance, min_days_between, template_id")
      .maybeSingle();
    if (s) {
      schedule = {
        enabled: s.enabled as boolean,
        frequency: s.frequency as ReminderSchedule["frequency"],
        runWeekday: Number(s.run_weekday),
        runDayOfMonth: Number(s.run_day_of_month),
        channel: s.channel as ReminderSchedule["channel"],
        minBalance: Number(s.min_balance),
        minDaysBetween: Number(s.min_days_between),
        templateId: (s.template_id as string | null) ?? null,
      };
    }

    // The school's saved fee-reminder templates (Communication > Templates). Visible only to roles that
    // can read communication; others simply see EduCore's default message.
    const { data: tplRows } = await supabase
      .from("communication_templates")
      .select("id, name, channel, body")
      .eq("category", "fee_reminder")
      .order("name", { ascending: true });
    templates = (tplRows ?? []).map((t) => ({
      id: t.id as string,
      name: t.name as string,
      channel: (t.channel as string | null) ?? null,
      body: t.body as string,
      problem: templateProblem(t.body as string),
    }));

    // Delivery state of reminders that were queued (a failed delivery becomes eligible again at the next run).
    const { data: deliveryRows } = await supabase.rpc("fee_reminder_delivery_statuses");
    const delivery = new Map<string, DeliveryStatus>(
      ((deliveryRows ?? []) as { reminder_id: string; delivery_status: string }[]).map((d) => [d.reminder_id, d.delivery_status as DeliveryStatus]),
    );

    const { data: rows } = await supabase
      .from("fee_reminders")
      .select(
        "id, balance_at_generation, draft_body, status, channel, run_on, generated_at, sent_at, dismiss_reason, cancel_reason, edited, students(first_name, last_name), school_users!fee_reminders_guardian_user_id_fkey(full_name, phone)",
      )
      .order("generated_at", { ascending: false })
      .limit(300);

    reminders = (rows ?? []).map((r) => {
      const st = r.students as unknown as { first_name: string; last_name: string } | null;
      const g = r.school_users as unknown as { full_name: string; phone: string | null } | null;
      return {
        id: r.id as string,
        studentName: st ? `${st.first_name} ${st.last_name}` : "Unknown learner",
        guardianName: g?.full_name ?? "Unknown guardian",
        guardianPhone: g?.phone ?? "No phone on file",
        balance: Number(r.balance_at_generation),
        draftBody: r.draft_body as string,
        status: r.status as ReminderRow["status"],
        channel: r.channel as ReminderRow["channel"],
        runOn: r.run_on as string,
        sentAt: (r.sent_at as string | null) ?? null,
        dismissReason: (r.dismiss_reason as string | null) ?? null,
        cancelReason: (r.cancel_reason as string | null) ?? null,
        edited: Boolean(r.edited),
        delivery: delivery.get(r.id as string) ?? null,
      };
    });
  }

  return (
    <FinancePageShell
      ctx={ctx}
      section="Fee Reminders"
      title="Fee Reminders"
      subtitle="Scheduled, draft-and-approve reminders for families with a fee balance"
    >
      <FeeRemindersSection schedule={schedule} reminders={reminders} templates={templates} canWrite={ctx.canWrite} />
    </FinancePageShell>
  );
}
