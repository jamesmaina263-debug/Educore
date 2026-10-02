-- bulk_import_students: a blank Class/Stream in the upload must NOT clear a student's
-- existing stream.
--
-- Bug: the ON CONFLICT upsert set current_class_id = excluded.current_class_id. A row whose
-- Class/Stream cells were blank (or absent -- the export used to write a single
-- "Class/Stream" column the importer never read) resolved to v_stream_id = NULL and
-- overwrote the student's stream with NULL, so re-importing an exported file silently
-- unassigned every student. A blank now leaves the existing stream untouched; a
-- non-blank, valid Class + Stream still moves the student as before.
--
-- Only the current_class_id assignment in the DO UPDATE clause changes; the rest is
-- identical to the definition in 20260902141909.
create or replace function public.bulk_import_students(p_rows jsonb)
returns table(row_number integer, status text, message text)
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_school_id uuid;
  v_row jsonb;
  v_idx integer := 0;
  v_adm text;
  v_upi text;
  v_first text;
  v_last text;
  v_other text;
  v_dob date;
  v_gender text;
  v_class_name text;
  v_stream_name text;
  v_stream_id uuid;
  v_req_status text;
  v_insert_status text;
  v_adm_date date;
  v_deferred boolean;
begin
  if not (auth_is_super_admin() or auth_has_permission('settings.data_import')) then
    raise exception 'Not authorized to import school data.';
  end if;
  v_school_id := auth_school_id();
  if v_school_id is null and not auth_is_super_admin() then
    raise exception 'Could not resolve your school.';
  end if;
  if jsonb_array_length(p_rows) > 2000 then
    raise exception 'Too many rows in one upload (max 2000) -- split the file and upload in batches.';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_idx := v_idx + 1;
    v_deferred := false;
    begin
      v_adm := nullif(trim(both from (v_row->>'admission_number')), '');
      v_first := nullif(trim(both from (v_row->>'first_name')), '');
      v_last := nullif(trim(both from (v_row->>'last_name')), '');
      v_other := nullif(trim(both from (v_row->>'other_names')), '');
      v_upi := nullif(trim(both from (v_row->>'upi_number')), '');
      v_gender := lower(nullif(trim(both from (v_row->>'gender')), ''));
      v_class_name := nullif(trim(both from (v_row->>'class_name')), '');
      v_stream_name := nullif(trim(both from (v_row->>'stream_name')), '');
      v_req_status := coalesce(nullif(lower(trim(both from (v_row->>'status'))), ''), 'active');

      if v_adm is null or v_first is null or v_last is null then
        raise exception 'Admission No., First Name, and Last Name are required.';
      end if;
      if v_gender not in ('male', 'female') then
        raise exception 'Gender must be male or female (got "%").', coalesce(v_row->>'gender', '(blank)');
      end if;
      if v_req_status not in ('applied','approved','enrolled','active','withdrawn','transferred','graduated') then
        raise exception 'Unrecognized status "%".', v_req_status;
      end if;

      begin
        v_dob := nullif(trim(both from (v_row->>'date_of_birth')), '')::date;
      exception when others then
        raise exception 'DOB must be a valid date (YYYY-MM-DD).';
      end;
      if v_dob is null then
        raise exception 'DOB is required.';
      end if;

      begin
        v_adm_date := coalesce(nullif(trim(both from (v_row->>'admission_date')), '')::date, current_date);
      exception when others then
        raise exception 'Admission Date must be a valid date (YYYY-MM-DD).';
      end;

      v_stream_id := null;
      if v_class_name is not null and v_stream_name is not null then
        select str.id into v_stream_id
          from streams str
          join classes c on c.id = str.class_id
          where c.school_id = v_school_id and lower(c.name) = lower(v_class_name) and lower(str.name) = lower(v_stream_name);
        if v_stream_id is null then
          raise exception 'No stream found matching Class "%" / Stream "%" -- import Classes/Streams first, or leave blank.', v_class_name, v_stream_name;
        end if;
      end if;

      v_insert_status := v_req_status;
      if v_req_status in ('active', 'enrolled') then
        v_insert_status := 'applied'; -- see function comment; finalized once a guardian is linked
        v_deferred := true;
      end if;

      insert into students (school_id, admission_number, upi_number, first_name, last_name, other_names, date_of_birth, gender, current_class_id, status, admission_date)
      values (v_school_id, v_adm, v_upi, v_first, v_last, v_other, v_dob, v_gender, v_stream_id, v_insert_status, v_adm_date)
      on conflict (school_id, admission_number)
      do update set upi_number = excluded.upi_number, first_name = excluded.first_name, last_name = excluded.last_name,
        other_names = excluded.other_names, date_of_birth = excluded.date_of_birth, gender = excluded.gender,
        current_class_id = coalesce(excluded.current_class_id, students.current_class_id), admission_date = excluded.admission_date;
      -- status intentionally left off the update clause: re-uploading the same
      -- file must not clobber a status the school has since changed in-app.

      row_number := v_idx;
      status := 'ok';
      if v_deferred then
        message := format('%s %s imported as Applied -- import a Guardian for %s, then set status to %s.', v_first, v_last, v_adm, initcap(v_req_status));
      else
        message := format('%s %s imported.', v_first, v_last);
      end if;
      return next;
    exception
      when others then
        row_number := v_idx; status := 'error'; message := sqlerrm;
        return next;
    end;
  end loop;
  return;
end;
$$;
revoke all on function public.bulk_import_students(jsonb) from public, anon;
grant execute on function public.bulk_import_students(jsonb) to authenticated;
