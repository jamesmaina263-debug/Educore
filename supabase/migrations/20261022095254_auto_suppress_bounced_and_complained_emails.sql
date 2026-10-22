-- Auto-suppress addresses that hard-bounce or report spam (follow-up to 20261021120000_email_delivery_events.sql).
--
-- Why: the Resend webhook records every bounce and spam report in email_delivery_events, but nothing acted on
-- them. marketing_email_suppressions already accepts reason 'bounced' / 'complained' and every promotional
-- send path (campaigns, prospect sequence, trial nudges) already checks it, yet no code ever wrote those rows.
-- A dead address therefore kept being emailed on every later campaign and bounced again, which is what damages
-- sender reputation. This closes that loop.
--
-- What changes: record_email_event() (same signature, same grants, still service_role only) now also writes a
-- suppression row in the SAME transaction as the event, so the two cannot drift:
--   * email.bounced  with a PERMANENT bounce (bounce_type starts "Permanent", e.g. "Permanent / General",
--     "Permanent / Suppressed") -> reason 'bounced'.
--     Transient (mailbox full, temporary failure) and Undetermined bounces are NOT suppressed: a good address
--     must not be blocked by a one-off problem.
--   * email.complained -> reason 'complained'.
-- Only newly recorded events act (a replayed webhook is a no-op), an existing suppression row is never
-- overwritten (so an 'unsubscribed' address stays 'unsubscribed'), and addresses that are not valid emails are
-- skipped while the event itself is still recorded. Uses the same normaliser as the other opt-out paths.
--
-- Scope: marketing_email_suppressions is promotional-only by design. Transactional mail (OTP, password reset,
-- billing, school communications) is unaffected. Nothing is deleted anywhere; the 180-day purge still applies
-- to the event log only and never to suppressions.
--
-- Additive: replaces one function body. Safe to run twice. Only addresses bounced from now on are suppressed;
-- history is not back-filled.

create or replace function public.record_email_event(
  p_svix_id text,
  p_event_type text,
  p_occurred_at timestamptz,
  p_email_id text,
  p_from text,
  p_to text,
  p_subject text,
  p_bounce_type text,
  p_bounce_reason text
)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_inserted integer;
  v_email text;
  v_reason text;
begin
  if p_svix_id is null or btrim(p_svix_id) = '' or p_event_type is null or p_event_type not like 'email.%' then
    return false;
  end if;

  insert into public.email_delivery_events
    (svix_id, event_type, occurred_at, email_id, from_address, to_address, subject, bounce_type, bounce_reason)
  values
    (left(p_svix_id, 200),
     left(p_event_type, 60),
     coalesce(p_occurred_at, now()),
     left(p_email_id, 100),
     left(p_from, 320),
     left(lower(p_to), 320),
     left(p_subject, 300),
     left(p_bounce_type, 60),
     left(p_bounce_reason, 500))
  on conflict (svix_id) do nothing;

  get diagnostics v_inserted = row_count;

  -- Act only on a newly recorded event: a retried webhook must not re-run this.
  if v_inserted > 0 then
    v_reason := case
      when p_event_type = 'email.complained' then 'complained'
      when p_event_type = 'email.bounced' and p_bounce_type ilike 'permanent%' then 'bounced'
      else null
    end;

    if v_reason is not null then
      v_email := public._normalize_contact_identifier('email', p_to);
      if v_email is not null then
        insert into public.marketing_email_suppressions (email, reason)
        values (v_email, v_reason)
        on conflict (email) do nothing;
      end if;
    end if;
  end if;

  return v_inserted > 0;
end;
$$;

-- Unchanged from the original migration; restated so this file stands on its own.
revoke all on function public.record_email_event(text, text, timestamptz, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.record_email_event(text, text, timestamptz, text, text, text, text, text, text)
  to service_role;
