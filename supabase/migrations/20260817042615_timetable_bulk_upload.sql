-- Bulk timetable upload (Academics > Timetable "Upload timetable" button). The
-- frontend parses the CSV/Excel file into an array of raw label rows (class
-- name, stream name, day, period, subject name, teacher name, start/end
-- time) client-side, but every actual lookup/validation happens here, in one
-- SECURITY DEFINER call, so a tampered client payload can never insert rows
-- pointing at another school's stream/subject/teacher. Each row is processed
-- in its own sub-transaction (the PL/pgSQL BEGIN/EXCEPTION block below is an
-- implicit savepoint) so one bad row never aborts the rest of the file --
-- the caller gets a per-row ok/error result back to show the user exactly
-- what to fix and re-upload.
--
-- Re-uploading is intentionally idempotent-as-a-resync: ON CONFLICT on
-- (stream_id, day_of_week, period_number) updates that slot in place, so a
-- school can fix a typo in their spreadsheet and re-upload the whole file
-- without first clearing the old timetable. The teacher-side unique
-- constraint (teacher_id, day_of_week, period_number) is left alone, so a
-- real double-booking (this teacher already has a different stream at that
-- exact day/period) still surfaces as a per-row error rather than silently
-- overwriting someone else's slot.

create or replace function public.bulk_upsert_timetable_slots(p_rows jsonb)
returns table(row_number integer, status text, message text)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school_id uuid;
  v_row jsonb;
  v_idx integer := 0;
  v_class_name text;
  v_stream_name text;
  v_day_raw text;
  v_period integer;
  v_subject_name text;
  v_teacher_name text;
  v_start text;
  v_end text;
  v_day integer;
  v_stream_id uuid;
  v_subject_id uuid;
  v_teacher_id uuid;
begin
  if not (auth_is_super_admin() or auth_has_permission('academics.write')) then
    raise exception 'Not authorized to upload the timetable.';
  end if;

  v_school_id := auth_school_id();
  if v_school_id is null and not auth_is_super_admin() then
    raise exception 'Could not resolve your school.';
  end if;

  if jsonb_array_length(p_rows) > 1000 then
    raise exception 'Too many rows in one upload (max 1000) -- split the file and upload in batches.';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_idx := v_idx + 1;
    begin
      v_class_name := trim(both from (v_row->>'class_name'));
      v_stream_name := trim(both from (v_row->>'stream_name'));
      v_day_raw := trim(both from (v_row->>'day'));
      v_period := nullif(trim(both from (v_row->>'period_number')), '')::integer;
      v_subject_name := trim(both from (v_row->>'subject_name'));
      v_teacher_name := trim(both from (v_row->>'teacher_name'));
      v_start := trim(both from (v_row->>'start_time'));
      v_end := trim(both from (v_row->>'end_time'));

      if coalesce(v_class_name, '') = '' or coalesce(v_stream_name, '') = '' then
        raise exception 'Class and Stream are required.';
      end if;

      v_day := case lower(coalesce(v_day_raw, ''))
        when 'monday' then 1 when 'mon' then 1
        when 'tuesday' then 2 when 'tue' then 2 when 'tues' then 2
        when 'wednesday' then 3 when 'wed' then 3
        when 'thursday' then 4 when 'thu' then 4 when 'thur' then 4 when 'thurs' then 4
        when 'friday' then 5 when 'fri' then 5
        when 'saturday' then 6 when 'sat' then 6
        when 'sunday' then 7 when 'sun' then 7
        else nullif(v_day_raw, '')::integer
      end;
      if v_day is null or v_day < 1 or v_day > 7 then
        raise exception 'Unrecognized day "%" -- use a day name (Monday-Sunday) or 1-7.', coalesce(v_day_raw, '(blank)');
      end if;

      if v_period is null or v_period < 1 then
        raise exception 'Period number must be a positive whole number (got "%").', coalesce(v_row->>'period_number', '(blank)');
      end if;

      select str.id into v_stream_id
        from streams str
        join classes c on c.id = str.class_id
        where c.school_id = v_school_id
          and lower(c.name) = lower(v_class_name)
          and lower(str.name) = lower(v_stream_name);
      if v_stream_id is null then
        raise exception 'No stream found matching Class "%" / Stream "%".', v_class_name, v_stream_name;
      end if;

      select id into v_subject_id from subjects
        where school_id = v_school_id and is_active = true and lower(name) = lower(v_subject_name);
      if v_subject_id is null then
        raise exception 'No active subject found matching "%".', coalesce(v_subject_name, '(blank)');
      end if;

      select id into v_teacher_id from school_users
        where school_id = v_school_id and school_users.status = 'active' and lower(full_name) = lower(v_teacher_name);
      if v_teacher_id is null then
        raise exception 'No active staff member found matching Teacher "%".', coalesce(v_teacher_name, '(blank)');
      end if;

      if v_start !~ '^([01]?[0-9]|2[0-3]):[0-5][0-9]$' then
        raise exception 'Start time must be HH:MM 24-hour format (got "%").', coalesce(v_start, '(blank)');
      end if;
      if v_end !~ '^([01]?[0-9]|2[0-3]):[0-5][0-9]$' then
        raise exception 'End time must be HH:MM 24-hour format (got "%").', coalesce(v_end, '(blank)');
      end if;
      if v_end::time <= v_start::time then
        raise exception 'End time (%) must be after start time (%).', v_end, v_start;
      end if;

      insert into timetable_slots (school_id, stream_id, subject_id, teacher_id, day_of_week, period_number, start_time, end_time)
      values (v_school_id, v_stream_id, v_subject_id, v_teacher_id, v_day, v_period, v_start::time, v_end::time)
      on conflict (stream_id, day_of_week, period_number)
      do update set subject_id = excluded.subject_id, teacher_id = excluded.teacher_id,
        start_time = excluded.start_time, end_time = excluded.end_time;

      row_number := v_idx;
      status := 'ok';
      message := format('%s / %s -- period %s (%s)', v_class_name, v_stream_name, v_period, coalesce(v_day_raw, ''));
      return next;
    exception
      when unique_violation then
        row_number := v_idx;
        status := 'error';
        if position('timetable_slots_teacher_id_day_of_week_period_number_key' in sqlerrm) > 0 then
          message := format('%s is already teaching a different stream at that day/period.', v_teacher_name);
        else
          message := 'Scheduling conflict for this slot.';
        end if;
        return next;
      when others then
        row_number := v_idx;
        status := 'error';
        message := sqlerrm;
        return next;
    end;
  end loop;

  return;
end;
$$;
revoke all on function public.bulk_upsert_timetable_slots(jsonb) from public, anon;
grant execute on function public.bulk_upsert_timetable_slots(jsonb) to authenticated;
