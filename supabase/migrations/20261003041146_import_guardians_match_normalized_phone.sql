-- bulk_import_guardians: find the existing parent by NORMALIZED phone within the school, instead
-- of an exact string compare against +254XXXXXXXXX.
--
-- Bug: parents stored with raw phones (0711236389, "+254 724 868896", "254 746494253") were not
-- found, so the import created a duplicate parent for each and, via enforce_single_primary_guardian,
-- made the duplicate the student's primary contact (the original was demoted). The lookup was also
-- not scoped to the caller's school.
--
-- Adds normalize_kenyan_phone() (same rules as lib/guardians.ts) and uses it on both sides. Stored
-- phone numbers are NOT modified. The rest of the function is unchanged.
create or replace function public.normalize_kenyan_phone(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  -- Same rules as normalizeKenyanPhone() in src/lib/guardians.ts: returns +254XXXXXXXXX, or NULL
  -- when the value is not a Kenyan mobile number.
  select case
    when d ~ '^\+254\d{9}$' then d
    when d ~ '^0[17]\d{8}$' then '+254' || substr(d, 2)
    when d ~ '^254[17]\d{8}$' then '+' || d
    when d ~ '^[17]\d{8}$' then '+254' || d
    else null
  end
  from (select regexp_replace(coalesce(p, ''), '[\s\-()]', '', 'g') as d) t
$$;
revoke all on function public.normalize_kenyan_phone(text) from public, anon;
grant execute on function public.normalize_kenyan_phone(text) to authenticated;

create or replace function public.bulk_import_guardians(p_rows jsonb)
returns table(row_number integer, status text, message text)
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_school_id uuid;
  v_row jsonb;
  v_idx integer := 0;
  v_adm text;
  v_student_id uuid;
  v_full_name text;
  v_phone_raw text;
  v_phone text;
  v_email text;
  v_relationship text;
  v_primary_raw text;
  v_primary boolean;
  v_parent_role_id uuid;
  v_guardian_id uuid;
  v_guardian_role_name text;
begin
  if not (auth_is_super_admin() or auth_has_permission('settings.data_import')) then
    raise exception 'Not authorized to import school data.';
  end if;
  v_school_id := auth_school_id();
  if v_school_id is null and not auth_is_super_admin() then
    raise exception 'Could not resolve your school.';
  end if;
  if jsonb_array_length(p_rows) > 2000 then
    raise exception 'Too many rows in one upload (max 2000) -- split the file and upload in batches.';
  end if;

  select id into v_parent_role_id from roles where name = 'parent';

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_idx := v_idx + 1;
    begin
      v_adm := nullif(trim(both from (v_row->>'student_admission_number')), '');
      v_full_name := nullif(trim(both from (v_row->>'guardian_full_name')), '');
      v_phone_raw := trim(both from (v_row->>'guardian_phone'));
      v_email := nullif(trim(both from (v_row->>'guardian_email')), '');
      v_relationship := lower(nullif(trim(both from (v_row->>'relationship')), ''));
      v_primary_raw := lower(nullif(trim(both from (v_row->>'primary_contact')), ''));
      v_primary := v_primary_raw in ('yes', 'true', '1');

      if v_adm is null or v_full_name is null then
        raise exception 'Student Adm. No. and Guardian Name are required.';
      end if;
      if v_relationship not in ('mother', 'father', 'guardian', 'other') then
        raise exception 'Relationship must be one of mother, father, guardian, other (got "%").', coalesce(v_row->>'relationship', '(blank)');
      end if;

      select id into v_student_id from students where school_id = v_school_id and lower(admission_number) = lower(v_adm);
      if v_student_id is null then
        raise exception 'No student found matching Adm. No. "%" -- import Students first.', v_adm;
      end if;

      -- Normalize to +254XXXXXXXXX, same rules as normalizeKenyanPhone() in lib/guardians.ts.
      v_phone := public.normalize_kenyan_phone(v_phone_raw);
      if v_phone is null then
        raise exception 'Guardian Phone must be a valid Kenyan mobile number, e.g. 0712345678 (got "%").', coalesce(v_phone_raw, '(blank)');
      end if;

      -- Match on the *normalized* stored phone, inside this school. Parents saved by other
      -- flows (admission wizard, older imports) keep raw formats such as 0711236389 or
      -- "+254 724 868896", which an exact string compare never matched -- the import then
      -- created a second copy of the same parent and made it the primary contact.
      -- If several rows share a number, prefer the parent with the same name, then a
      -- parent role, then the oldest. A stored phone that is not a valid Kenyan mobile
      -- normalizes to NULL and never matches.
      select su.id, r.name into v_guardian_id, v_guardian_role_name
        from school_users su join roles r on r.id = su.role_id
        where (v_school_id is null or su.school_id = v_school_id)
          and public.normalize_kenyan_phone(su.phone) = v_phone
        order by (lower(trim(both from su.full_name)) = lower(v_full_name)) desc,
                 (r.name = 'parent') desc,
                 su.created_at asc
        limit 1;

      if v_guardian_id is not null and v_guardian_role_name <> 'parent' then
        raise exception 'Phone number % is already registered under a different role.', v_phone;
      end if;

      if v_guardian_id is null then
        insert into school_users (school_id, role_id, full_name, phone, email)
        values (v_school_id, v_parent_role_id, v_full_name, v_phone, v_email)
        returning id into v_guardian_id;
      end if;

      insert into student_guardians (student_id, guardian_user_id, relationship, primary_contact)
      values (v_student_id, v_guardian_id, v_relationship, v_primary)
      on conflict (student_id, guardian_user_id)
      do update set relationship = excluded.relationship, primary_contact = excluded.primary_contact;

      row_number := v_idx; status := 'ok'; message := format('%s linked to %s.', v_full_name, v_adm);
      return next;
    exception
      when others then
        row_number := v_idx; status := 'error'; message := sqlerrm;
        return next;
    end;
  end loop;
  return;
end;
$$;
revoke all on function public.bulk_import_guardians(jsonb) from public, anon;
grant execute on function public.bulk_import_guardians(jsonb) to authenticated;
