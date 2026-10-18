-- Notify guardians (SMS) when a report card is released.
--
-- A report card is "released" -- visible to the parent/student portal by RLS -- the moment its
-- comment_source becomes 'teacher_approved' or 'teacher_written' (20260801032002). Until now
-- nothing told the family. This adds a trigger on report_cards that queues ONE SMS per eligible
-- guardian into notification_logs (status 'queued'); the existing dispatch-communications cron /
-- send-communication Edge Function sends it, exactly like the 3-day absence alert.
--
-- Design points:
--   * Same mechanism as check_consecutive_absences(): SECURITY DEFINER trigger inserting into
--     notification_logs with sent_by null. queue_communication() is NOT used because it requires
--     communication.write, which a class teacher approving a comment does not hold.
--   * Respects each guardian's own opt-out: notification_allowed(guardian, 'result_published',
--     'sms'), default enabled (the existing opt-out model; managed in the portal's Notification
--     preferences panel).
--   * Recipients: the student's primary-contact guardians with a phone number; if the student has
--     no primary contact flagged, every guardian with a phone number.
--   * Once per report card. A mark correction after approval resets the card to unapproved
--     (20260826100000) and a re-approval would otherwise text the family again; the
--     report_card_release_notifications row makes later releases of the same card silent (the
--     portal already shows the corrected marks).
--   * The SMS names the school, the child's first name and the exam only. No marks, ranks or
--     comment text ever go over SMS.
--   * Never blocks approval: all notification work runs inside an exception block, so any failure
--     here (bad data, missing row) logs a warning and the teacher's approval still succeeds.
--
-- ADDITIVE: one new internal table and one new trigger function/trigger. No existing table,
-- policy or function is changed.

create table report_card_release_notifications (
  report_card_id uuid primary key references report_cards(id) on delete cascade,
  queued_at timestamptz not null default now(),
  recipients smallint not null default 0
);
comment on table report_card_release_notifications is
  'One row per report card whose release has already been announced to guardians, so a re-approval never sends a second SMS. recipients = SMS rows queued. Internal: RLS on with no policies (only the SECURITY DEFINER trigger writes).';
alter table report_card_release_notifications enable row level security;

create or replace function public.notify_guardians_on_report_card_release()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_first text;
  v_school text;
  v_exam text;
  v_has_primary boolean;
  v_body text;
  v_count integer := 0;
  g record;
begin
  if new.comment_source not in ('teacher_approved', 'teacher_written') then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.comment_source in ('teacher_approved', 'teacher_written') then
    return new;
  end if;

  begin
    insert into report_card_release_notifications (report_card_id) values (new.id) on conflict do nothing;
    if not found then
      return new; -- already announced once for this report card
    end if;

    select st.first_name, s.name into v_first, v_school
    from students st join schools s on s.id = st.school_id
    where st.id = new.student_id;
    select name into v_exam from exams where id = new.exam_id;

    v_body := format('%s: %s''s %s report card is now available. Log in to the parent portal to view it.',
                     coalesce(v_school, 'School'), coalesce(v_first, 'your child'), coalesce(v_exam, 'exam'));

    select exists (select 1 from student_guardians where student_id = new.student_id and primary_contact = true)
      into v_has_primary;

    for g in
      select su.id as guardian_id, su.phone
      from student_guardians sg
      join school_users su on su.id = sg.guardian_user_id
      where sg.student_id = new.student_id
        and su.phone is not null and btrim(su.phone) <> ''
        and (not v_has_primary or sg.primary_contact = true)
    loop
      if not notification_allowed(g.guardian_id, 'result_published', 'sms') then
        continue;
      end if;
      insert into notification_logs (school_id, student_id, recipient_phone, recipient_type, channel, body, segments, sent_by)
      values (new.school_id, new.student_id, g.phone, 'guardian', 'sms', v_body,
              greatest(1, ceil(length(v_body)::numeric / 160))::smallint, null);
      v_count := v_count + 1;
    end loop;

    update report_card_release_notifications set recipients = v_count where report_card_id = new.id;
  exception when others then
    raise warning 'report card release notification failed for report_card %: %', new.id, sqlerrm;
  end;

  return new;
end;
$$;

revoke all on function public.notify_guardians_on_report_card_release() from public, anon, authenticated;

drop trigger if exists trg_report_cards_notify_guardians on public.report_cards;
create trigger trg_report_cards_notify_guardians
after insert or update of comment_source on public.report_cards
for each row
when (new.comment_source in ('teacher_approved', 'teacher_written'))
execute function public.notify_guardians_on_report_card_release();
