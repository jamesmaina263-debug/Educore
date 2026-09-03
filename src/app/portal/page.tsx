import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { portalLogout } from "@/app/portal/actions";
import { ChildSwitcher } from "@/components/portal/child-switcher";
import { NotificationPreferencesPanel } from "@/components/notifications/preferences-panel";
import { getMyNotificationPreferences } from "@/app/notifications/actions";
import { PortalHomeworkSection, type PortalAssignmentRow } from "@/components/portal/portal-homework";
import { PortalPtMeetingsSection, type PortalSlotRow } from "@/components/portal/portal-pt-meetings";
import { PortalConnectSection, type PortalConnectItemRow } from "@/components/portal/portal-connect";
import { PortalAnnouncementsSection, type PortalAnnouncementRow } from "@/components/portal/portal-announcements";

const WEEKDAY_NAMES = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export default async function PortalPage({ searchParams }: { searchParams: Promise<{ child?: string }> }) {
  const { child: childParam } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/parent-login");

  const { data: schoolUser } = await supabase
    .from("school_users")
    .select("id, full_name, roles(name, display_name), schools(name)")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (!schoolUser) redirect("/parent-login");

  const roleName = (schoolUser.roles as unknown as { name: string; display_name: string } | null)?.name;
  const schoolName = (schoolUser.schools as unknown as { name: string } | null)?.name ?? "EduCore";

  // Staff accounts don't belong on this single-page portal — send them to the real dashboard.
  if (roleName !== "parent" && roleName !== "student") {
    redirect("/dashboard");
  }

  let students: { id: string; name: string; current_class_id: string }[] = [];

  if (roleName === "parent") {
    const { data: links } = await supabase
      .from("student_guardians")
      .select("students(id, first_name, last_name, current_class_id)")
      .eq("guardian_user_id", schoolUser.id);
    students = (links ?? [])
      .map((l) => l.students as unknown as { id: string; first_name: string; last_name: string; current_class_id: string } | null)
      .filter((s): s is NonNullable<typeof s> => s !== null)
      .map((s) => ({ id: s.id, name: `${s.first_name} ${s.last_name}`, current_class_id: s.current_class_id }));
  } else {
    const { data: own } = await supabase
      .from("students")
      .select("id, first_name, last_name, current_class_id")
      .eq("school_user_id", schoolUser.id)
      .maybeSingle();
    if (own) students = [{ id: own.id, name: `${own.first_name} ${own.last_name}`, current_class_id: own.current_class_id }];
  }

  if (students.length === 0) {
    return (
      <PortalShell schoolName={schoolName} userName={schoolUser.full_name}>
        <p className="rounded-md border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          Your child&apos;s information will appear here once the school has added it.
        </p>
      </PortalShell>
    );
  }

  const selected = students.find((s) => s.id === childParam) ?? students[0];
  const prefsResult = await getMyNotificationPreferences();
  const preferenceRows = "success" in prefsResult ? prefsResult.rows : [];

  const [{ data: balance }, { data: activeTerm }, { data: latestReportCard }, { data: account }, { data: recentPayments }] = await Promise.all([
    supabase.from("v_student_balances").select("balance, total_invoiced, credit_balance").eq("student_id", selected.id).maybeSingle(),
    supabase.from("terms").select("id, start_date, end_date").eq("status", "active").maybeSingle(),
    supabase
      .from("report_cards")
      .select("comment, generated_at, exam_id, exams(name), class_rankings(average_score, rank_in_stream)")
      .eq("student_id", selected.id)
      .in("comment_source", ["teacher_approved", "teacher_written"])
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("student_financial_accounts").select("payment_reference").eq("student_id", selected.id).maybeSingle(),
    supabase
      .from("payments")
      .select("id, method, amount, status, recorded_at, receipts(receipt_number)")
      .eq("student_id", selected.id)
      .order("recorded_at", { ascending: false })
      .limit(5),
  ]);

  const { data: assignmentRows } = await supabase
    .from("assignments")
    .select(
      "id, title, description, due_date, subjects(name), assignment_attachments(id, file_name, storage_path, file_size), assignment_submissions(id, submission_text, status, grade, feedback, student_id, assignment_submission_attachments(id, file_name, storage_path, file_size))",
    )
    .eq("stream_id", selected.current_class_id)
    .order("due_date", { ascending: false });
  const assignments: PortalAssignmentRow[] = (assignmentRows ?? []).map((a) => {
    const subject = a.subjects as unknown as { name: string } | null;
    const taskAttachments = (a.assignment_attachments ?? []) as { id: string; file_name: string; storage_path: string; file_size: number | null }[];
    const submissions = (a.assignment_submissions ?? []) as {
      id: string;
      submission_text: string;
      status: string;
      grade: string | null;
      feedback: string | null;
      student_id: string;
      assignment_submission_attachments: { id: string; file_name: string; storage_path: string; file_size: number | null }[];
    }[];
    const mine = submissions.find((s) => s.student_id === selected.id) ?? null;
    return {
      id: a.id,
      title: a.title,
      description: a.description,
      due_date: a.due_date,
      subject_name: subject?.name ?? "—",
      attachments: taskAttachments,
      submission: mine
        ? {
            id: mine.id,
            submission_text: mine.submission_text,
            status: mine.status as "submitted" | "graded",
            grade: mine.grade,
            feedback: mine.feedback,
            attachments: mine.assignment_submission_attachments ?? [],
          }
        : null,
    };
  });

  const { data: slotRows } = roleName === "parent"
    ? await supabase
        .from("pt_meeting_slots")
        .select("id, slot_date, start_time, end_time, location, capacity, school_users(full_name), pt_meeting_bookings(id, status, student_id)")
        .gte("slot_date", new Date().toISOString().slice(0, 10))
        .order("slot_date", { ascending: true })
        .order("start_time", { ascending: true })
    : { data: null };
  const ptSlots: PortalSlotRow[] = (slotRows ?? []).map((s) => {
    const teacher = s.school_users as unknown as { full_name: string } | null;
    const bookings = (s.pt_meeting_bookings ?? []) as { id: string; status: string; student_id: string }[];
    const booked = bookings.filter((b) => b.status === "booked");
    const mine = booked.find((b) => b.student_id === selected.id) ?? null;
    return {
      id: s.id,
      teacher_name: teacher?.full_name ?? "—",
      slot_date: s.slot_date,
      start_time: s.start_time,
      end_time: s.end_time,
      location: s.location,
      capacity: s.capacity,
      booked_count: booked.length,
      my_booking_id: mine?.id ?? null,
    };
  });

  // Connect is guardian-only this phase (student access explicitly out of scope for Phase 1).
  let connectItems: PortalConnectItemRow[] = [];
  if (roleName === "parent") {
    const { data: connectRows } = await supabase
      .from("connect_items")
      .select(
        "id, category, title, body, due_date, requires_response, status, created_at, connect_item_recipients(read_at, guardian_user_id), connect_item_events(id, event_type, actor_role, body, created_at)",
      )
      .eq("student_id", selected.id)
      .order("created_at", { ascending: false });
    connectItems = (connectRows ?? []).map((i) => {
      const recipients = (i.connect_item_recipients ?? []) as { read_at: string | null; guardian_user_id: string }[];
      const mine = recipients.find((r) => r.guardian_user_id === schoolUser.id) ?? recipients[0] ?? null;
      const events = (i.connect_item_events ?? []) as { id: string; event_type: string; actor_role: string; body: string | null; created_at: string }[];
      return {
        id: i.id,
        category: i.category,
        title: i.title,
        body: i.body,
        due_date: i.due_date,
        requires_response: i.requires_response,
        status: i.status,
        created_at: i.created_at,
        my_read_at: mine?.read_at ?? null,
        events: events.slice().sort((a, b) => a.created_at.localeCompare(b.created_at)),
      };
    });
  }

  // Announcements are guardian-only this phase, same as Connect, and are not
  // filtered to the selected child: whole_school/grade scoped notices apply
  // across all of a guardian's children, not just the one currently selected.
  let announcementItems: PortalAnnouncementRow[] = [];
  if (roleName === "parent") {
    const { data: recipientRows } = await supabase
      .from("announcement_recipients")
      .select(
        "read_at, acknowledged_at, completed_at, announcements(id, title, body, urgency, status, created_at, withdrawal_reason, announcement_attachments(id, storage_path, file_name))",
      )
      .eq("guardian_user_id", schoolUser.id);
    announcementItems = (recipientRows ?? [])
      .map((r) => {
        const a = r.announcements as unknown as {
          id: string;
          title: string;
          body: string;
          urgency: "normal" | "action_required" | "urgent";
          status: string;
          created_at: string;
          withdrawal_reason: string | null;
          announcement_attachments: { id: string; storage_path: string; file_name: string }[] | null;
        } | null;
        if (!a) return null;
        return {
          id: a.id,
          title: a.title,
          body: a.body,
          urgency: a.urgency,
          status: a.status,
          created_at: a.created_at,
          withdrawal_reason: a.withdrawal_reason,
          my_read_at: r.read_at,
          my_acknowledged_at: r.acknowledged_at,
          my_completed_at: r.completed_at,
          attachments: a.announcement_attachments ?? [],
        };
      })
      .filter((a): a is PortalAnnouncementRow => a !== null)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  let attendanceRate: number | null = null;
  if (activeTerm) {
    const { data: attendanceRows } = await supabase
      .from("student_attendance")
      .select("status")
      .eq("student_id", selected.id)
      .eq("session", "class")
      .gte("attendance_date", activeTerm.start_date)
      .lte("attendance_date", activeTerm.end_date);
    if (attendanceRows && attendanceRows.length > 0) {
      const present = attendanceRows.filter((r) => r.status === "present").length;
      attendanceRate = Math.round((present / attendanceRows.length) * 100);
    }
  }

  let todaysTimetable: { subject_name: string; start_time: string; end_time: string }[] = [];
  if (roleName === "student") {
    // Postgres ISO day-of-week (1=Monday..7=Sunday) — no prior convention exists in the codebase,
    // since the Timetable UI itself was deferred in Phase 1 (schema only). Chosen as the standard
    // Mon-Fri school-week default; whichever convention actually populates timetable_slots data
    // later should match this.
    const { data: slots } = await supabase
      .from("timetable_slots")
      .select("start_time, end_time, subjects(name)")
      .eq("stream_id", selected.current_class_id)
      .eq("day_of_week", new Date().getDay() === 0 ? 7 : new Date().getDay())
      .order("start_time");
    todaysTimetable = (slots ?? []).map((s) => ({
      subject_name: (s.subjects as unknown as { name: string } | null)?.name ?? "",
      start_time: s.start_time,
      end_time: s.end_time,
    }));
  }

  const rc = latestReportCard as unknown as {
    comment: string | null;
    generated_at: string;
    exam_id: string;
    exams: { name: string } | null;
    class_rankings: { average_score: number; rank_in_stream: number } | { average_score: number; rank_in_stream: number }[] | null;
  } | null;
  const ranking = rc?.class_rankings ? (Array.isArray(rc.class_rankings) ? rc.class_rankings[0] : rc.class_rankings) : null;

  // Sub-strand CBC competency breakdown for that same released report card, if this class
  // uses the CBC (band-based) grading model -- an empty array for a purely numeric class is
  // expected and renders nothing extra, same as report-card-list.tsx's equivalent section.
  const { data: competencyRows } = rc
    ? await supabase
        .from("competency_marks")
        .select("grading_scale_bands(label), curriculum_sub_strands(name, curriculum_strands(name, subjects(name)))")
        .eq("exam_id", rc.exam_id)
        .eq("student_id", selected.id)
    : { data: [] };
  const competencyLines = (competencyRows ?? []).map((c) => {
    const subStrand = c.curriculum_sub_strands as unknown as {
      name: string;
      curriculum_strands: { name: string; subjects: { name: string } | null } | null;
    } | null;
    const strand = subStrand?.curriculum_strands ?? null;
    return {
      subject_name: strand?.subjects?.name ?? "",
      strand_name: strand?.name ?? "",
      sub_strand_name: subStrand?.name ?? "",
      band_label: (c.grading_scale_bands as unknown as { label: string } | null)?.label ?? "—",
    };
  });

  return (
    <PortalShell schoolName={schoolName} userName={schoolUser.full_name}>
      <ChildSwitcher options={students} selectedId={selected.id} />

      <div className="panel p-4">
        <p className="label-eyebrow">Fee balance</p>
        {balance ? (
          <p className={`mt-1 text-lg font-semibold ${Number(balance.balance) > 0 ? "text-danger" : "text-success"}`}>
            KES {Number(balance.balance).toLocaleString()}
            {Number(balance.balance) > 0 && " ⚠"}
          </p>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">No invoices yet.</p>
        )}
        {balance && Number(balance.credit_balance) > 0 && (
          <p className="mt-1 text-sm text-success">Credit on account: KES {Number(balance.credit_balance).toLocaleString()}</p>
        )}
        {account && (
          <p className="mt-2 text-xs text-muted-foreground">
            Payment reference: <span className="font-mono font-medium text-foreground">{account.payment_reference}</span>
            <br />Quote this reference (not the student&apos;s name) when paying via M-Pesa, bank, or in person, so the school can match your payment automatically.
          </p>
        )}
        {(recentPayments ?? []).length > 0 && (
          <div className="mt-3 border-t border-border pt-3">
            <p className="mb-1 text-xs font-medium text-muted-foreground">Recent payments</p>
            <ul className="flex flex-col gap-1 text-sm">
              {(recentPayments ?? []).map((p) => {
                const receipt = p.receipts as unknown as { receipt_number: string } | { receipt_number: string }[] | null;
                const receiptNumber = Array.isArray(receipt) ? receipt[0]?.receipt_number : receipt?.receipt_number;
                return (
                  <li key={p.id} className="flex items-center justify-between">
                    <span>
                      {new Date(p.recorded_at).toLocaleDateString()} · {p.method}
                      {p.status === "reversed" && <span className="ml-1 text-danger">(reversed)</span>}
                    </span>
                    <span className="font-medium">
                      KES {Number(p.amount).toLocaleString()}
                      {receiptNumber && <span className="ml-1 font-mono text-xs text-muted-foreground">{receiptNumber}</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      <div className="panel p-4">
        <p className="label-eyebrow">Attendance this term</p>
        <p className="mt-1 text-lg font-semibold">{attendanceRate !== null ? `${attendanceRate}%` : "No records yet"}</p>
      </div>

      {roleName === "student" && (
        <div className="panel p-4">
          <p className="label-eyebrow mb-2">
            Today ({WEEKDAY_NAMES[new Date().getDay() === 0 ? 7 : new Date().getDay()]})
          </p>
          {todaysTimetable.length === 0 ? (
            <p className="text-sm text-muted-foreground">No classes scheduled for today yet.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {todaysTimetable.map((s, i) => (
                <li key={i}>
                  {s.start_time.slice(0, 5)} {s.subject_name}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="panel p-4">
        <p className="label-eyebrow mb-1">Latest result</p>
        {rc ? (
          <div>
            <p className="text-sm font-medium">
              {rc.exams?.name}
              {ranking && ` — Average ${ranking.average_score}, Rank ${ranking.rank_in_stream} in stream`}
            </p>
            {rc.comment && <p className="mt-1 text-sm text-muted-foreground">{rc.comment}</p>}
            {competencyLines.length > 0 && (
              <div className="mt-2 border-t border-border pt-2">
                <p className="mb-1 text-xs font-medium text-muted-foreground">CBC competency ratings</p>
                <ul className="flex flex-col gap-0.5 text-sm">
                  {competencyLines.map((c, i) => (
                    <li key={`${c.sub_strand_name}-${i}`} className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">
                        {c.subject_name} — {c.strand_name} — {c.sub_strand_name}
                      </span>
                      <span className="font-medium">{c.band_label}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No results published yet.</p>
        )}
      </div>

      <div className="panel p-4">
        <p className="label-eyebrow mb-2">Homework</p>
        <PortalHomeworkSection studentId={selected.id} assignments={assignments} />
      </div>

      {roleName === "parent" && (
        <div className="panel p-4">
          <p className="label-eyebrow mb-2">Parent-teacher meetings</p>
          <PortalPtMeetingsSection studentId={selected.id} slots={ptSlots} />
        </div>
      )}

      {roleName === "parent" && (
        <div className="panel p-4">
          <p className="label-eyebrow mb-2">Announcements</p>
          <PortalAnnouncementsSection items={announcementItems} />
        </div>
      )}

      <div className="panel p-4">
        <p className="label-eyebrow mb-2">Recent messages</p>
        <PortalConnectSection items={connectItems} />
      </div>

      <div className="panel p-4">
        <p className="label-eyebrow mb-2">Notification preferences</p>
        <NotificationPreferencesPanel initialRows={preferenceRows} />
      </div>
    </PortalShell>
  );
}

function PortalShell({ schoolName, userName, children }: { schoolName: string; userName: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col gap-4 bg-background p-4">
      <div className="flex items-center justify-between border-b border-border pb-3">
        <div>
          <p className="text-sm font-semibold">{schoolName}</p>
          <p className="text-xs text-muted-foreground">{userName}</p>
        </div>
        <form action={portalLogout}>
          <button type="submit" className="text-xs text-muted-foreground underline">
            Sign out
          </button>
        </form>
      </div>
      {children}
    </div>
  );
}
