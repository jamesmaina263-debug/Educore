-- Lets a school opt out of AI exam paper generation.
--
-- Not every school wants AI-drafted question papers. Module toggles are opt-OUT (absence of a
-- school_modules row = enabled, see school_module_enabled), so registering the module here changes
-- nothing for any school until a platform admin switches it off for that school in Admin -> Modules.
-- Additive catalog row only; idempotent and guarded the same way as the scheme_of_work registration.
do $$
begin
  if to_regclass('public.platform_modules') is not null then
    insert into public.platform_modules (key, label, description, is_core)
    values ('exam_papers', 'AI Exam Papers', 'AI-drafted exam question papers grounded in the curriculum, linked from the exam workflow.', false)
    on conflict (lower(key)) do nothing;
  end if;
end $$;
