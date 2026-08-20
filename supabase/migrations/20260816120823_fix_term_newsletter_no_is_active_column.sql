create or replace function public.send_term_newsletter(p_term_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_term record;
  v_next_term record;
  v_school_name text;
  v_template_body text;
  v_existing_count integer;
  v_sender uuid;
  v_trigger_type text;
  v_count integer := 0;
  v_rec record;
  v_fee_lines text;
  v_fee_total numeric;
  v_fee_section text;
  v_body text;
begin
  select * into v_term from public.terms where id = p_term_id;
  if v_term.id is null then
    raise exception 'Term not found.';
  end if;

  v_trigger_type := case when auth.role() = 'service_role' then 'automatic' else 'manual' end;

  if v_trigger_type = 'manual' and not (
    auth_is_super_admin() or (v_term.school_id = auth_school_id() and auth_has_permission('communication.write'))
  ) then
    raise exception 'Not authorized to send this newsletter.';
  end if;

  select recipient_count into v_existing_count from public.term_newsletter_log where term_id = p_term_id;
  if v_existing_count is not null then
    return v_existing_count;
  end if;

  select name into v_school_name from public.schools where id = v_term.school_id;

  select * into v_next_term from public.terms
    where school_id = v_term.school_id and start_date > v_term.end_date
    order by start_date asc limit 1;

  select body into v_template_body from public.communication_templates
    where school_id = v_term.school_id and category = 'term_newsletter'
    order by created_at desc limit 1;
  if v_template_body is null then
    v_template_body := E'Dear {{guardian_name}},\n\n{{term_name}} at {{school_name}} has now ended. We hope {{student_name}} had a great term.\n\n{{fee_section}}\n\nThank you for your continued partnership.';
  end if;

  select id into v_sender from public.school_users where auth_user_id = auth.uid();

  for v_rec in
    select distinct
      sg.guardian_user_id, su.full_name as guardian_name, su.email as guardian_email,
      st.id as student_id, (st.first_name || ' ' || st.last_name) as student_name, st.current_class_id
    from public.students st
    join public.student_guardians sg on sg.student_id = st.id
    join public.school_users su on su.id = sg.guardian_user_id
    where st.school_id = v_term.school_id and st.status = 'active' and su.email is not null
  loop
    v_fee_lines := null;
    v_fee_total := null;
    if v_next_term.id is not null and v_rec.current_class_id is not null then
      select string_agg(fi.name || ': KES ' || to_char(fi.amount, 'FM999,999,999'), E'\n' order by fi.name), sum(fi.amount)
        into v_fee_lines, v_fee_total
        from public.fee_structures fs
        join public.fee_items fi on fi.fee_structure_id = fs.id
        where fs.school_id = v_term.school_id and fs.term_id = v_next_term.id
          and fs.class_id = v_rec.current_class_id and fs.is_active = true;
    end if;

    v_fee_section := case
      when v_fee_lines is not null then
        'Fee structure for ' || coalesce(v_next_term.name, 'the next term') || ':' || E'\n' || v_fee_lines
        || E'\nTotal: KES ' || to_char(v_fee_total, 'FM999,999,999')
      else 'The fee structure for the next term will be shared once it is published.'
    end;

    v_body := public.render_template(v_template_body, jsonb_build_object(
      'guardian_name', coalesce(v_rec.guardian_name, 'Parent/Guardian'),
      'student_name', v_rec.student_name,
      'school_name', v_school_name,
      'term_name', v_term.name,
      'next_term_name', coalesce(v_next_term.name, 'the next term'),
      'fee_section', v_fee_section
    ));

    if not public.notification_allowed(v_rec.guardian_user_id, 'term_newsletter', 'email') then
      continue;
    end if;

    insert into public.notification_logs (
      school_id, student_id, recipient_email, recipient_type, channel, subject, body,
      segments, sent_by, recipient_school_user_id, source_module
    ) values (
      v_term.school_id, v_rec.student_id, v_rec.guardian_email, 'guardian', 'email',
      v_school_name || ' -- ' || v_term.name || ' Newsletter', v_body, 1, v_sender,
      v_rec.guardian_user_id, 'term_newsletter'
    );
    v_count := v_count + 1;
  end loop;

  insert into public.term_newsletter_log (school_id, term_id, trigger_type, sent_by, recipient_count)
  values (v_term.school_id, p_term_id, v_trigger_type, v_sender, v_count);

  return v_count;
end;
$$;

create or replace function public.check_fee_thresholds()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_is_cron boolean := (auth.role() = 'service_role');
  v_caller_school uuid;
  v_school record;
  v_template_body text;
  v_body text;
  v_rec record;
  v_total integer := 0;
begin
  if not v_is_cron then
    v_caller_school := auth_school_id();
    if not (auth_is_super_admin() or (v_caller_school is not null and auth_has_permission('finance.write'))) then
      raise exception 'Not authorized to check fee thresholds.';
    end if;
  end if;

  for v_school in
    select id, name, fee_alert_threshold from public.schools
    where fee_alert_threshold is not null and fee_alert_threshold > 0
      and (v_is_cron or id = v_caller_school)
  loop
    select body into v_template_body from public.communication_templates
      where school_id = v_school.id and category = 'fee_threshold_alert'
      order by created_at desc limit 1;
    if v_template_body is null then
      v_template_body := 'Dear {{guardian_name}}, this is a reminder that {{student_name}}''s fee balance at {{school_name}} currently stands at KES {{balance}}. Kindly clear the outstanding amount at your earliest convenience. Thank you.';
    end if;

    for v_rec in
      select vb.student_id, vb.balance, (st.first_name || ' ' || st.last_name) as student_name,
             sg.guardian_user_id, su.full_name as guardian_name
        from public.v_student_balances vb
        join public.students st on st.id = vb.student_id
        join public.student_guardians sg on sg.student_id = st.id and sg.primary_contact = true
        join public.school_users su on su.id = sg.guardian_user_id
        where vb.school_id = v_school.id
          and vb.balance >= v_school.fee_alert_threshold
          and st.status = 'active'
          and not exists (
            select 1 from public.fee_threshold_alerts fta
            where fta.student_id = vb.student_id and fta.status in ('draft', 'approved')
          )
    loop
      v_body := public.render_template(v_template_body, jsonb_build_object(
        'guardian_name', coalesce(v_rec.guardian_name, 'Parent/Guardian'),
        'student_name', v_rec.student_name,
        'school_name', v_school.name,
        'balance', to_char(v_rec.balance, 'FM999,999,999')
      ));

      insert into public.fee_threshold_alerts (
        school_id, student_id, guardian_user_id, balance_at_generation, threshold_at_generation, draft_body
      ) values (
        v_school.id, v_rec.student_id, v_rec.guardian_user_id, v_rec.balance, v_school.fee_alert_threshold, v_body
      );
      v_total := v_total + 1;
    end loop;
  end loop;

  return v_total;
end;
$$;
