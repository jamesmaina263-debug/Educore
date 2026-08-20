-- Newsletters previously went straight out (both the daily cron and the manual
-- "Send newsletter" button called send_term_newsletter() directly, which
-- immediately inserted into notification_logs). This migration splits that into
-- a draft-then-approve flow, mirroring the fee_threshold_alerts pattern already
-- established in this codebase: generation only ever produces something a human
-- reviews, edits, optionally AI-polishes, and explicitly approves; nothing here
-- reaches a parent unreviewed.
--
-- The draft is the *template* (with {{guardian_name}}/{{fee_section}}/etc still
-- as placeholders), not a per-guardian merged copy -- editing it changes the
-- wording every guardian receives, while the fee breakdown still merges in
-- correctly per guardian at send time (each family sees their own class's fees).
-- preview_term_newsletter_draft() lets the reviewer see a real merged sample
-- before approving.

-- ---------------------------------------------------------------------------
-- 1. Draft table
-- ---------------------------------------------------------------------------

create table public.term_newsletter_drafts (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  term_id uuid not null references public.terms(id) on delete cascade,
  trigger_type text not null check (trigger_type in ('automatic', 'manual')),
  draft_body text not null,
  ai_drafted boolean not null default false,
  status text not null default 'draft' check (status in ('draft', 'approved', 'sent')),
  generated_by uuid references public.school_users(id) on delete set null,
  generated_at timestamptz not null default now(),
  approved_by uuid references public.school_users(id) on delete set null,
  approved_at timestamptz,
  sent_at timestamptz,
  recipient_count integer,
  unique (term_id)
);
comment on table public.term_newsletter_drafts is
  'One row per term. prepare_term_newsletter_draft() (security definer) is the only writer of new rows and never overwrites an existing draft''s edited text. A communication.write holder edits draft_body directly (RLS update below, same pattern as fee_threshold_alerts.draft_body). send_term_newsletter_draft() (security definer) is the only path that actually merges per guardian and queues into notification_logs -- it also writes term_newsletter_log so the old idempotency guarantee (never double-send a term) still holds.';

alter table public.term_newsletter_drafts enable row level security;

create policy term_newsletter_drafts_select on public.term_newsletter_drafts for select
  using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('communication.write')));

-- Lets a reviewer edit draft_body before approving, same as fee_threshold_alerts_update.
-- Approving-and-sending still goes through the RPC below since it must also write to
-- notification_logs and term_newsletter_log atomically.
create policy term_newsletter_drafts_update on public.term_newsletter_drafts for update
  using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('communication.write')))
  with check (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('communication.write')));

-- No insert/delete policy for `authenticated` -- only prepare_term_newsletter_draft()
-- creates rows, and drafts are never hard-deleted (status change only), consistent with
-- fee_threshold_alerts / term_newsletter_log elsewhere in this codebase.

-- ---------------------------------------------------------------------------
-- 2. Generate (or fetch the existing) draft -- never sends.
--    Called by both the daily cron sweep and the manual "Prepare newsletter"
--    button. Idempotent two ways: if this term's newsletter has already been
--    sent (term_newsletter_log), it's a no-op; if a draft already exists for
--    this term, it returns that draft's id untouched rather than clobbering
--    any edits already made to it.
-- ---------------------------------------------------------------------------

create or replace function public.prepare_term_newsletter_draft(p_term_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_term record;
  v_trigger_type text;
  v_existing_draft_id uuid;
  v_already_sent boolean;
  v_template_body text;
  v_sender uuid;
  v_draft_id uuid;
begin
  select * into v_term from public.terms where id = p_term_id;
  if v_term.id is null then
    raise exception 'Term not found.';
  end if;

  v_trigger_type := case when auth.role() = 'service_role' then 'automatic' else 'manual' end;

  if v_trigger_type = 'manual' and not (
    auth_is_super_admin() or (v_term.school_id = auth_school_id() and auth_has_permission('communication.write'))
  ) then
    raise exception 'Not authorized to prepare this newsletter.';
  end if;

  select exists(select 1 from public.term_newsletter_log where term_id = p_term_id) into v_already_sent;
  if v_already_sent then
    return null;
  end if;

  select id into v_existing_draft_id from public.term_newsletter_drafts where term_id = p_term_id;
  if v_existing_draft_id is not null then
    return v_existing_draft_id;
  end if;

  select body into v_template_body from public.communication_templates
    where school_id = v_term.school_id and category = 'term_newsletter'
    order by created_at desc limit 1;
  if v_template_body is null then
    v_template_body := E'Dear {{guardian_name}},\n\n{{term_name}} at {{school_name}} has now ended. We hope {{student_name}} had a great term.\n\n{{fee_section}}\n\nThank you for your continued partnership.';
  end if;

  select id into v_sender from public.school_users where auth_user_id = auth.uid();

  insert into public.term_newsletter_drafts (school_id, term_id, trigger_type, draft_body, generated_by)
  values (v_term.school_id, p_term_id, v_trigger_type, v_template_body, v_sender)
  returning id into v_draft_id;

  return v_draft_id;
end;
$$;
revoke all on function public.prepare_term_newsletter_draft(uuid) from public, anon;
grant execute on function public.prepare_term_newsletter_draft(uuid) to authenticated;

-- Cron-facing sweep now only drafts -- it never sends. Same shape/trigger
-- condition as before (every term whose end_date has passed with no log row).
create or replace function public.run_term_newsletter_sweep()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_term_id uuid;
  v_total integer := 0;
begin
  if not (auth_is_super_admin() or auth.role() = 'service_role') then
    raise exception 'Not authorized to run the newsletter sweep.';
  end if;

  for v_term_id in
    select t.id from public.terms t
    left join public.term_newsletter_log l on l.term_id = t.id
    where t.end_date <= current_date and l.id is null
  loop
    if public.prepare_term_newsletter_draft(v_term_id) is not null then
      v_total := v_total + 1;
    end if;
  end loop;

  return v_total;
end;
$$;
revoke all on function public.run_term_newsletter_sweep() from public, anon;
grant execute on function public.run_term_newsletter_sweep() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Live preview -- merges the draft's *current* text (including any unsaved-
--    to-approval edits already saved via the update policy above) against one
--    real guardian/student/fee breakdown, so a reviewer can see what a parent
--    will actually receive before approving. Read-only, no side effects.
-- ---------------------------------------------------------------------------

create or replace function public.preview_term_newsletter_draft(p_draft_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_draft record;
  v_term record;
  v_next_term record;
  v_school_name text;
  v_rec record;
  v_fee_lines text;
  v_fee_total numeric;
  v_fee_section text;
begin
  select * into v_draft from public.term_newsletter_drafts where id = p_draft_id;
  if v_draft.id is null then
    raise exception 'Draft not found.';
  end if;
  if not (auth_is_super_admin() or (v_draft.school_id = auth_school_id() and auth_has_permission('communication.write'))) then
    raise exception 'Not authorized to preview this newsletter.';
  end if;

  select * into v_term from public.terms where id = v_draft.term_id;
  select name into v_school_name from public.schools where id = v_draft.school_id;
  select * into v_next_term from public.terms
    where school_id = v_draft.school_id and start_date > v_term.end_date
    order by start_date asc limit 1;

  select
    su.full_name as guardian_name,
    (st.first_name || ' ' || st.last_name) as student_name,
    str.class_id as actual_class_id
    into v_rec
    from public.students st
    join public.student_guardians sg on sg.student_id = st.id
    join public.school_users su on su.id = sg.guardian_user_id
    left join public.streams str on str.id = st.current_class_id
    where st.school_id = v_draft.school_id and st.status = 'active' and su.email is not null
    limit 1;

  if v_rec.student_name is null then
    return public.render_template(v_draft.draft_body, jsonb_build_object(
      'guardian_name', 'Parent/Guardian', 'student_name', '(sample student)',
      'school_name', coalesce(v_school_name, ''), 'term_name', coalesce(v_term.name, ''),
      'next_term_name', coalesce(v_next_term.name, 'the next term'),
      'fee_section', 'No active students with a guardian on file yet to build a real sample from.'
    ));
  end if;

  v_fee_lines := null;
  v_fee_total := null;
  if v_next_term.id is not null and v_rec.actual_class_id is not null then
    select string_agg(fi.name || ': KES ' || to_char(fi.amount, 'FM999,999,999'), E'\n' order by fi.name), sum(fi.amount)
      into v_fee_lines, v_fee_total
      from public.fee_structures fs
      join public.fee_items fi on fi.fee_structure_id = fs.id
      where fs.school_id = v_draft.school_id and fs.term_id = v_next_term.id
        and fs.class_id = v_rec.actual_class_id and fs.is_active = true;
  end if;

  v_fee_section := case
    when v_fee_lines is not null then
      'Fee structure for ' || coalesce(v_next_term.name, 'the next term') || ':' || E'\n' || v_fee_lines
      || E'\nTotal: KES ' || to_char(v_fee_total, 'FM999,999,999')
    else 'The fee structure for the next term will be shared once it is published.'
  end;

  return public.render_template(v_draft.draft_body, jsonb_build_object(
    'guardian_name', coalesce(v_rec.guardian_name, 'Parent/Guardian'),
    'student_name', v_rec.student_name,
    'school_name', coalesce(v_school_name, ''),
    'term_name', coalesce(v_term.name, ''),
    'next_term_name', coalesce(v_next_term.name, 'the next term'),
    'fee_section', v_fee_section
  ));
end;
$$;
revoke all on function public.preview_term_newsletter_draft(uuid) from public, anon;
grant execute on function public.preview_term_newsletter_draft(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Approve & send -- the only path that actually merges per guardian and
--    delivers. Replaces the old send_term_newsletter(); same per-guardian
--    merge loop, now sourcing the template from the (possibly edited)
--    draft_body instead of communication_templates directly.
-- ---------------------------------------------------------------------------

drop function if exists public.send_term_newsletter(uuid);

create or replace function public.send_term_newsletter_draft(p_draft_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_draft record;
  v_term record;
  v_next_term record;
  v_school_name text;
  v_sender uuid;
  v_count integer := 0;
  v_rec record;
  v_fee_lines text;
  v_fee_total numeric;
  v_fee_section text;
  v_body text;
begin
  select * into v_draft from public.term_newsletter_drafts where id = p_draft_id for update;
  if v_draft.id is null then
    raise exception 'Draft not found.';
  end if;
  if not (auth_is_super_admin() or (v_draft.school_id = auth_school_id() and auth_has_permission('communication.write'))) then
    raise exception 'Not authorized to send this newsletter.';
  end if;
  if v_draft.status = 'sent' then
    return coalesce(v_draft.recipient_count, 0);
  end if;

  select * into v_term from public.terms where id = v_draft.term_id;
  select name into v_school_name from public.schools where id = v_draft.school_id;
  select * into v_next_term from public.terms
    where school_id = v_draft.school_id and start_date > v_term.end_date
    order by start_date asc limit 1;

  select id into v_sender from public.school_users where auth_user_id = auth.uid();

  for v_rec in
    select distinct
      sg.guardian_user_id, su.full_name as guardian_name, su.email as guardian_email,
      st.id as student_id, (st.first_name || ' ' || st.last_name) as student_name,
      str.class_id as actual_class_id
    from public.students st
    join public.student_guardians sg on sg.student_id = st.id
    join public.school_users su on su.id = sg.guardian_user_id
    left join public.streams str on str.id = st.current_class_id
    where st.school_id = v_draft.school_id and st.status = 'active' and su.email is not null
  loop
    v_fee_lines := null;
    v_fee_total := null;
    if v_next_term.id is not null and v_rec.actual_class_id is not null then
      select string_agg(fi.name || ': KES ' || to_char(fi.amount, 'FM999,999,999'), E'\n' order by fi.name), sum(fi.amount)
        into v_fee_lines, v_fee_total
        from public.fee_structures fs
        join public.fee_items fi on fi.fee_structure_id = fs.id
        where fs.school_id = v_draft.school_id and fs.term_id = v_next_term.id
          and fs.class_id = v_rec.actual_class_id and fs.is_active = true;
    end if;

    v_fee_section := case
      when v_fee_lines is not null then
        'Fee structure for ' || coalesce(v_next_term.name, 'the next term') || ':' || E'\n' || v_fee_lines
        || E'\nTotal: KES ' || to_char(v_fee_total, 'FM999,999,999')
      else 'The fee structure for the next term will be shared once it is published.'
    end;

    v_body := public.render_template(v_draft.draft_body, jsonb_build_object(
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
      v_draft.school_id, v_rec.student_id, v_rec.guardian_email, 'guardian', 'email',
      v_school_name || ' -- ' || v_term.name || ' Newsletter', v_body, 1, v_sender,
      v_rec.guardian_user_id, 'term_newsletter'
    );
    v_count := v_count + 1;
  end loop;

  insert into public.term_newsletter_log (school_id, term_id, trigger_type, sent_by, recipient_count)
  values (v_draft.school_id, v_draft.term_id, v_draft.trigger_type, v_sender, v_count);

  update public.term_newsletter_drafts
    set status = 'sent', approved_by = v_sender, approved_at = coalesce(approved_at, now()), sent_at = now(), recipient_count = v_count
    where id = p_draft_id;

  return v_count;
end;
$$;
revoke all on function public.send_term_newsletter_draft(uuid) from public, anon;
grant execute on function public.send_term_newsletter_draft(uuid) to authenticated;
