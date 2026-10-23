-- Outreach engagement, WhatsApp: record which school clicked a link in the WhatsApp draft a rep copied.
--
-- Follow-up to 20261022120000_outreach_engagement_tracking.sql, which does this for email. WhatsApp drafts are
-- copied and pasted by a person, so there is no per-send recipient row to hang the click on; the link carries
-- the school's own prospect id instead (an unguessable uuid). A click is only recorded when that school's
-- WhatsApp draft was actually copied or marked sent (outbound_contact_log), so a link that was never issued
-- cannot create engagement.
--
-- Scanner hygiene: nothing scans end-to-end-encrypted WhatsApp messages, but WhatsApp fetches a preview of every
-- link the moment it is sent. That fetch identifies itself, and the calling route flags it (is_probable_bot);
-- flagged clicks are stored but counted separately, exactly as for email. The 15-second-after-send rule is NOT
-- used here: the gap between copying a draft and sending it is unknown, so it would mean nothing.
--
-- Additive and safe to run twice: one new column (existing rows are all email), recipient_id becomes nullable
-- (a CHECK still requires it for email), one new function. admin_outreach_engagement() already groups by prospect
-- and so includes WhatsApp clicks with no change. record_outreach_click() (email) is untouched.

alter table public.outreach_link_clicks
  add column if not exists channel text not null default 'email';

alter table public.outreach_link_clicks drop constraint if exists outreach_link_clicks_channel_check;
alter table public.outreach_link_clicks
  add constraint outreach_link_clicks_channel_check check (channel in ('email', 'whatsapp'));

alter table public.outreach_link_clicks alter column recipient_id drop not null;

alter table public.outreach_link_clicks drop constraint if exists outreach_link_clicks_source_check;
alter table public.outreach_link_clicks
  add constraint outreach_link_clicks_source_check check (channel <> 'email' or recipient_id is not null);

create index if not exists outreach_link_clicks_prospect_channel_dest_idx
  on public.outreach_link_clicks (prospect_id, channel, destination, created_at desc);

-- Returns true when a click row was written. Returns false (and writes nothing) for an unknown prospect, one whose
-- WhatsApp draft was never copied or marked sent, an unknown destination, or a repeat of the same click within
-- 60 seconds. Never raises on bad input, so the public route that calls it can always still redirect.
create or replace function public.record_outreach_whatsapp_click(
  p_prospect_id uuid,
  p_destination text,
  p_is_probable_bot boolean
)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_issued boolean;
  v_bot boolean := coalesce(p_is_probable_bot, false);
begin
  if p_prospect_id is null or p_destination is null
     or p_destination not in ('home', 'signup', 'contact', 'brochure') then
    return false;
  end if;

  select exists (
    select 1
      from public.outbound_contact_log l
      join public.outbound_prospects p on p.id = l.prospect_id
     where l.prospect_id = p_prospect_id
       and l.channel = 'whatsapp'
       and l.event in ('draft_copied', 'sent')
  ) into v_issued;

  if not v_issued then
    return false;
  end if;

  if exists (
    select 1 from public.outreach_link_clicks k
     where k.prospect_id = p_prospect_id
       and k.channel = 'whatsapp'
       and k.destination = p_destination
       and k.is_probable_bot = v_bot
       and k.created_at > now() - interval '60 seconds'
  ) then
    return false;
  end if;

  insert into public.outreach_link_clicks (recipient_id, prospect_id, destination, is_probable_bot, seconds_after_send, channel)
  values (null, p_prospect_id, p_destination, v_bot, null, 'whatsapp');

  return true;
end;
$$;

revoke all on function public.record_outreach_whatsapp_click(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.record_outreach_whatsapp_click(uuid, text, boolean) to service_role;
