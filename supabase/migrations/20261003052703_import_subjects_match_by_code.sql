-- bulk_import_subjects: pick the catalogue subject by Code, and refuse an ambiguous Name.
--
-- Bug: the import found the catalogue entry with `where lower(name) = lower(v_name)` and
-- `select ... into`, which silently takes an arbitrary row when the name exists at several
-- levels. 16 catalogue names do (Mathematics x4, Kiswahili x4, English/French/German/... x3), so
-- re-importing an export (whose Subjects sheet already carries Code) could activate or
-- deactivate the wrong level, and could never address more than one of them.
--
-- Now: a Code (unique per catalogue entry) selects the exact subject and its Name must agree;
-- with no Code, a name that matches exactly one entry works as before, and a name that matches
-- several fails with a message listing their codes. Only the catalogue lookup changes; the
-- authorization, upsert and result handling are identical to 20260902141909.
create or replace function public.bulk_import_subjects(p_rows jsonb)
returns table(row_number integer, status text, message text)
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_school_id uuid;
  v_row jsonb;
  v_idx integer := 0;
  v_name text;
  v_code text;
  v_matches integer;
  v_codes text;
  v_is_active boolean;
  v_catalogue record;
  v_existing_id uuid;
  v_existing_active boolean;
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

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_idx := v_idx + 1;
    begin
      v_name := nullif(trim(both from (v_row->>'name')), '');
      if v_name is null then
        raise exception 'Name is required.';
      end if;
      v_code := nullif(trim(both from (v_row->>'code')), '');
      v_is_active := coalesce(nullif(lower(trim(both from (v_row->>'is_active'))), '')::boolean, true);

      if v_code is not null then
        -- Catalogue codes are unique (MATH, UP-MATH, LP-MATH, ...), unlike names, so a Code
        -- pins the exact level. The Name must agree with it.
        select id, name, code, is_core into v_catalogue from subject_catalogue where lower(code) = lower(v_code);
        if v_catalogue.id is null then
          raise exception 'No subject in the CBC catalogue has code "%".', v_code;
        end if;
        if lower(v_catalogue.name) <> lower(v_name) then
          raise exception 'Code "%" is "%" in the catalogue, not "%" -- fix the Name or the Code.', v_code, v_catalogue.name, v_name;
        end if;
      else
        select count(*), string_agg(code, ', ' order by code) into v_matches, v_codes
          from subject_catalogue where lower(name) = lower(v_name);
        if v_matches = 0 then
          raise exception 'No subject in the CBC catalogue matches "%" -- check spelling against the master subject list.', v_name;
        end if;
        if v_matches > 1 then
          -- Same name at several levels (e.g. Mathematics: JS-MATH, LP-MATH, MATH, UP-MATH).
          -- Guessing would activate the wrong level, so ask for the Code instead.
          raise exception '"%" exists at % levels in the catalogue (%) -- add the Code column to choose one.', v_name, v_matches, v_codes;
        end if;
        select id, name, code, is_core into v_catalogue from subject_catalogue where lower(name) = lower(v_name);
      end if;

      select id, is_active into v_existing_id, v_existing_active
        from subjects where school_id = v_school_id and catalogue_id = v_catalogue.id;

      if v_existing_id is not null then
        update subjects set is_active = v_is_active where id = v_existing_id;
      else
        insert into subjects (school_id, catalogue_id, name, code, is_core, is_active)
        values (v_school_id, v_catalogue.id, v_catalogue.name, v_catalogue.code, v_catalogue.is_core, v_is_active);
      end if;

      row_number := v_idx; status := 'ok'; message := format('%s imported.', v_catalogue.name);
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
revoke all on function public.bulk_import_subjects(jsonb) from public, anon;
grant execute on function public.bulk_import_subjects(jsonb) to authenticated;
