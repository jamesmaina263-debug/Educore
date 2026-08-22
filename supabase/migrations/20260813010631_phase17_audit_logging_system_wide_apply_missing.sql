create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_actor uuid;
  v_school_id uuid;
  v_record_id uuid;
  v_old jsonb;
  v_new jsonb;
begin
  select su.id into v_actor from school_users su where su.auth_user_id = auth.uid() and su.status = 'active';

  if tg_op = 'DELETE' then
    v_school_id := old.school_id;
    v_record_id := old.id;
  else
    v_school_id := new.school_id;
    v_record_id := new.id;
  end if;

  if v_school_id is null then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  if tg_op = 'INSERT' then
    insert into audit_log (school_id, actor_school_user_id, table_name, record_id, action, new_data)
    values (v_school_id, v_actor, tg_table_name, v_record_id, 'create', to_jsonb(new));
  elsif tg_op = 'DELETE' then
    insert into audit_log (school_id, actor_school_user_id, table_name, record_id, action, old_data)
    values (v_school_id, v_actor, tg_table_name, v_record_id, 'delete', to_jsonb(old));
  elsif tg_op = 'UPDATE' then
    v_old := to_jsonb(old) - 'updated_at';
    v_new := to_jsonb(new) - 'updated_at';
    if v_old is distinct from v_new then
      insert into audit_log (school_id, actor_school_user_id, table_name, record_id, action, old_data, new_data)
      values (v_school_id, v_actor, tg_table_name, v_record_id, 'update', v_old, v_new);
    end if;
  end if;

  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$function$;
revoke all on function public.audit_row_change() from public;
revoke execute on function public.audit_row_change() from anon, authenticated;

create or replace function public.audit_row_change_via_student()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_actor uuid;
  v_school_id uuid;
  v_record_id uuid;
  v_student_id uuid;
  v_old jsonb;
  v_new jsonb;
begin
  select su.id into v_actor from school_users su where su.auth_user_id = auth.uid() and su.status = 'active';

  v_student_id := coalesce(new.student_id, old.student_id);
  select st.school_id into v_school_id from students st where st.id = v_student_id;
  if v_school_id is null then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  if tg_op = 'DELETE' then v_record_id := old.id; else v_record_id := new.id; end if;

  if tg_op = 'INSERT' then
    insert into audit_log (school_id, actor_school_user_id, table_name, record_id, action, new_data)
    values (v_school_id, v_actor, tg_table_name, v_record_id, 'create', to_jsonb(new));
  elsif tg_op = 'DELETE' then
    insert into audit_log (school_id, actor_school_user_id, table_name, record_id, action, old_data)
    values (v_school_id, v_actor, tg_table_name, v_record_id, 'delete', to_jsonb(old));
  elsif tg_op = 'UPDATE' then
    v_old := to_jsonb(old) - 'updated_at';
    v_new := to_jsonb(new) - 'updated_at';
    if v_old is distinct from v_new then
      insert into audit_log (school_id, actor_school_user_id, table_name, record_id, action, old_data, new_data)
      values (v_school_id, v_actor, tg_table_name, v_record_id, 'update', v_old, v_new);
    end if;
  end if;

  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$function$;
revoke all on function public.audit_row_change_via_student() from public;
revoke execute on function public.audit_row_change_via_student() from anon, authenticated;

create or replace function public.audit_row_change_via_fee_structure()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_actor uuid;
  v_school_id uuid;
  v_record_id uuid;
  v_fee_structure_id uuid;
  v_old jsonb;
  v_new jsonb;
begin
  select su.id into v_actor from school_users su where su.auth_user_id = auth.uid() and su.status = 'active';

  v_fee_structure_id := coalesce(new.fee_structure_id, old.fee_structure_id);
  select fs.school_id into v_school_id from fee_structures fs where fs.id = v_fee_structure_id;
  if v_school_id is null then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  if tg_op = 'DELETE' then v_record_id := old.id; else v_record_id := new.id; end if;

  if tg_op = 'INSERT' then
    insert into audit_log (school_id, actor_school_user_id, table_name, record_id, action, new_data)
    values (v_school_id, v_actor, tg_table_name, v_record_id, 'create', to_jsonb(new));
  elsif tg_op = 'DELETE' then
    insert into audit_log (school_id, actor_school_user_id, table_name, record_id, action, old_data)
    values (v_school_id, v_actor, tg_table_name, v_record_id, 'delete', to_jsonb(old));
  elsif tg_op = 'UPDATE' then
    v_old := to_jsonb(old) - 'updated_at';
    v_new := to_jsonb(new) - 'updated_at';
    if v_old is distinct from v_new then
      insert into audit_log (school_id, actor_school_user_id, table_name, record_id, action, old_data, new_data)
      values (v_school_id, v_actor, tg_table_name, v_record_id, 'update', v_old, v_new);
    end if;
  end if;

  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$function$;
revoke all on function public.audit_row_change_via_fee_structure() from public;
revoke execute on function public.audit_row_change_via_fee_structure() from anon, authenticated;

create trigger trg_audit_students
  after insert or update or delete on students
  for each row execute function public.audit_row_change();

create trigger trg_audit_fee_structures
  after insert or update or delete on fee_structures
  for each row execute function public.audit_row_change();

create trigger trg_audit_fee_items
  after insert or update or delete on fee_items
  for each row execute function public.audit_row_change_via_fee_structure();

create trigger trg_audit_invoices
  after insert or update or delete on invoices
  for each row execute function public.audit_row_change();

create trigger trg_audit_hostel_allocations
  after insert or update or delete on hostel_allocations
  for each row execute function public.audit_row_change();

create trigger trg_audit_beds
  after insert or update or delete on beds
  for each row execute function public.audit_row_change();

create trigger trg_audit_dormitories
  after insert or update or delete on dormitories
  for each row execute function public.audit_row_change();

create trigger trg_audit_boarding_houses
  after insert or update or delete on boarding_houses
  for each row execute function public.audit_row_change();

create trigger trg_audit_medical_records
  after insert or update or delete on medical_records
  for each row execute function public.audit_row_change_via_student();

create trigger trg_audit_sick_bay_visits
  after insert or update or delete on sick_bay_visits
  for each row execute function public.audit_row_change();

create trigger trg_audit_discipline_records
  after insert or update or delete on discipline_records
  for each row execute function public.audit_row_change();

create trigger trg_audit_discipline_cases
  after insert or update or delete on discipline_cases
  for each row execute function public.audit_row_change();

create trigger trg_audit_school_users
  after insert or update or delete on school_users
  for each row execute function public.audit_row_change();

create trigger trg_audit_role_permissions
  after insert or update or delete on role_permissions
  for each row execute function public.audit_row_change();

create trigger trg_audit_applications
  after insert or update or delete on applications
  for each row execute function public.audit_row_change();
