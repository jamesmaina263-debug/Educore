-- Behavioural test for Phase 2.7+2.8 (migration *_bot_menu_language). Rollback-only, synthetic fixtures.
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/bot_menu_language.sql
-- Needs the migration already deployed. (CI: .github/workflows/bot-menu-language-behavior-check.yml)
begin;

do $$
declare
  sa uuid := gen_random_uuid();
  sb uuid := gen_random_uuid();
  r_parent uuid; v_flag uuid; su_a uuid; su_b uuid;
  conv_a uuid; conv_b uuid;
  v_res jsonb; v_failed boolean;
begin
  select id into r_parent from roles where name = 'parent';
  assert r_parent is not null, '0: parent role exists';

  insert into schools (id, name, slug, application_number_prefix) values
    (sa, 'Bot Menu A', 'bot-menu-a', 'BMA'), (sb, 'Bot Menu B', 'bot-menu-b', 'BMB');
  insert into school_users (school_id, role_id, full_name, phone, status) values (sa, r_parent, 'Guardian A', '+254700300001', 'active') returning id into su_a;
  insert into school_users (school_id, role_id, full_name, phone, status) values (sb, r_parent, 'Guardian B', '+254700300002', 'active') returning id into su_b;
  insert into whatsapp_conversations (school_id, phone_number, guardian_user_id, status) values (sa, '+254700300001', su_a, 'bot') returning id into conv_a;
  insert into whatsapp_conversations (school_id, phone_number, guardian_user_id, status) values (sb, '+254700300002', su_b, 'bot') returning id into conv_b;

  -- 1. flag catalog entry exists and is on for nobody
  select id into v_flag from platform_feature_flags where key = 'feature.bot.menu';
  assert v_flag is not null, '1: flag catalog entry exists';
  assert not exists (select 1 from school_feature_flags where flag_id = v_flag and enabled), '1: flag enabled for nobody';

  -- 2. flag OFF: enabled() false, get returns en, set refused and writes nothing
  execute 'set local role service_role';
  assert bot_menu_enabled(sa) = false, '2: enabled false while off';
  assert bot_get_language(sa, conv_a) = 'en', '2: get returns en while off';
  v_res := bot_set_language(sa, conv_a, 'sw');
  assert (v_res->>'ok')::boolean = false and v_res->>'code' = 'flag_off', '2: set refused while off';
  execute 'reset role';
  assert (select count(*) from bot_conversation_language) = 0, '2: nothing written while off';

  insert into school_feature_flags (school_id, flag_id, enabled) values (sa, v_flag, true);

  -- 3. flag ON for school A only
  execute 'set local role service_role';
  assert bot_menu_enabled(sa) = true and bot_menu_enabled(sb) = false, '3: on for A only';
  assert bot_get_language(sa, conv_a) = 'en', '3: default is en';
  v_res := bot_set_language(sa, conv_a, 'sw');
  assert (v_res->>'ok')::boolean and v_res->>'language' = 'sw', '3: set sw';
  assert bot_get_language(sa, conv_a) = 'sw', '3: get returns sw';
  v_res := bot_set_language(sa, conv_a, 'en');
  assert (v_res->>'ok')::boolean and bot_get_language(sa, conv_a) = 'en', '3: set back to en (upsert)';
  assert (select count(*) from bot_conversation_language where conversation_id = conv_a) = 1, '3: still one row';

  -- 4. bad input and wrong combinations
  assert bot_set_language(sa, conv_a, 'fr')->>'code' = 'bad_language', '4: unknown language refused';
  assert bot_set_language(sa, conv_a, null)->>'code' = 'bad_language', '4: null language refused';
  assert bot_set_language(sa, conv_b, 'sw')->>'code' = 'bad_conversation', '4: conversation of another school refused';
  assert bot_set_language(sb, conv_b, 'sw')->>'code' = 'flag_off', '4: school B has the flag off';
  assert bot_get_language(sa, conv_b) = 'en', '4: get for another school conversation returns en';
  execute 'reset role';

  -- 5. flag turned off again: stored language is ignored (back to en)
  perform bot_set_language(sa, conv_a, 'sw');
  update school_feature_flags set enabled = false where school_id = sa and flag_id = v_flag;
  execute 'set local role service_role';
  assert bot_get_language(sa, conv_a) = 'en', '5: stored language ignored while the flag is off';
  execute 'reset role';
  update school_feature_flags set enabled = true where school_id = sa and flag_id = v_flag;

  -- 6. clients cannot touch the table or the functions
  execute 'set local role authenticated';
  v_failed := false;
  begin perform count(*) from bot_conversation_language; exception when insufficient_privilege then v_failed := true; end;
  assert v_failed, '6: authenticated cannot read the table';
  v_failed := false;
  begin insert into bot_conversation_language (conversation_id, school_id, language) values (conv_b, sb, 'sw'); exception when insufficient_privilege then v_failed := true; end;
  assert v_failed, '6: authenticated cannot write the table';
  execute 'reset role';
  assert not has_function_privilege('anon', 'public.bot_set_language(uuid,uuid,text)', 'execute'), '6: anon set';
  assert not has_function_privilege('anon', 'public.bot_get_language(uuid,uuid)', 'execute'), '6: anon get';
  assert not has_function_privilege('anon', 'public.bot_menu_enabled(uuid)', 'execute'), '6: anon enabled';
  assert not has_function_privilege('authenticated', 'public.bot_set_language(uuid,uuid,text)', 'execute'), '6: authenticated set';
  assert not has_function_privilege('authenticated', 'public.bot_get_language(uuid,uuid)', 'execute'), '6: authenticated get';
  assert not has_function_privilege('authenticated', 'public.bot_menu_enabled(uuid)', 'execute'), '6: authenticated enabled';
  assert has_function_privilege('service_role', 'public.bot_set_language(uuid,uuid,text)', 'execute'), '6: service role set';

  -- 7. deleting the conversation removes its language row
  delete from whatsapp_conversations where id = conv_a;
  assert not exists (select 1 from bot_conversation_language where conversation_id = conv_a), '7: cascade on conversation delete';

  raise notice 'bot menu language behavioural checks: all passed';
end
$$;

rollback;

-- Independent tripwire, in its own implicit transaction after the explicit rollback above.
do $$
begin
  if exists (select 1 from schools where slug in ('bot-menu-a', 'bot-menu-b')) then
    raise exception 'LEAK DETECTED: bot menu language test fixtures were not rolled back -- fix this test file before trusting it again';
  end if;
end
$$;
