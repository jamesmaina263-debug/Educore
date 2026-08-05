create or replace function public.rollover_academic_year(
  p_from_academic_year_id uuid,
  p_to_academic_year_id uuid,
  p_repeat_student_ids uuid[] default '{}'
)
returns table(promoted_count integer, repeated_count integer, graduated_count integer)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school_id uuid := auth_school_id();
  v_caller_school_user_id uuid;
  v_school_max_level smallint;
  v_promoted int := 0;
  v_repeated int := 0;
  v_graduated int := 0;
  v_student record;
  v_current_level smallint;
  v_target_level smallint;
  v_target_class_id uuid;
  v_target_stream_id uuid;
  v_outcome text;
begin
  if not auth_has_permission('students.write') then
    raise exception 'Not authorized to run academic-year rollover.';
  end if;

  perform 1 from academic_years where id = p_from_academic_year_id and school_id = v_school_id;
  if not found then raise exception 'From academic year not found for this school.'; end if;
  perform 1 from academic_years where id = p_to_academic_year_id and school_id = v_school_id;
  if not found then raise exception 'To academic year not found for this school.'; end if;
  if p_from_academic_year_id = p_to_academic_year_id then
    raise exception 'From and to academic year must be different.';
  end if;

  select id into v_caller_school_user_id from school_users
    where auth_user_id = auth.uid() and status = 'active' limit 1;

  select max(level_order) into v_school_max_level from classes where school_id = v_school_id;

  for v_student in
    select st.id as student_id, st.current_class_id as stream_id,
           str.name as stream_name, c.level_order
    from students st
    join streams str on str.id = st.current_class_id
    join classes c on c.id = str.class_id
    where st.school_id = v_school_id
      and st.status = 'active'
      and c.academic_year_id = p_from_academic_year_id
  loop
    v_current_level := v_student.level_order;

    if v_student.student_id = any(p_repeat_student_ids) then
      v_target_level := v_current_level;
      v_outcome := 'repeated';
    else
      v_target_level := v_current_level + 1;
      v_outcome := 'promoted';
    end if;

    -- Graduation: student was at the school's highest-ever class level and
    -- is not on the repeat list, so there is no higher class to promote into.
    if v_outcome = 'promoted' and v_current_level = v_school_max_level then
      update students
        set status = 'graduated', current_class_id = null, status_changed_at = now()
        where id = v_student.student_id;

      insert into student_promotion_history
        (school_id, student_id, from_academic_year_id, to_academic_year_id, from_stream_id, to_stream_id, outcome, promoted_by)
      values
        (v_school_id, v_student.student_id, p_from_academic_year_id, p_to_academic_year_id, v_student.stream_id, null, 'graduated', v_caller_school_user_id);

      v_graduated := v_graduated + 1;
      continue;
    end if;

    select c2.id into v_target_class_id
      from classes c2
      where c2.school_id = v_school_id and c2.academic_year_id = p_to_academic_year_id and c2.level_order = v_target_level;

    if v_target_class_id is null then
      raise exception 'No class with level_order % exists in the target academic year — create it before running rollover.', v_target_level;
    end if;

    -- Prefer a same-named stream (e.g. "Blue" -> "Blue"); fall back to the
    -- first stream alphabetically if no name match exists in the target class.
    select str2.id into v_target_stream_id
      from streams str2
      where str2.class_id = v_target_class_id and str2.name = v_student.stream_name;

    if v_target_stream_id is null then
      select str2.id into v_target_stream_id
        from streams str2
        where str2.class_id = v_target_class_id
        order by str2.name
        limit 1;
    end if;

    if v_target_stream_id is null then
      raise exception 'No stream exists in the target class (level %) — create at least one stream before running rollover.', v_target_level;
    end if;

    update students
      set current_class_id = v_target_stream_id, status_changed_at = now()
      where id = v_student.student_id;

    insert into student_promotion_history
      (school_id, student_id, from_academic_year_id, to_academic_year_id, from_stream_id, to_stream_id, outcome, promoted_by)
    values
      (v_school_id, v_student.student_id, p_from_academic_year_id, p_to_academic_year_id, v_student.stream_id, v_target_stream_id, v_outcome, v_caller_school_user_id);

    if v_outcome = 'repeated' then
      v_repeated := v_repeated + 1;
    else
      v_promoted := v_promoted + 1;
    end if;
  end loop;

  update academic_years set status = 'closed', updated_at = now()
    where id = p_from_academic_year_id and status <> 'closed';
  update academic_years set status = 'active', updated_at = now()
    where id = p_to_academic_year_id and status = 'upcoming';

  return query select v_promoted, v_repeated, v_graduated;
end;
$$;

revoke all on function public.rollover_academic_year(uuid, uuid, uuid[]) from public;
grant execute on function public.rollover_academic_year(uuid, uuid, uuid[]) to authenticated;

comment on function public.rollover_academic_year is
  'Bulk-promotes every active student from one academic year to the next by class level_order, matching same-named stream first then falling back alphabetically. Repeaters (p_repeat_student_ids) stay at the same level. Students at the school''s highest-ever class level are marked graduated. Raises clearly if the target class/stream does not exist yet, rather than silently mis-promoting. Closes the from-year and activates the to-year (if it was upcoming).';
