-- Behavioural test for WP 2.3 (migration *_wp_2_3_bot_pay_core). Rollback-only, synthetic fixtures (fake 0700000xxx numbers).
-- Checks: flag + M-Pesa gate, guardian-learner link, amount rules (whole, >= 10, <= balance), the STK request goes to the
-- guardian's OWN registered number, confirm window and expiry, balance re-check at confirm, one prompt at a time, cancel,
-- internal-dispatch allow-list, grants.
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/bot_pay.sql
begin;

do $$
declare
  sa uuid := gen_random_uuid(); sb uuid := gen_random_uuid();
  u_g uuid := gen_random_uuid(); u_o uuid := gen_random_uuid(); su_g uuid := gen_random_uuid(); su_o uuid := gen_random_uuid();
  r_p uuid; f_pay uuid; ch uuid := gen_random_uuid(); chb uuid := gen_random_uuid(); conv uuid := gen_random_uuid();
  inv uuid := gen_random_uuid(); ay uuid := gen_random_uuid(); tm uuid := gen_random_uuid(); v jsonb; v_req uuid; v_req2 uuid; v_ok boolean; lk uuid := gen_random_uuid();
begin
  select id into r_p from roles where name = 'parent';
  select id into f_pay from platform_feature_flags where key = 'feature.bot.pay';
  assert f_pay is not null, 'flag catalog entry exists';
  -- Flags are now ON for real schools in production, so a global 'off for everyone' guard is no longer true and says nothing about this test's brand-new fixture schools.

  insert into schools (id, name, slug, application_number_prefix) values (sa, 'BotPay Test A', 'botpay-test-a', 'BPA'), (sb, 'BotPay Test B', 'botpay-test-b', 'BPB');
  insert into auth.users (id, aud, role, email) values
    (u_g, 'authenticated', 'authenticated', 'bp-g@example.invalid'), (u_o, 'authenticated', 'authenticated', 'bp-o@example.invalid');
  insert into school_users (id, school_id, auth_user_id, role_id, full_name, status, phone) values
    (su_g, sa, u_g, r_p, 'BP Parent', 'active', '0700000333'), (su_o, sa, u_o, r_p, 'BP Other Parent', 'active', '0700000444');
  insert into students (id, school_id, first_name, last_name, date_of_birth, gender, status) values
    (ch, sa, 'Amani', 'T', date '2012-01-01', 'male', 'approved'), (chb, sb, 'Baraka', 'T', date '2012-01-01', 'male', 'approved');
  insert into student_guardians (student_id, guardian_user_id, relationship, primary_contact) values (ch, su_g, 'guardian', true);
  insert into academic_years (id, school_id, name, start_date, end_date) values (ay, sa, '2026', date '2026-01-01', date '2026-12-31');
  insert into terms (id, school_id, academic_year_id, name, term_number, start_date, end_date) values (tm, sa, ay, 'Term 1', 1, date '2026-01-01', date '2026-04-30');
  insert into invoices (id, school_id, student_id, term_id, total_amount, status) values (inv, sa, ch, tm, 5000, 'unpaid');
  insert into mpesa_settings (school_id, shortcode, shortcode_type, environment, is_active) values (sa, '174379', 'paybill', 'sandbox', true);
  insert into whatsapp_conversations (id, school_id, phone_number, guardian_user_id, status, unread_count) values (conv, sa, '+254700000333', su_g, 'bot', 0);

  -- 1. flag off
  assert (bot_guardian_pay_prepare(sa, conv, su_g, ch, 1000) ->> 'status') = 'disabled', '1: flag off -> disabled';
  insert into school_feature_flags (school_id, flag_id, enabled) values (sa, f_pay, true);
  assert bot_pay_enabled(sa) and not bot_pay_enabled(sb), '1: enabled only where flag on and M-Pesa active';

  -- 2. no amount -> balance
  v := bot_guardian_pay_prepare(sa, conv, su_g, ch, null);
  assert v ->> 'status' = 'ask_amount' and (v ->> 'balance')::numeric = 5000, '2: ask_amount with the balance';

  -- 3. amount rules
  assert (bot_guardian_pay_prepare(sa, conv, su_g, ch, 5) ->> 'status') = 'too_low', '3: below KES 10';
  assert (bot_guardian_pay_prepare(sa, conv, su_g, ch, 100.5) ->> 'status') = 'not_whole', '3: whole shillings only';
  v := bot_guardian_pay_prepare(sa, conv, su_g, ch, 6000);
  assert v ->> 'status' = 'too_high' and (v ->> 'balance')::numeric = 5000, '3: never above the balance';
  v := bot_guardian_pay_prepare(sa, conv, su_g, ch, 3000);
  assert v ->> 'status' = 'awaiting_confirm' and (v ->> 'amount')::numeric = 3000 and v ->> 'phone_last3' = '333', '3: valid amount awaits confirmation';
  assert not (v::text like '%254700000333%'), '3: the full phone is never returned';

  -- 4. link and tenant checks
  assert (bot_guardian_pay_prepare(sa, conv, su_o, ch, 1000) ->> 'status') = 'forbidden', '4: a parent not linked to this learner';
  assert (bot_guardian_pay_prepare(sa, conv, su_g, chb, 1000) ->> 'status') = 'forbidden', '4: a learner of another school';
  assert (bot_guardian_pay_prepare(sb, conv, su_g, ch, 1000) ->> 'status') = 'forbidden', '4: wrong school for the conversation';

  -- 5. confirm: STK request for the guardian's OWN number
  v := bot_guardian_pay_confirm(sa, conv, su_g);
  assert v ->> 'status' = 'started', '5: confirm starts';
  v_req := (v ->> 'request_id')::uuid;
  assert exists (select 1 from mpesa_stk_requests where id = v_req and school_id = sa and student_id = ch and amount = 3000
                   and phone_number = '254700000333' and status = 'pending' and initiated_by is null and notes = 'Bot pay'), '5: STK row for the registered number';
  assert mpesa_stk_internal_dispatch_allowed(v_req), '5: internal dispatch accepts the bot request';
  assert (bot_guardian_pay_confirm(sa, conv, su_g) ->> 'status') = 'none', '5: nothing left to confirm';

  -- 6. one prompt at a time; cancel
  assert (bot_guardian_pay_prepare(sa, conv, su_g, ch, 1000) ->> 'status') = 'awaiting_confirm', '6: new confirmation';
  assert (bot_guardian_pay_confirm(sa, conv, su_g) ->> 'status') = 'in_progress', '6: second prompt refused while one is pending';
  assert bot_guardian_pay_cancel(sa, conv, su_g) = true, '6: cancel';
  assert bot_guardian_pay_cancel(sa, conv, su_g) = false, '6: nothing to cancel twice';
  update mpesa_stk_requests set status = 'failed', resolved_at = now() where id = v_req;

  -- 7. expiry
  assert (bot_guardian_pay_prepare(sa, conv, su_g, ch, 1000) ->> 'status') = 'awaiting_confirm', '7: new confirmation';
  update bot_pay_requests set expires_at = now() - interval '1 minute' where conversation_id = conv and status = 'awaiting_confirm';
  assert (bot_guardian_pay_confirm(sa, conv, su_g) ->> 'status') = 'expired', '7: expired after 10 minutes';

  -- 8. balance re-checked at confirm time
  assert (bot_guardian_pay_prepare(sa, conv, su_g, ch, 4000) ->> 'status') = 'awaiting_confirm', '8: prepared';
  update invoices set total_amount = 3000 where id = inv;
  v := bot_guardian_pay_confirm(sa, conv, su_g);
  assert v ->> 'status' = 'too_high' and (v ->> 'balance')::numeric = 3000, '8: balance dropped since prepare -> too_high';

  -- 9. nothing owed
  update invoices set total_amount = 0 where id = inv;
  assert (bot_guardian_pay_prepare(sa, conv, su_g, ch, null) ->> 'status') = 'no_balance', '9: no outstanding balance';
  update invoices set total_amount = 5000 where id = inv;

  -- 10. no usable registered phone
  update school_users set phone = null where id = su_g;
  assert (bot_guardian_pay_prepare(sa, conv, su_g, ch, 1000) ->> 'status') = 'not_configured', '10: no registered number';
  update school_users set phone = '0700000333' where id = su_g;

  -- 11. allow-list still covers Pay by Link and refuses everything else
  insert into mpesa_stk_requests (school_id, student_id, amount, phone_number, status) values (sa, ch, 500, '254700000555', 'pending') returning id into v_req2;
  assert not mpesa_stk_internal_dispatch_allowed(v_req2), '11: a plain staff-style request is not allowed';
  insert into pay_links (id, school_id, student_id, amount, token_hash, expires_at) values (lk, sa, ch, 500, repeat('b', 64), now() + interval '1 day');
  insert into pay_link_attempts (link_id, school_id, stk_request_id) values (lk, sa, v_req2);
  assert mpesa_stk_internal_dispatch_allowed(v_req2), '11: a Pay by Link attempt is still allowed';
  assert not mpesa_stk_internal_dispatch_allowed(gen_random_uuid()), '11: unknown id not allowed';

  -- 12. grants
  assert not has_function_privilege('anon', 'public.bot_guardian_pay_prepare(uuid,uuid,uuid,uuid,numeric)', 'execute'), '12: anon prepare';
  assert not has_function_privilege('authenticated', 'public.bot_guardian_pay_confirm(uuid,uuid,uuid)', 'execute'), '12: authenticated confirm';
  assert has_function_privilege('service_role', 'public.bot_guardian_pay_confirm(uuid,uuid,uuid)', 'execute'), '12: service_role confirm';
  assert not has_function_privilege('service_role', 'public.bot_pay_guardian_phone(uuid,uuid)', 'execute'), '12: helper not callable';
  assert not has_table_privilege('authenticated', 'public.bot_pay_requests', 'select'), '12: table closed';
end
$$;

rollback;

do $$
begin
  if exists (select 1 from schools where slug in ('botpay-test-a', 'botpay-test-b'))
     or exists (select 1 from auth.users where email like 'bp-%@example.invalid') then
    raise exception 'LEAK DETECTED: bot-pay test fixtures were not rolled back -- fix this test file before trusting it again';
  end if;
end
$$;
