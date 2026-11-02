-- Behavioural test for Phase 6.2 (migration *_vote_heads_ledger). Rollback-only, synthetic fixtures.
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/vote_heads_ledger.sql
-- Callers are simulated with request.jwt.claims + role authenticated. Everything runs in one transaction
-- that ends in `rollback;`; a final tripwire fails loudly if any fixture row ever persisted.
begin;

do $$
declare
  sa uuid := gen_random_uuid();
  sb uuid := gen_random_uuid();
  u_burs_a uuid := gen_random_uuid();
  u_burs_b uuid := gen_random_uuid();
  u_teacher_a uuid := gen_random_uuid();
  r_burs uuid; r_teacher uuid; v_flag uuid;
  ay uuid := gen_random_uuid(); t1 uuid := gen_random_uuid(); t2 uuid := gen_random_uuid();
  st1 uuid := gen_random_uuid(); st2 uuid := gen_random_uuid(); st3 uuid := gen_random_uuid();
  inv1 uuid := gen_random_uuid(); inv2 uuid := gen_random_uuid(); inv3 uuid := gen_random_uuid();
  h_tuition uuid; h_board uuid; h_repairs uuid; h_spare uuid; h_b uuid;
  v_failed boolean; v_n integer;
begin
  select id into r_burs from roles where name = 'bursar';
  select id into r_teacher from roles where name = 'teacher';
  assert r_burs is not null and r_teacher is not null, 'roles exist';

  insert into auth.users (id, aud, role, email) values
    (u_burs_a, 'authenticated', 'authenticated', 'votehead-burs-a@example.invalid'),
    (u_burs_b, 'authenticated', 'authenticated', 'votehead-burs-b@example.invalid'),
    (u_teacher_a, 'authenticated', 'authenticated', 'votehead-teacher-a@example.invalid');
  insert into schools (id, name, slug, application_number_prefix) values
    (sa, 'Vote Head A', 'vote-head-a', 'VHA'), (sb, 'Vote Head B', 'vote-head-b', 'VHB');
  insert into school_users (auth_user_id, school_id, role_id, full_name, status) values
    (u_burs_a, sa, r_burs, 'Bursar A', 'active'),
    (u_burs_b, sb, r_burs, 'Bursar B', 'active'),
    (u_teacher_a, sa, r_teacher, 'Teacher A', 'active');

  insert into academic_years (id, school_id, name, start_date, end_date) values (ay, sa, 'AY', current_date - 100, current_date + 300);
  insert into terms (id, school_id, academic_year_id, name, term_number, start_date, end_date) values
    (t1, sa, ay, 'T1', 1, current_date - 90, current_date + 90),
    (t2, sa, ay, 'T2', 2, current_date + 100, current_date + 190);
  insert into students (id, school_id, first_name, last_name, date_of_birth, gender, status) values
    (st1, sa, 'Sam', 'One', date '2012-01-01', 'male', 'approved'),
    (st2, sa, 'Sue', 'Two', date '2012-01-02', 'female', 'approved'),
    (st3, sa, 'Sid', 'Three', date '2012-01-03', 'male', 'approved');

  -- Income fixtures. inv1 8000 = 5000 + 2000 + 1000 (note the padded, upper-cased name), inv2 5000 = 4000 + 1000,
  -- inv3 (term 2) total 3000 but only 2500 itemised.
  insert into invoices (id, school_id, student_id, term_id, total_amount) values
    (inv1, sa, st1, t1, 8000), (inv2, sa, st2, t1, 5000), (inv3, sa, st3, t2, 3000);
  insert into invoice_items (invoice_id, name, amount) values
    (inv1, 'Tuition', 5000), (inv1, 'Boarding', 2000), (inv1, '  TUITION ', 1000),
    (inv2, 'Tuition', 4000), (inv2, 'Lunch', 1000),
    (inv3, 'Tuition', 2500);
  -- Expense fixtures: approved Repairs 700 (term 1) and 100 (term 2), approved Stationery 300 (term 1), pending 9999 (ignored).
  insert into expenses (school_id, category, vendor, amount, status, approved_at) values
    (sa, 'Repairs', 'V', 700, 'approved', now()),
    (sa, 'Repairs', 'V', 100, 'approved', now() + interval '120 days'),
    (sa, ' stationery', 'V', 300, 'approved', now()),
    (sa, 'Repairs', 'V', 9999, 'pending', null);

  -- 1. no caller: reads return nothing, writes refused
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', '{}', true);
  assert (select count(*) from vote_head_ledger()) = 0, '1: no caller sees no ledger';
  v_failed := false;
  begin perform create_vote_head('TUITION', 'Tuition', 'income'); exception when others then v_failed := true; end;
  assert v_failed, '1: no caller cannot create';

  -- 2. flag OFF: bursar refused (55000), ledger empty
  perform set_config('request.jwt.claims', json_build_object('sub', u_burs_a, 'role', 'authenticated')::text, true);
  v_failed := false;
  begin perform create_vote_head('TUITION', 'Tuition', 'income'); exception when sqlstate '55000' then v_failed := true; end;
  assert v_failed, '2: flag off must refuse writes';
  assert (select count(*) from vote_head_ledger()) = 0, '2: flag off => empty ledger';
  assert (select count(*) from vote_head_reconciliation()) = 0, '2: flag off => empty reconciliation';

  execute 'reset role';
  select id into v_flag from platform_feature_flags where key = 'feature.finance.vote_heads';
  assert v_flag is not null, 'flag catalog entry exists';
  insert into school_feature_flags (school_id, flag_id, enabled) values (sa, v_flag, true);

  -- 3. teacher (no finance.write / finance.read) refused and sees nothing
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_teacher_a, 'role', 'authenticated')::text, true);
  v_failed := false;
  begin perform create_vote_head('TUITION', 'Tuition', 'income'); exception when sqlstate '42501' then v_failed := true; end;
  assert v_failed, '3: teacher refused';
  assert (select count(*) from vote_head_ledger()) = 0, '3: teacher sees no ledger';

  -- 4. bursar A creates heads; validation
  perform set_config('request.jwt.claims', json_build_object('sub', u_burs_a, 'role', 'authenticated')::text, true);
  h_tuition := create_vote_head(' tuition ', 'Tuition fees', 'income');
  h_board := create_vote_head('BOARD', 'Boarding', 'income');
  h_repairs := create_vote_head('REPAIRS', 'Repairs and maintenance', 'expense');
  h_spare := create_vote_head('SPARE', 'Spare', 'income');
  assert (select code from vote_heads where id = h_tuition) = 'TUITION', '4: code upper-cased and trimmed';
  v_failed := false;
  begin perform create_vote_head('BAD', 'Bad kind', 'asset'); exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '4: invalid kind refused';
  v_failed := false;
  begin perform create_vote_head('UNMAPPED', 'Reserved', 'income'); exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '4: reserved code refused';
  v_failed := false;
  begin perform create_vote_head('TUITION', 'Dup', 'income'); exception when sqlstate '23505' then v_failed := true; end;
  assert v_failed, '4: duplicate code refused';

  -- 5. mapping rules
  perform set_vote_head_mapping('invoice_item', 'Tuition', h_tuition);
  perform set_vote_head_mapping('invoice_item', ' BOARDING ', h_board);
  perform set_vote_head_mapping('expense_category', 'repairs', h_repairs);
  v_failed := false;
  begin perform set_vote_head_mapping('expense_category', 'Fuel', h_tuition); exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '5: an income head cannot take an expense category';
  v_failed := false;
  begin perform set_vote_head_mapping('invoice_item', 'Fuel', h_repairs); exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '5: an expense head cannot take a fee item';
  v_failed := false;
  begin perform set_vote_head_mapping('invoice_item', 'X', gen_random_uuid()); exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '5: unknown vote head refused';
  assert (select count(*) from vote_head_mappings) = 3, '5: three mappings saved';

  -- 6. ledger, all time
  assert (select amount from vote_head_ledger() where code = 'TUITION') = 12500, '6: tuition 5000+1000+4000+2500';
  assert (select lines from vote_head_ledger() where code = 'TUITION') = 4, '6: tuition lines';
  assert (select amount from vote_head_ledger() where code = 'BOARD') = 2000, '6: boarding';
  assert (select amount from vote_head_ledger() where code = 'UNMAPPED' and kind = 'income') = 1000, '6: lunch unmapped';
  assert (select amount from vote_head_ledger() where code = 'UNITEMISED') = 500, '6: 500 invoiced but not itemised';
  assert (select amount from vote_head_ledger() where code = 'REPAIRS') = 800, '6: approved repairs only (pending ignored)';
  assert (select amount from vote_head_ledger() where code = 'UNMAPPED' and kind = 'expense') = 300, '6: stationery unmapped (normalised)';
  assert not exists (select 1 from vote_head_ledger() where code = 'SPARE' and amount <> 0), '6: spare head is empty';
  assert (select invoiced_total from vote_head_reconciliation()) = 16000, '6: invoiced total';
  assert (select income_difference from vote_head_reconciliation()) = 0, '6: income reconciles to the shilling';
  assert (select approved_expense_total from vote_head_reconciliation()) = 1100, '6: approved expenses';
  assert (select expense_difference from vote_head_reconciliation()) = 0, '6: expenses reconcile to the shilling';

  -- 7. ledger for one term
  assert (select amount from vote_head_ledger(t1) where code = 'TUITION') = 10000, '7: t1 tuition';
  assert not exists (select 1 from vote_head_ledger(t1) where code = 'UNITEMISED'), '7: t1 fully itemised';
  assert (select amount from vote_head_ledger(t1) where code = 'REPAIRS') = 700, '7: t1 repairs by approval date';
  assert (select amount from vote_head_ledger(t2) where code = 'UNITEMISED') = 500, '7: t2 unitemised';
  assert (select amount from vote_head_ledger(t2) where code = 'REPAIRS') = 100, '7: t2 repairs';
  assert (select income_difference from vote_head_reconciliation(t1)) = 0
     and (select expense_difference from vote_head_reconciliation(t1)) = 0, '7: t1 reconciles';
  assert (select count(*) from vote_head_ledger(gen_random_uuid())) = 0, '7: unknown term returns nothing';

  -- 8. direct writes are not possible
  v_failed := false;
  begin insert into vote_heads (school_id, code, name, kind) values (sa, 'DIRECT', 'Direct', 'income'); exception when others then v_failed := true; end;
  assert v_failed, '8: no direct insert on vote_heads';
  v_failed := false;
  begin delete from vote_head_mappings; exception when others then v_failed := true; end;
  assert v_failed or (select count(*) from vote_head_mappings) = 3, '8: no direct delete on mappings';

  -- 9. switching a head off: hidden when empty, kept when it has activity, cannot take new mappings
  perform set_vote_head_active(h_spare, false);
  assert not exists (select 1 from vote_head_ledger() where code = 'SPARE'), '9: empty inactive head hidden';
  v_failed := false;
  begin perform set_vote_head_mapping('invoice_item', 'Lunch', h_spare); exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '9: inactive head cannot take mappings';
  perform set_vote_head_active(h_board, false);
  assert (select amount from vote_head_ledger() where code = 'BOARD') = 2000, '9: inactive head with activity still reported';
  perform set_vote_head_active(h_board, true);

  -- 10. removing a mapping moves its items to UNMAPPED, totals unchanged
  perform remove_vote_head_mapping('invoice_item', 'tuition');
  assert (select amount from vote_head_ledger() where code = 'UNMAPPED' and kind = 'income') = 1000 + 12500, '10: tuition now unmapped';
  assert (select income_difference from vote_head_reconciliation()) = 0, '10: still reconciles';
  perform set_vote_head_mapping('invoice_item', 'Tuition', h_tuition);

  -- 11. tenant isolation: school B (flag on) sees nothing of A and cannot map to A's heads
  execute 'reset role';
  insert into school_feature_flags (school_id, flag_id, enabled) values (sb, v_flag, true);
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_burs_b, 'role', 'authenticated')::text, true);
  assert (select count(*) from vote_heads) = 0, '11: B sees none of As vote heads';
  assert (select count(*) from vote_head_mappings) = 0, '11: B sees none of As mappings';
  assert (select count(*) from vote_head_ledger()) = 0, '11: B ledger empty';
  v_failed := false;
  begin perform set_vote_head_mapping('invoice_item', 'Tuition', h_tuition); exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '11: B cannot map to As vote head';
  v_failed := false;
  begin perform set_vote_head_active(h_tuition, false); exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '11: B cannot switch As vote head';
  h_b := create_vote_head('TUITION', 'B tuition', 'income');
  assert h_b is not null and h_b <> h_tuition, '11: codes are unique per school, not globally';
  execute 'reset role';
  assert (select is_active from vote_heads where id = h_tuition), '11: As head untouched';

  -- 12. anon cannot execute any function
  assert not has_function_privilege('anon', 'public.create_vote_head(text,text,text)', 'execute'), '12: anon create';
  assert not has_function_privilege('anon', 'public.set_vote_head_active(uuid,boolean)', 'execute'), '12: anon active';
  assert not has_function_privilege('anon', 'public.set_vote_head_mapping(text,text,uuid)', 'execute'), '12: anon map';
  assert not has_function_privilege('anon', 'public.remove_vote_head_mapping(text,text)', 'execute'), '12: anon unmap';
  assert not has_function_privilege('anon', 'public.vote_head_ledger(uuid)', 'execute'), '12: anon ledger';
  assert not has_function_privilege('anon', 'public.vote_head_reconciliation(uuid)', 'execute'), '12: anon reconciliation';
  assert has_function_privilege('authenticated', 'public.vote_head_ledger(uuid)', 'execute'), '12: authenticated ledger';

  raise notice 'vote heads ledger behavioural checks: all passed';
end
$$;

rollback;

-- Independent tripwire (own implicit transaction after the explicit rollback above).
do $$
begin
  if exists (select 1 from schools where slug in ('vote-head-a', 'vote-head-b'))
     or exists (select 1 from auth.users where email like 'votehead-%@example.invalid') then
    raise exception 'LEAK DETECTED: vote-heads test fixtures were not rolled back -- fix this test file before trusting it again';
  end if;
end
$$;
