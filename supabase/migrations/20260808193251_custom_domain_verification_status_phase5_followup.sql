-- Follow-up to Phase 5 Item 2 (white-label). Closes the gap flagged in
-- PHASE_5_HANDOVER.md: custom_domain was stored the moment a group_admin typed it in, with
-- no distinction between "requested" and "actually verified/live". This adds that distinction
-- and gates it the same way whitelabel_enabled already is -- a platform (super_admin) call,
-- not something a customer can grant themselves.

alter table public.school_groups
  add column custom_domain_status text not null default 'pending'
    check (custom_domain_status in ('pending', 'verified')),
  add column verified_at timestamptz,
  add column verified_by uuid references public.school_users(id);

create or replace function public.prevent_whitelabel_self_escalation()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_is_super boolean := public.auth_is_super_admin();
  v_caller_su uuid;
begin
  if not v_is_super then
    if new.whitelabel_enabled is distinct from old.whitelabel_enabled then
      raise exception 'only super_admin may change whitelabel_enabled';
    end if;
    if new.custom_domain_status is distinct from old.custom_domain_status then
      raise exception 'only super_admin may change custom_domain_status';
    end if;
    if new.verified_at is distinct from old.verified_at then
      raise exception 'only super_admin may set verified_at';
    end if;
    if new.verified_by is distinct from old.verified_by then
      raise exception 'only super_admin may set verified_by';
    end if;
  end if;

  -- Any change to the domain value itself invalidates prior verification -- a
  -- previously-verified domain string being edited is a NEW domain as far as ownership goes.
  -- Exception: a super_admin setting the domain and marking it verified in the same
  -- statement (the normal "I just finished the manual DNS check" flow from the runbook).
  if new.custom_domain is distinct from old.custom_domain then
    if not (v_is_super and new.custom_domain_status = 'verified') then
      new.custom_domain_status := 'pending';
      new.verified_at := null;
      new.verified_by := null;
    end if;
  end if;

  -- Auto-stamp who/when verified it, so a super_admin doesn't have to pass those explicitly.
  if v_is_super and new.custom_domain_status = 'verified'
     and old.custom_domain_status is distinct from 'verified' then
    if new.verified_at is null then
      new.verified_at := now();
    end if;
    if new.verified_by is null then
      select su.id into v_caller_su from school_users su
      where su.auth_user_id = auth.uid() and su.status = 'active';
      new.verified_by := v_caller_su;
    end if;
  end if;

  return new;
end;
$function$;

comment on column public.school_groups.custom_domain_status is
  'pending = group_admin has requested this domain, not yet verified. verified = Trimora has confirmed DNS ownership (manual runbook, no automated DNS check exists yet) and attached it in Vercel. Resets to pending automatically whenever custom_domain itself changes.';
