-- Behavioral test for enforce_student_same_school(). Rollback-only, synthetic fixtures, uses a
-- TEMP table carrying the same trigger so it needs no knowledge of any real table's columns.
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/student_same_school_guard.sql
begin;

do $$
declare
  v_a uuid := gen_random_uuid();
  v_b uuid := gen_random_uuid();
  v_stu_b uuid := gen_random_uuid();
  v_stu_a uuid := gen_random_uuid();
  v_row uuid;
  v_blocked boolean;
  v_missing int;
begin
  insert into schools (id, name, slug, application_number_prefix) values
    (v_a, 'Same-School Test A', 'same-school-test-a', 'SSA'),
    (v_b, 'Same-School Test B', 'same-school-test-b', 'SSB');
  insert into students (id, school_id, first_name, last_name, date_of_birth, gender) values
    (v_stu_a, v_a, 'Test', 'A', date '2015-01-01', 'female'),
    (v_stu_b, v_b, 'Test', 'B', date '2015-01-01', 'male');

  create temp table _guard_t (id uuid default gen_random_uuid(), school_id uuid, student_id uuid, note text);
  create trigger trg_enforce_student_same_school
    before insert or update of student_id, school_id on _guard_t
    for each row execute function public.enforce_student_same_school();

  -- 1. same school: allowed
  insert into _guard_t (school_id, student_id) values (v_a, v_stu_a);

  -- 2. cross-school insert: must be rejected
  v_blocked := false;
  begin
    insert into _guard_t (school_id, student_id) values (v_a, v_stu_b);
  exception when check_violation then v_blocked := true; end;
  if not v_blocked then raise exception 'FAIL: cross-school insert was allowed'; end if;

  -- 3. NULL student_id: allowed
  insert into _guard_t (school_id, student_id) values (v_a, null);

  -- 4. re-pointing an existing row to another school's student: must be rejected
  select id into v_row from _guard_t where student_id = v_stu_a limit 1;
  v_blocked := false;
  begin
    update _guard_t set student_id = v_stu_b where id = v_row;
  exception when check_violation then v_blocked := true; end;
  if not v_blocked then raise exception 'FAIL: cross-school re-point was allowed'; end if;

  -- 5. updating an unrelated column on a legacy mismatched row must NOT be blocked
  alter table _guard_t disable trigger trg_enforce_student_same_school;
  insert into _guard_t (school_id, student_id) values (v_a, v_stu_b);   -- simulate legacy bad row
  alter table _guard_t enable trigger trg_enforce_student_same_school;
  update _guard_t set note = 'ok' where student_id = v_stu_b;          -- no student_id/school_id change
  if not found then raise exception 'FAIL: unrelated-column update on legacy row did not run'; end if;

  -- 6. the trigger is attached to every table the migration lists
  select count(*) into v_missing from unnest(array[
    'boarding_incidents','boarding_transfers','certificates','competency_indicator_ratings','competency_marks',
    'disciplinary_actions','discipline_cases','discipline_records','documents','fee_threshold_alerts','fee_waivers',
    'health_emergencies','health_referrals','hostel_allocations','library_loans','library_reservations','marks',
    'medication_administrations','report_cards','safeguarding_reports','sick_bay_visits','student_attendance',
    'student_transport_assignments','welfare_concerns','whatsapp_conversations']) as t(name)
  where not exists (select 1 from pg_trigger g where g.tgrelid = ('public.'||t.name)::regclass
                    and g.tgname = 'trg_enforce_student_same_school' and not g.tgisinternal);
  if v_missing <> 0 then raise exception 'FAIL: % table(s) missing the guard trigger', v_missing; end if;

  raise notice 'student same-school guard: all checks passed';
end $$;

rollback;
