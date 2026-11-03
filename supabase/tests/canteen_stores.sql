-- Behavioural test for Phase 8.5 (migration *_canteen_stores). Rollback-only, synthetic fixtures, real role
-- impersonation (request.jwt.claims). One transaction ending in `rollback;`; a final tripwire fails loudly if any
-- fixture row persisted. It checks the money invariants directly: wallet = sum of ledger, stock = sum of
-- movements, a retried request never charges twice, sell-only staff cannot void/refund/adjust.
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/canteen_stores.sql
begin;

do $$
declare
  sa uuid := gen_random_uuid(); sb uuid := gen_random_uuid();
  u_bur uuid := gen_random_uuid(); u_dep uuid := gen_random_uuid(); u_tea uuid := gen_random_uuid();
  u_p1 uuid := gen_random_uuid(); u_p2 uuid := gen_random_uuid(); u_stu uuid := gen_random_uuid(); u_burb uuid := gen_random_uuid();
  su_bur uuid := gen_random_uuid(); su_dep uuid := gen_random_uuid(); su_tea uuid := gen_random_uuid();
  su_p1 uuid := gen_random_uuid(); su_p2 uuid := gen_random_uuid(); su_stu uuid := gen_random_uuid(); su_burb uuid := gen_random_uuid();
  ch1 uuid := gen_random_uuid(); ch2 uuid := gen_random_uuid(); ch3 uuid := gen_random_uuid();
  r_bur uuid; r_dep uuid; r_tea uuid; r_parent uuid; r_student uuid; v_flag uuid;
  i_m uuid; i_s uuid; i_p uuid; i_x uuid; i_b uuid;
  v_res jsonb; v_sale1 uuid; v_sale2 uuid; v_n integer; v_failed boolean; v_state text; v_bal numeric; v_sum numeric;
  d1 date := (now() at time zone 'Africa/Nairobi')::date - 1;
  d2 date := (now() at time zone 'Africa/Nairobi')::date + 1;
begin
  select id into r_bur from roles where name = 'bursar';
  select id into r_dep from roles where name = 'deputy_principal';
  select id into r_tea from roles where name = 'teacher';
  select id into r_parent from roles where name = 'parent';
  select id into r_student from roles where name = 'student';
  assert r_bur is not null and r_dep is not null and r_tea is not null and r_parent is not null and r_student is not null, 'seed roles exist';

  insert into schools (id, name, slug, application_number_prefix) values
    (sa, 'Canteen Test A', 'canteen-test-a', 'CTA'), (sb, 'Canteen Test B', 'canteen-test-b', 'CTB');
  insert into auth.users (id, aud, role, email) values
    (u_bur, 'authenticated', 'authenticated', 'cant-bur@example.invalid'),
    (u_dep, 'authenticated', 'authenticated', 'cant-dep@example.invalid'),
    (u_tea, 'authenticated', 'authenticated', 'cant-tea@example.invalid'),
    (u_p1, 'authenticated', 'authenticated', 'cant-p1@example.invalid'),
    (u_p2, 'authenticated', 'authenticated', 'cant-p2@example.invalid'),
    (u_stu, 'authenticated', 'authenticated', 'cant-stu@example.invalid'),
    (u_burb, 'authenticated', 'authenticated', 'cant-burb@example.invalid');
  insert into school_users (id, school_id, auth_user_id, role_id, full_name, status) values
    (su_bur, sa, u_bur, r_bur, 'Cant Bursar', 'active'),
    (su_dep, sa, u_dep, r_dep, 'Cant Deputy', 'active'),
    (su_tea, sa, u_tea, r_tea, 'Cant Teacher', 'active'),
    (su_p1, sa, u_p1, r_parent, 'Cant Parent 1', 'active'),
    (su_p2, sa, u_p2, r_parent, 'Cant Parent 2', 'active'),
    (su_stu, sa, u_stu, r_student, 'Cant Student', 'active'),
    (su_burb, sb, u_burb, r_bur, 'Cant Bursar B', 'active');
  insert into students (id, school_id, first_name, last_name, date_of_birth, gender, status) values
    (ch1, sa, 'Kid', 'One', date '2012-01-01', 'male', 'approved'),
    (ch2, sa, 'Kid', 'Two', date '2012-01-02', 'female', 'approved'),
    (ch3, sa, 'Kid', 'Three', date '2012-01-03', 'male', 'approved');
  update students set status = 'enrolled' where id in (ch1, ch2);
  update students set status = 'withdrawn' where id = ch3;
  update students set school_user_id = su_stu where id = ch1;
  insert into student_guardians (student_id, guardian_user_id, relationship, primary_contact) values
    (ch1, su_p1, 'guardian', true), (ch2, su_p2, 'guardian', true);
  -- a teacher who may SELL (per-school override) but is not a manager
  insert into role_permissions (role_id, school_id, permission_key, allowed) values
    (r_tea, sa, 'canteen.sell', true), (r_tea, sa, 'canteen.read', true);

  -- 1. flag OFF: nothing works
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_bur, 'role', 'authenticated')::text, true);
  v_failed := false;
  begin perform save_canteen_item(null, 'Mandazi', 20, 0, true);
  exception when others then get stacked diagnostics v_state = returned_sqlstate; v_failed := (v_state = '55000'); end;
  assert v_failed, '1: flag off refuses with 55000';
  execute 'reset role';
  select id into v_flag from platform_feature_flags where key = 'feature.canteen.stores';
  assert v_flag is not null, 'flag catalog entry exists';
  insert into school_feature_flags (school_id, flag_id, enabled) values (sa, v_flag, true);

  -- 2. permissions: default roles
  assert exists (select 1 from role_permissions rp join roles r on r.id = rp.role_id where r.name = 'bursar' and rp.permission_key = 'canteen.manage' and rp.school_id is null), '2: bursar manages by default';
  assert not exists (select 1 from role_permissions rp join roles r on r.id = rp.role_id where r.name = 'teacher' and rp.permission_key like 'canteen.%' and rp.school_id is null), '2: teacher has no default canteen permission';
  assert not exists (select 1 from role_permissions rp join roles r on r.id = rp.role_id where r.name = 'deputy_principal' and rp.permission_key in ('canteen.sell','canteen.manage') and rp.school_id is null), '2: deputy is read-only by default';

  -- 3. items: validation and uniqueness
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_bur, 'role', 'authenticated')::text, true);
  i_m := save_canteen_item(null, 'Mandazi', 20, 0, true);
  i_s := save_canteen_item(null, 'Soda', 50, 0, true);
  i_p := save_canteen_item(null, 'Pie', 80, 0, true);
  i_x := save_canteen_item(null, 'Special', 30, 0, true);
  v_failed := false; begin perform save_canteen_item(null, 'Free', 0, 0, true); exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '3: zero price refused';
  v_failed := false; begin perform save_canteen_item(null, 'Odd', 10.123, 0, true); exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '3: more than 2 decimals refused';
  v_failed := false; begin perform save_canteen_item(null, ' mandazi ', 20, 0, true); exception when sqlstate '23505' then v_failed := true; end;
  assert v_failed, '3: duplicate name refused (case and spaces ignored)';

  -- 4. stock
  assert adjust_canteen_stock(i_m, 10, 'received', null) = 10, '4: received';
  perform adjust_canteen_stock(i_s, 5, 'received', null);
  perform adjust_canteen_stock(i_p, 10, 'received', null);
  perform adjust_canteen_stock(i_x, 5, 'received', null);
  v_failed := false; begin perform adjust_canteen_stock(i_m, -1, 'received', null); exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '4: negative "received" refused';
  v_failed := false; begin perform adjust_canteen_stock(i_m, -1, 'adjustment', null); exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '4: adjustment needs a note';
  v_failed := false; begin perform adjust_canteen_stock(i_m, -50, 'adjustment', 'spoiled'); exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '4: stock cannot go below zero';
  perform save_canteen_item(i_x, 'Special', 30, 0, false);

  -- 5. deposits
  v_res := record_canteen_deposit(ch1, 500, 'Cash at gate', 'd1');
  assert (v_res ->> 'balance')::numeric = 500 and (v_res ->> 'duplicate')::boolean = false, '5: deposit credited';
  v_res := record_canteen_deposit(ch1, 500, 'Cash at gate', 'd1');
  assert (v_res ->> 'balance')::numeric = 500 and (v_res ->> 'duplicate')::boolean = true, '5: retry returns the same result';
  select count(*) into v_n from canteen_wallet_entries where student_id = ch1;
  assert v_n = 1, '5: a retried deposit is not credited twice';
  v_failed := false; begin perform record_canteen_deposit(ch3, 100, null, 'dx'); exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '5: withdrawn student cannot be topped up';
  v_failed := false; begin perform record_canteen_deposit(ch1, 10.555, null, 'dy'); exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '5: fractional cents refused';
  v_failed := false; begin perform record_canteen_deposit(ch1, 50001, null, 'dz'); exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '5: over the limit refused';
  v_failed := false; begin perform record_canteen_deposit(ch1, 10, null, null); exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '5: reference required';

  -- 6. wallet sale
  v_res := record_canteen_sale(ch1, 'wallet', json_build_array(json_build_object('item_id', i_m, 'qty', 3), json_build_object('item_id', i_s, 'qty', 1))::jsonb, 's1');
  v_sale1 := (v_res ->> 'sale_id')::uuid;
  assert (v_res ->> 'total')::numeric = 110 and (v_res ->> 'balance')::numeric = 390, '6: 3 mandazi + 1 soda = 110, balance 390';
  assert (select stock_qty from canteen_items where id = i_m) = 7 and (select stock_qty from canteen_items where id = i_s) = 4, '6: stock reduced';
  v_res := record_canteen_sale(ch1, 'wallet', json_build_array(json_build_object('item_id', i_m, 'qty', 3), json_build_object('item_id', i_s, 'qty', 1))::jsonb, 's1');
  assert (v_res ->> 'duplicate')::boolean = true and (v_res ->> 'sale_id')::uuid = v_sale1 and (v_res ->> 'balance')::numeric = 390, '6: retry returns the same sale';
  assert (select balance from canteen_wallets where student_id = ch1) = 390 and (select stock_qty from canteen_items where id = i_m) = 7, '6: a retried sale does not charge or take stock twice';
  v_failed := false; begin perform record_canteen_sale(ch1, 'wallet', json_build_array(json_build_object('item_id', i_p, 'qty', 6))::jsonb, 's2x');
  exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '6: insufficient wallet refused';
  assert (select stock_qty from canteen_items where id = i_p) = 10 and (select balance from canteen_wallets where student_id = ch1) = 390
         and not exists (select 1 from canteen_sales where client_ref = 's2x'), '6: a refused sale changes nothing';
  v_failed := false; begin perform record_canteen_sale(ch1, 'cash', json_build_array(json_build_object('item_id', i_m, 'qty', 100))::jsonb, 'sx');
  exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '6: insufficient stock refused';
  v_failed := false; begin perform record_canteen_sale(ch1, 'cash', json_build_array(json_build_object('item_id', i_x, 'qty', 1))::jsonb, 'sy');
  exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '6: inactive item refused';
  v_failed := false; begin perform record_canteen_sale(null, 'wallet', json_build_array(json_build_object('item_id', i_m, 'qty', 1))::jsonb, 'sz');
  exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '6: wallet sale needs a student';
  v_failed := false; begin perform record_canteen_sale(ch3, 'cash', json_build_array(json_build_object('item_id', i_m, 'qty', 1))::jsonb, 'sw');
  exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '6: withdrawn student cannot buy';
  v_failed := false; begin perform record_canteen_sale(ch1, 'cash', '[{"item_id":"00000000-0000-0000-0000-000000000000","qty":1}]'::jsonb, 'sv');
  exception when sqlstate 'P0002' then v_failed := true; end;
  assert v_failed, '6: unknown item refused';
  v_failed := false; begin perform record_canteen_sale(ch1, 'cash', '[{"item_id":"nope","qty":1}]'::jsonb, 'su');
  exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '6: malformed line refused';
  v_failed := false; begin perform record_canteen_sale(ch1, 'cash', json_build_array(json_build_object('item_id', i_m, 'qty', 0))::jsonb, 'st');
  exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '6: zero quantity refused';

  -- 7. cash sale with no student; duplicate lines are merged
  v_res := record_canteen_sale(null, 'cash', json_build_array(json_build_object('item_id', i_s, 'qty', 2), json_build_object('item_id', i_m, 'qty', 1), json_build_object('item_id', i_m, 'qty', 1))::jsonb, 'c1');
  assert (v_res ->> 'total')::numeric = 140 and (v_res -> 'balance') = 'null'::jsonb, '7: cash sale 2 soda + 2 mandazi = 140, no wallet';
  assert (select count(*) from canteen_sale_lines where sale_id = (v_res ->> 'sale_id')::uuid) = 2, '7: duplicate lines merged into one';

  -- 8. price change never alters history
  perform save_canteen_item(i_m, 'Mandazi', 25, 10, true);
  assert (select unit_price from canteen_sale_lines where sale_id = v_sale1 and item_id = i_m) = 20, '8: old sale keeps the old price';
  v_res := record_canteen_sale(ch1, 'wallet', json_build_array(json_build_object('item_id', i_m, 'qty', 1))::jsonb, 's2');
  v_sale2 := (v_res ->> 'sale_id')::uuid;
  assert (v_res ->> 'total')::numeric = 25 and (v_res ->> 'balance')::numeric = 365, '8: new sale uses the new price';

  -- 9. void
  v_res := void_canteen_sale(v_sale2, 'Wrong item rung up');
  assert (v_res ->> 'balance')::numeric = 390, '9: void puts the money back';
  assert (select status from canteen_sales where id = v_sale2) = 'voided' and (select stock_qty from canteen_items where id = i_m) = 5, '9: void puts the stock back';
  v_failed := false; begin perform void_canteen_sale(v_sale2, 'Again'); exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '9: cannot void twice';
  v_failed := false; begin perform void_canteen_sale(v_sale1, 'x'); exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '9: void needs a real reason';

  -- 10. refund
  perform record_canteen_deposit(ch2, 100, null, 'd2');
  v_res := record_canteen_refund(ch2, 60, 'Cash returned to parent', 'r1');
  assert (v_res ->> 'balance')::numeric = 40, '10: refund pays out of the wallet';
  v_res := record_canteen_refund(ch2, 60, 'Cash returned to parent', 'r1');
  assert (v_res ->> 'duplicate')::boolean = true and (select balance from canteen_wallets where student_id = ch2) = 40, '10: retried refund does not pay twice';
  v_failed := false; begin perform record_canteen_refund(ch2, 50, 'too much', 'r2'); exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '10: cannot refund more than the balance';
  v_failed := false; begin perform record_canteen_refund(ch2, 10, null, 'r3'); exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '10: refund needs a reason';
  execute 'reset role';

  -- 11. sell-only staff cannot do manager things
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_tea, 'role', 'authenticated')::text, true);
  v_res := record_canteen_sale(null, 'cash', json_build_array(json_build_object('item_id', i_p, 'qty', 1))::jsonb, 't1');
  assert (v_res ->> 'total')::numeric = 80, '11: seller can sell';
  perform adjust_canteen_stock(i_p, 5, 'received', null);
  v_failed := false; begin perform void_canteen_sale(v_sale1, 'seller tries'); exception when sqlstate '42501' then v_failed := true; end;
  assert v_failed, '11: seller cannot void';
  v_failed := false; begin perform record_canteen_refund(ch2, 5, 'seller tries', 'r9'); exception when sqlstate '42501' then v_failed := true; end;
  assert v_failed, '11: seller cannot refund';
  v_failed := false; begin perform adjust_canteen_stock(i_p, -1, 'adjustment', 'seller tries'); exception when sqlstate '42501' then v_failed := true; end;
  assert v_failed, '11: seller cannot adjust stock';
  v_failed := false; begin perform save_canteen_item(i_p, 'Pie', 1, 0, true); exception when sqlstate '42501' then v_failed := true; end;
  assert v_failed, '11: seller cannot change prices';
  -- a person with no canteen permission at all
  perform set_config('request.jwt.claims', json_build_object('sub', u_p1, 'role', 'authenticated')::text, true);
  v_failed := false; begin perform record_canteen_sale(null, 'cash', json_build_array(json_build_object('item_id', i_p, 'qty', 1))::jsonb, 'p1x'); exception when sqlstate '42501' then v_failed := true; end;
  assert v_failed, '11: a parent cannot sell';
  execute 'reset role';

  -- 12. invariants (as the table owner, so nothing is hidden by policies)
  select balance into v_bal from canteen_wallets where student_id = ch1;
  select coalesce(sum(amount), 0) into v_sum from canteen_wallet_entries where student_id = ch1;
  assert v_bal = v_sum and v_bal = 390, '12: wallet 1 equals its ledger';
  select balance into v_bal from canteen_wallets where student_id = ch2;
  select coalesce(sum(amount), 0) into v_sum from canteen_wallet_entries where student_id = ch2;
  assert v_bal = v_sum and v_bal = 40, '12: wallet 2 equals its ledger';
  assert (select balance_after from canteen_wallet_entries where student_id = ch1 order by created_at desc, id desc limit 1) is not null, '12: ledger rows carry the running balance';
  assert not exists (
    select 1 from canteen_items i
     where i.school_id = sa and i.stock_qty <> coalesce((select sum(delta) from canteen_stock_movements m where m.item_id = i.id), 0)
  ), '12: every item''s stock equals its movements';

  -- 13. append-only history; negative balance impossible
  v_failed := false; begin update canteen_wallet_entries set amount = 1 where student_id = ch1; exception when sqlstate '42501' then v_failed := true; end;
  assert v_failed, '13: ledger cannot be edited';
  v_failed := false; begin delete from canteen_wallet_entries where student_id = ch1; exception when sqlstate '42501' then v_failed := true; end;
  assert v_failed, '13: ledger cannot be deleted';
  v_failed := false; begin delete from canteen_stock_movements where item_id = i_m; exception when sqlstate '42501' then v_failed := true; end;
  assert v_failed, '13: stock history cannot be deleted';
  v_failed := false; begin update canteen_sale_lines set qty = 99 where sale_id = v_sale1; exception when sqlstate '42501' then v_failed := true; end;
  assert v_failed, '13: sale lines cannot be edited';
  v_failed := false; begin update canteen_wallets set balance = -1 where student_id = ch1; exception when check_violation then v_failed := true; end;
  assert v_failed, '13: a negative balance is impossible';

  -- 14. visibility
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_p1, 'role', 'authenticated')::text, true);
  assert (select count(*) from canteen_wallets) = 1 and (select count(*) from canteen_wallet_entries) = 4, '14: guardian sees own child''s wallet and ledger';
  assert (select count(*) from canteen_sales) = 2 and (select count(*) from canteen_sale_lines) = 3, '14: guardian sees own child''s purchases';
  assert (select count(*) from canteen_items) = 0, '14: guardian cannot see the price list';
  perform set_config('request.jwt.claims', json_build_object('sub', u_p2, 'role', 'authenticated')::text, true);
  assert (select count(*) from canteen_wallets) = 1 and (select count(*) from canteen_sales) = 0, '14: other guardian sees only their child';
  perform set_config('request.jwt.claims', json_build_object('sub', u_stu, 'role', 'authenticated')::text, true);
  assert (select count(*) from canteen_wallets) = 1, '14: student sees own wallet';
  perform set_config('request.jwt.claims', json_build_object('sub', u_dep, 'role', 'authenticated')::text, true);
  assert (select count(*) from canteen_items) = 4 and (select count(*) from canteen_sales) >= 4, '14: read-only staff see the canteen';
  v_failed := false; begin perform record_canteen_sale(null, 'cash', json_build_array(json_build_object('item_id', i_p, 'qty', 1))::jsonb, 'dep1'); exception when sqlstate '42501' then v_failed := true; end;
  assert v_failed, '14: read-only staff cannot sell';
  perform set_config('request.jwt.claims', json_build_object('sub', u_burb, 'role', 'authenticated')::text, true);
  assert (select count(*) from canteen_items) = 0 and (select count(*) from canteen_wallets) = 0, '14: other school sees nothing';

  -- 15. direct writes are blocked
  perform set_config('request.jwt.claims', json_build_object('sub', u_bur, 'role', 'authenticated')::text, true);
  v_failed := false; begin insert into canteen_sales (school_id, tender, total, client_ref) values (sa, 'cash', 5, 'direct'); exception when others then get stacked diagnostics v_state = returned_sqlstate; v_failed := (v_state = '42501'); end;
  assert v_failed, '15: direct sale insert blocked';
  v_failed := false; begin insert into canteen_wallets (student_id, school_id, balance) values (ch3, sa, 999); exception when others then get stacked diagnostics v_state = returned_sqlstate; v_failed := (v_state = '42501'); end;
  assert v_failed, '15: direct wallet insert blocked';
  update canteen_items set price = 1 where id = i_p;
  get diagnostics v_n = row_count;
  assert v_n = 0, '15: direct price change changes nothing';
  update canteen_wallets set balance = 99999 where student_id = ch1;
  get diagnostics v_n = row_count;
  assert v_n = 0, '15: direct balance change changes nothing';

  -- 16. summary
  v_res := canteen_summary(d1, d2);
  assert (v_res ->> 'sales_count')::int = 3 and (v_res ->> 'wallet_sales')::numeric = 110 and (v_res ->> 'cash_sales')::numeric = 220, '16: sales totals';
  assert (v_res ->> 'voided_count')::int = 1 and (v_res ->> 'voided_total')::numeric = 25, '16: void totals';
  assert (v_res ->> 'deposits')::numeric = 600 and (v_res ->> 'refunds')::numeric = 60 and (v_res ->> 'wallet_liability')::numeric = 430, '16: deposits, refunds and what the school owes families';
  assert exists (select 1 from jsonb_array_elements(v_res -> 'low_stock') x where x ->> 'name' = 'Mandazi'), '16: low stock lists mandazi';
  v_failed := false; begin perform canteen_summary(d1 - 100, d2); exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '16: over-long range refused';
  perform set_config('request.jwt.claims', json_build_object('sub', u_p1, 'role', 'authenticated')::text, true);
  v_failed := false; begin perform canteen_summary(d1, d2); exception when sqlstate '42501' then v_failed := true; end;
  assert v_failed, '16: a parent cannot read the summary';
  execute 'reset role';

  -- 17. audit and grants
  assert exists (select 1 from audit_log where table_name = 'canteen_items' and record_id = i_m and school_id = sa and action = 'update'), '17: price change audited';
  assert not has_function_privilege('anon', 'public.record_canteen_sale(uuid,text,jsonb,text)', 'execute'), '17: anon sale';
  assert not has_function_privilege('anon', 'public.record_canteen_deposit(uuid,numeric,text,text)', 'execute'), '17: anon deposit';
  assert not has_function_privilege('anon', 'public.void_canteen_sale(uuid,text)', 'execute'), '17: anon void';
  assert not has_function_privilege('anon', 'public.canteen_summary(date,date)', 'execute'), '17: anon summary';
  assert not has_function_privilege('authenticated', 'public.canteen_guard(text)', 'execute'), '17: guard is internal';

  raise notice 'canteen stores behavioural checks: all passed';
end
$$;

rollback;

do $$
begin
  if exists (select 1 from schools where slug in ('canteen-test-a', 'canteen-test-b'))
     or exists (select 1 from auth.users where email like 'cant-%@example.invalid') then
    raise exception 'LEAK DETECTED: canteen test fixtures were not rolled back -- fix this test file before trusting it again';
  end if;
end
$$;
