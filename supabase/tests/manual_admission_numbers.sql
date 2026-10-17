-- Behavioral test for assign_admission_number() with school-supplied (existing) admission numbers.
-- Rollback-only, synthetic fixtures (two throwaway schools); touches no real school's data.
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/manual_admission_numbers.sql
-- Concurrency is covered by the per-school advisory lock + unique constraint; to exercise it
-- run two sessions that insert the same / a case-variant number while one holds its txn open.
begin;

do $$
declare
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  v text;
  blocked boolean;
begin
  insert into schools (id, name, slug, application_number_prefix) values
    (a, 'Adm Test A', 'adm-test-a', 'ATA'), (b, 'Adm Test B', 'adm-test-b', 'ATB');

  -- existing students keep their numbers; non-numeric ones don't disturb auto-numbering
  insert into students (school_id, admission_number, first_name, last_name, date_of_birth, gender, status) values
    (a, '001', 'E', '1', date '2015-01-01', 'male', 'active'),
    (a, 'LB/009/2026', 'E', '2', date '2015-01-01', 'male', 'active');

  -- 1+2. out-of-order manual registration is preserved exactly (trimmed)
  foreach v in array array['LB/004/2026', '  LB/001/2026 ', 'LB/003/2026', 'LB/002/2026'] loop
    insert into students (school_id, admission_number, first_name, last_name, date_of_birth, gender, status)
      values (a, v, 'M', 'x', date '2015-01-01', 'female', 'approved');
    assert exists (select 1 from students where school_id = a and admission_number = trim(v)), 'preserved ' || v;
  end loop;

  -- 3. automatic numbering continues from the highest all-digit number, ignoring LB/... values
  insert into students (school_id, admission_number, first_name, last_name, date_of_birth, gender, status)
    values (a, '', 'Auto', 'x', date '2015-01-01', 'male', 'active') returning admission_number into v;
  assert v = '002', 'auto continues from 001 -> 002, got ' || coalesce(v, 'null');

  -- a draft with a blank number stays null (does not burn a number)
  insert into students (school_id, admission_number, first_name, last_name, date_of_birth, gender, status)
    values (a, '', 'Draft', 'x', date '2015-01-01', 'male', 'approved') returning admission_number into v;
  assert v is null, 'draft stays null';

  -- 5. exact duplicate rejected within a school (unique constraint)
  blocked := false;
  begin
    insert into students (school_id, admission_number, first_name, last_name, date_of_birth, gender, status)
      values (a, 'LB/004/2026', 'D', 'x', date '2015-01-01', 'male', 'approved');
  exception when unique_violation then blocked := true; end;
  assert blocked, 'exact duplicate must be rejected';

  -- 5b. case-variant duplicate rejected
  blocked := false;
  begin
    insert into students (school_id, admission_number, first_name, last_name, date_of_birth, gender, status)
      values (a, 'lb/004/2026', 'D', 'x', date '2015-01-01', 'male', 'approved');
  exception when unique_violation then blocked := true; end;
  assert blocked, 'case-variant duplicate must be rejected';

  -- 6. a different school may use the same number
  insert into students (school_id, admission_number, first_name, last_name, date_of_birth, gender, status)
    values (b, 'LB/004/2026', 'O', 'x', date '2015-01-01', 'male', 'approved');

  -- huge all-digit typed number must not break automatic numbering
  insert into students (school_id, admission_number, first_name, last_name, date_of_birth, gender, status)
    values (a, '254712345678', 'Big', 'x', date '2015-01-01', 'male', 'approved');
  insert into students (school_id, admission_number, first_name, last_name, date_of_birth, gender, status)
    values (a, '', 'Auto2', 'x', date '2015-01-01', 'male', 'active') returning admission_number into v;
  assert v = '003', 'auto still works after a 12-digit typed number, got ' || coalesce(v, 'null');

  -- 8. a status change never alters a typed number
  update students set status = 'active' where school_id = a and admission_number = 'LB/004/2026';
  assert exists (select 1 from students where school_id = a and admission_number = 'LB/004/2026' and status = 'active');

  -- 9. an assigned number cannot be silently cleared/regenerated
  blocked := false;
  begin
    update students set admission_number = null where school_id = a and admission_number = '001';
  exception when check_violation then blocked := true; end;
  assert blocked, 'clearing must be rejected';

  raise notice 'manual_admission_numbers: all assertions passed';
end
$$;

rollback;
