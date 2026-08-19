-- check_consecutive_absences() walked back one CALENDAR day at a time
-- (attendance_date - 1), despite its own comment claiming "3 consecutive
-- SCHOOL days". Since attendance is only ever marked on school days, any
-- absence streak spanning a weekend (e.g. absent Friday, then Monday and
-- Tuesday -- a common real pattern) had no row for Saturday/Sunday to
-- bridge the calendar-day chain, so the streak silently reset and the
-- alert never fired. Live-verified before this fix: a simulated Fri/Mon/Tue
-- absence queued zero alerts; a same-week Mon/Tue/Wed streak (no weekend
-- gap) correctly queued one.
--
-- Fix: count the streak over the student's actual marked register days
-- (ordered by attendance_date, whatever days those happen to be), not
-- assumed calendar adjacency. This naturally bridges weekends, holidays,
-- and any other gap in the register -- no day-of-week logic needed, and it
-- keeps working correctly for a school that does mark Saturday attendance.
create or replace function check_consecutive_absences() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_streak integer;
  v_guardian_phone text;
  v_student_name text;
  v_school_name text;
  v_school_id uuid;
begin
  if new.status != 'absent' then
    return new;
  end if;

  with recent as (
    select status,
           row_number() over (order by attendance_date desc) as rn
    from student_attendance
    where student_id = new.student_id and session = 'class' and attendance_date <= new.attendance_date
    order by attendance_date desc
    limit 10
  ),
  first_break as (
    select min(rn) as rn from recent where status != 'absent'
  )
  select coalesce((select rn - 1 from first_break), (select count(*) from recent))
    into v_streak;

  if v_streak != 3 then
    return new; -- only fire the day the streak crosses 3, never re-fire on day 4+
  end if;

  select st.school_id, (st.first_name || ' ' || st.last_name), s.name
    into v_school_id, v_student_name, v_school_name
  from students st join schools s on s.id = st.school_id
  where st.id = new.student_id;

  select su.phone into v_guardian_phone
  from student_guardians sg
  join school_users su on su.id = sg.guardian_user_id
  where sg.student_id = new.student_id and sg.primary_contact = true
  limit 1;

  if v_guardian_phone is null then
    return new; -- no primary guardian phone on file; nothing to queue
  end if;

  insert into notification_logs (school_id, student_id, recipient_phone, recipient_type, body, segments, sent_by)
  values (
    v_school_id, new.student_id, v_guardian_phone, 'guardian',
    format('%s: %s has been absent for 3 consecutive school days. Please contact the school office.', v_school_name, v_student_name),
    1, null
  );

  return new;
end;
$$;
