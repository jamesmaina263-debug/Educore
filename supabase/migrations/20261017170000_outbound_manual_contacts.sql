-- Lets a person type a prospect's contact details by hand (e.g. after phoning the school office).
--
-- Typed details REPLACE the five contact fields and count as confirmed by a person: contact_status
-- becomes 'verified' (or NULL if everything was cleared) and the machine-found source URL is dropped,
-- since the old link no longer describes what is stored. Additive: one new function only.
--
-- Promoted prospects are refused (their details already live on the sales lead). The existing
-- contact-log and opt-out checks key on the stored phone/email, so editing a contact can never
-- bypass an opt-out.

create or replace function public.admin_update_outbound_prospect_contacts(
  p_id uuid,
  p_website text,
  p_phone text,
  p_email text,
  p_contact_name text,
  p_contact_role text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_status text;
  v_website text := nullif(btrim(p_website), '');
  v_phone text := nullif(btrim(p_phone), '');
  v_email text := nullif(lower(btrim(p_email)), '');
  v_name text := nullif(btrim(p_contact_name), '');
  v_role text := nullif(btrim(p_contact_role), '');
begin
  if not auth_is_super_admin() then
    raise exception 'Not authorized to manage outbound prospects.';
  end if;

  select status into v_status from public.outbound_prospects where id = p_id for update;
  if not found then
    raise exception 'Outbound prospect not found.';
  end if;
  if v_status = 'promoted' then
    raise exception 'This prospect has already been added to the sales pipeline; edit the lead there instead.';
  end if;

  if v_email is not null and v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$' then
    raise exception 'That email address does not look valid.';
  end if;

  update public.outbound_prospects
     set website = v_website,
         phone = v_phone,
         email = v_email,
         contact_name = v_name,
         contact_role = v_role,
         contact_status = case when coalesce(v_website, v_phone, v_email, v_name) is not null then 'verified' else null end,
         contact_source_url = null,
         contact_found_at = null,
         updated_at = now()
   where id = p_id;
end;
$$;

revoke all on function public.admin_update_outbound_prospect_contacts(uuid, text, text, text, text, text) from public, anon;
grant execute on function public.admin_update_outbound_prospect_contacts(uuid, text, text, text, text, text) to authenticated;
