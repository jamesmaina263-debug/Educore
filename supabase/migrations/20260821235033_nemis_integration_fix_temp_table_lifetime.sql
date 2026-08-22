-- Fixes a real bug found during verification: "create temporary table ... on commit drop"
-- only drops the table at transaction commit, not statement end, so calling
-- generate_nemis_sync_batch() twice within the same not-yet-committed transaction raised
-- "relation tmp_nemis_batch_students already exists". Replaced with a plain uuid[] variable,
-- which has no such lifetime issue. See repo migration
-- 20260821112851_nemis_integration.sql (updated in place) for full comments.
create or replace function public.generate_nemis_sync_batch(
  p_batch_type text,
  p_student_ids uuid[] default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_school_id uuid;
  v_actor uuid;
  v_batch_id uuid;
  v_count integer;
  v_student_ids uuid[];
begin
  if not public.auth_has_permission('nemis.manage') then
    raise exception 'Not authorized to generate NEMIS batches.';
  end if;
  if p_batch_type not in ('new_admissions', 'full_roster') then
    raise exception 'Invalid batch type.';
  end if;

  v_school_id := public.auth_school_id();
  select su.id into v_actor from public.school_users su
    where su.auth_user_id = auth.uid() and su.status = 'active';
  if v_actor is null then
    raise exception 'No active school user for the current session.';
  end if;

  if p_student_ids is not null then
    if exists (
      select 1 from unnest(p_student_ids) sid
      where not exists (
        select 1 from public.students st
        where st.id = sid and st.school_id = v_school_id
          and st.status in ('enrolled', 'active')
          and st.nemis_sync_status = 'not_submitted'
      )
    ) then
      raise exception 'One or more selected students are not eligible for a NEMIS batch (wrong school, already synced, or not enrolled).';
    end if;
  end if;

  select array_agg(st.id) into v_student_ids
  from public.students st
  where st.school_id = v_school_id
    and st.status in ('enrolled', 'active')
    and st.nemis_sync_status = 'not_submitted'
    and (p_student_ids is null or st.id = any (p_student_ids));

  v_count := coalesce(array_length(v_student_ids, 1), 0);
  if v_count = 0 then
    raise exception 'No eligible students to include in a NEMIS batch.';
  end if;

  insert into public.nemis_sync_batches (school_id, batch_type, generated_by, student_count, notes)
  values (v_school_id, p_batch_type, v_actor, v_count, p_notes)
  returning id into v_batch_id;

  insert into public.nemis_sync_batch_students (batch_id, student_id, upi_number_snapshot, birth_certificate_number_snapshot)
  select v_batch_id, st.id, st.upi_number, st.birth_certificate_number
  from public.students st
  where st.id = any (v_student_ids);

  update public.students
  set nemis_sync_status = 'included_in_batch'
  where id = any (v_student_ids);

  return v_batch_id;
end;
$function$;
revoke all on function public.generate_nemis_sync_batch(text, uuid[], text) from public;
grant execute on function public.generate_nemis_sync_batch(text, uuid[], text) to authenticated;
