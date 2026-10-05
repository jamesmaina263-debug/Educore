-- Guard schools.logo_url so a custom logo can only come from the server-side upload action.
--
-- Context: schools_update RLS is gated on settings.branding.write but is table-wide, and
-- RLS -- not app code -- is the real enforcement boundary (see
-- 20260905061419_protect_schools_sensitive_fields_from_branding_write.sql). Before this,
-- any branding.write holder could set logo_url to ANY URL (directly via the REST API, or
-- via the old free-text "Logo URL" field). Logos are rendered on public pages, receipts and
-- ID cards, so an arbitrary external URL is a tracking-pixel / content-spoofing vector
-- (it lets the URL's owner see the IP + user agent of every parent who opens a receipt).
--
-- New rule: a non-service-role, non-super-admin caller may only
--   * leave logo_url unchanged,
--   * clear it (null / ''), or
--   * point it at a first-party /branding/ asset.
-- Setting a custom logo goes through uploadSchoolLogo (settings/actions.ts), which checks
-- settings.branding.write, verifies the file bytes, uploads to the school-logos bucket and
-- writes logo_url with the service-role client. Signup's logo upload also uses the
-- service-role client, so it is unaffected. Existing rows with an external URL keep working
-- (unchanged values pass); they just can't be edited to another external URL.
--
-- SECURITY INVOKER on purpose: it only calls auth_is_super_admin()/auth.role(), and keeping
-- it out of SECURITY DEFINER scope avoids the anon-execute drift check.
-- Idempotent (create or replace / drop trigger if exists) per the repo's migration rules.

create or replace function public.guard_schools_logo_url()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if auth.role() = 'service_role' or auth_is_super_admin() then
    return NEW;
  end if;

  if tg_op = 'UPDATE' then
    if NEW.logo_url is not distinct from OLD.logo_url then
      return NEW;
    end if;
  end if;

  if NEW.logo_url is null
     or NEW.logo_url = ''
     or (NEW.logo_url like '/branding/%' and position('..' in NEW.logo_url) = 0) then
    return NEW;
  end if;

  raise exception 'The school logo can only be set by uploading an image in Settings > Branding.';
end;
$$;

drop trigger if exists trg_schools_guard_logo_url on public.schools;
create trigger trg_schools_guard_logo_url
before insert or update of logo_url on public.schools
for each row execute function public.guard_schools_logo_url();
