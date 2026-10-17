-- Website demo request -> sales pipeline lead (Growth Engine, PR 4 of 5).
--
-- Additive: one nullable column on marketing_demo_requests, one index, one function. Nothing that
-- already exists is altered, and nothing runs automatically: the public /contact form, its insert
-- path, the new-lead notification trigger and the demo-request status/assignment flow are untouched.
--
-- Why this exists: a demo request and a sales_leads row were separate islands linked by nothing, so a
-- website enquiry never entered the pipeline (follow-up date, stages, activity log) unless someone
-- retyped it. sales_leads stays the single CRM; marketing_demo_requests stays the raw inbound record.
-- This only adds the link and a one-click, human-triggered conversion.
--
-- Conversion rules (all in the database, so the UI cannot get around them):
--  * Idempotent: converting a request that is already linked returns its lead; it never creates a second one.
--  * No duplicate leads: a matching lead (same school name, email or phone) is linked instead of a new
--    one being created, and the repeat enquiry is noted on that lead's activity log.
--  * A new lead starts at stage 'new' with source 'inbound_web' and a follow-up due today (East Africa
--    Time), because an inbound enquiry should be answered the same day. Stages are never advanced here:
--    "demo_booked" must only happen when a rep actually books one.
--  * The request's own status (new/contacted/assigned/closed) is not changed.
--
-- Access model matches the other platform-admin functions: SECURITY DEFINER, checks
-- auth_is_super_admin() itself, raises a real exception when the row is missing, revoked from
-- public/anon. Requires 20261017150000_outbound_contact_log_and_opt_outs.sql (reuses its internal
-- _normalize_contact_identifier helper) and 20260924130000_sales_pipeline_crm.sql.

alter table public.marketing_demo_requests
  add column if not exists sales_lead_id uuid references public.sales_leads(id) on delete set null;

comment on column public.marketing_demo_requests.sales_lead_id is
  'The sales_leads row this website request was converted into or linked to (admin_convert_demo_request_to_lead). Null = not in the pipeline. Several requests can share one lead.';

create index if not exists marketing_demo_requests_sales_lead_idx
  on public.marketing_demo_requests (sales_lead_id) where sales_lead_id is not null;

create or replace function public.admin_convert_demo_request_to_lead(
  p_request_id uuid,
  p_assigned_to uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r public.marketing_demo_requests%rowtype;
  v_email text;
  v_phone text;
  v_today date := (now() at time zone 'Africa/Nairobi')::date;
  v_lead_id uuid;
  v_lead_name text;
  v_lead_stage text;
  v_notes text;
  v_when text;
begin
  if not auth_is_super_admin() then
    raise exception 'Not authorized to manage demo requests.';
  end if;

  select * into r from public.marketing_demo_requests where id = p_request_id for update;
  if not found then
    raise exception 'Demo request not found.';
  end if;

  v_when := to_char(r.created_at at time zone 'Africa/Nairobi', 'YYYY-MM-DD');

  -- Already converted (and the lead still exists): hand back the same lead.
  if r.sales_lead_id is not null then
    select school_name into v_lead_name from public.sales_leads where id = r.sales_lead_id;
    if found then
      return jsonb_build_object('lead_id', r.sales_lead_id, 'created', false, 'already_linked', true, 'lead_name', v_lead_name);
    end if;
  end if;

  v_email := public._normalize_contact_identifier('email', r.email);
  v_phone := public._normalize_contact_identifier('phone', r.phone);

  -- A lead for this school (by name, email or phone) already exists: link, don't duplicate.
  select l.id, l.school_name, l.stage into v_lead_id, v_lead_name, v_lead_stage
    from public.sales_leads l
   where lower(btrim(l.school_name)) = lower(btrim(r.school_name))
      or (v_email is not null and public._normalize_contact_identifier('email', l.email) = v_email)
      or (v_phone is not null and public._normalize_contact_identifier('phone', l.phone) = v_phone)
   order by l.created_at desc
   limit 1;

  if found then
    update public.marketing_demo_requests set sales_lead_id = v_lead_id where id = r.id;

    insert into public.sales_lead_activities (lead_id, activity_type, summary)
    values (
      v_lead_id, 'note',
      left('Another website demo request from ' || r.name || ' (' || r.role || ') on ' || v_when
           || ', linked to this lead.', 2000)
    );

    -- Fresh interest on an open lead should surface today; closed leads are left as they are.
    if v_lead_stage not in ('paid', 'lost') then
      update public.sales_leads
         set next_follow_up_on = v_today, updated_at = now()
       where id = v_lead_id and (next_follow_up_on is null or next_follow_up_on > v_today);
    end if;

    return jsonb_build_object('lead_id', v_lead_id, 'created', false, 'already_linked', false, 'lead_name', v_lead_name);
  end if;

  v_notes := left(
    'Website demo request, ' || v_when || '.'
      || case when r.utm_campaign is not null or r.utm_source is not null
           then E'\nCampaign: ' || concat_ws(' / ', r.utm_source, r.utm_medium, r.utm_campaign) else '' end
      || case when r.message is not null and btrim(r.message) <> '' then E'\n\n' || r.message else '' end,
    4000
  );

  insert into public.sales_leads (
    school_name, contact_name, contact_role, phone, email, source, student_count,
    assigned_to, next_follow_up_on, notes
  ) values (
    left(btrim(r.school_name), 200), left(nullif(btrim(r.name), ''), 200), left(nullif(btrim(r.role), ''), 100),
    left(nullif(btrim(r.phone), ''), 40), left(nullif(btrim(r.email), ''), 254), 'inbound_web',
    case when r.student_count between 0 and 100000 then r.student_count end,
    coalesce(p_assigned_to, r.assigned_to), v_today, v_notes
  )
  returning id into v_lead_id;

  insert into public.sales_lead_activities (lead_id, activity_type, summary)
  values (v_lead_id, 'note', 'Created from a website demo request received on ' || v_when || '.');

  update public.marketing_demo_requests set sales_lead_id = v_lead_id where id = r.id;

  return jsonb_build_object('lead_id', v_lead_id, 'created', true, 'already_linked', false, 'lead_name', r.school_name);
end;
$$;

revoke all on function public.admin_convert_demo_request_to_lead(uuid, uuid) from public, anon;
grant execute on function public.admin_convert_demo_request_to_lead(uuid, uuid) to authenticated;
