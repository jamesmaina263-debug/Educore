-- Phase 5 Item 2: White-label. schools.slug/logo_url/primary_color already existed
-- (per-campus branding, Phase 0). This adds GROUP-level branding, so a school_group can
-- set one brand shared across its campuses, with each school able to override individual
-- fields if it wants its own look.
--
-- Business rule (documented, resolved in application code, not the DB): branding resolution
-- for a given school is "school's own value if set, else fall back to its group's value, else
-- platform default" -- an explicit fallback chain, not a silent COALESCE at the DB layer, so
-- the UI can show the person which value is inherited vs overridden (same "explicit over
-- implicit" spirit as invoices snapshotting fee_structures rather than recomputing live).
--
-- Business rule: whitelabel_enabled is a platform-controlled entitlement (super_admin only,
-- since this is presumably a paid tier gate -- Trimora decides who gets to hide Trimora
-- branding, not the customer unilaterally). Once enabled, the group_admin can set the actual
-- branding values (logo/color/domain) via group.branding.write, seeded in Item 1's migration.

alter table public.school_groups
  add column logo_url text,
  add column primary_color text,
  add column custom_domain text,
  add column whitelabel_enabled boolean not null default false;

-- Domain collisions across groups are a real security/routing problem (whoever owns a domain
-- gets that school_group's branding at minimum, worse if custom-domain auth were ever added) --
-- enforced now rather than discovered at the second white-label customer.
create unique index school_groups_custom_domain_unique
  on public.school_groups (custom_domain)
  where custom_domain is not null;

-- Prevent a group_admin (who has UPDATE via group.branding.write from Item 1) from granting
-- themselves the paid entitlement by flipping whitelabel_enabled. Same escalation-prevention
-- shape as prevent_school_user_privilege_escalation.
create or replace function public.prevent_whitelabel_self_escalation()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if public.auth_is_super_admin() then
    return new;
  end if;
  if new.whitelabel_enabled is distinct from old.whitelabel_enabled then
    raise exception 'only super_admin may change whitelabel_enabled';
  end if;
  return new;
end;
$function$;

create trigger trg_prevent_whitelabel_self_escalation
  before update on public.school_groups
  for each row execute function public.prevent_whitelabel_self_escalation();

comment on column public.school_groups.custom_domain is
  'Verified custom domain for this group''s white-labeled instance (e.g. portal.somegroup.ac.ke). Verification mechanism (DNS TXT/CNAME check) is an application/Edge Function concern, not modeled in the DB -- domain is stored optimistically here and should carry a verified_at-style flag once the verification flow is built (deferred, flagged not glossed, since it needs outbound DNS lookups this session has no tool for).';
