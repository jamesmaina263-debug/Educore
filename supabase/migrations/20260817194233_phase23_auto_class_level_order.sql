-- Phase 23: automatic classes.level_order.
--
-- Confirmed live before this migration: Demo Academy has classes named
-- "1" through "11", and every one of them except "10" is stuck at
-- level_order = 1 (the old UI's default value), because level_order was a
-- free-typed number field with no derivation logic. Sorting/report-card
-- ordering/rollover_function() were all silently broken for that school.
--
-- New behavior: level_order is computed automatically from the class name
-- (first run of digits anywhere in it -- "Grade 6" / "Form 6" / "S.6" /
-- "PP1" / a bare "6" all resolve to 6). A school administrator only needs
-- to type the class name; nothing about sorting requires a number field.
--
-- A new level_order_is_manual flag preserves an escape hatch: if a name has
-- no digits at all ("Reception", "Baby Class"), or a school mixes naming
-- schemes where naive digit-extraction would collide (e.g. "PP1"/"PP2" vs
-- "Grade 1"/"Grade 2" in the same school), the admin can set level_order
-- explicitly and it will never be silently overwritten again.

alter table public.classes
  add column level_order_is_manual boolean not null default false;

alter table public.classes
  alter column level_order drop default;

create or replace function public.assign_class_level_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_extracted smallint;
begin
  if new.level_order_is_manual then
    if new.level_order is null then
      raise exception 'level_order must be set when level_order_is_manual is true';
    end if;
    return new;
  end if;

  v_extracted := nullif(substring(new.name from '\d+'), '')::smallint;

  if v_extracted is not null then
    new.level_order := v_extracted;
  elsif tg_op = 'INSERT' then
    -- No digits in the name at all (e.g. "Reception") -- append after
    -- whatever already exists in this academic year rather than asking
    -- the admin to type a number.
    new.level_order := coalesce(
      (select max(level_order) from classes where academic_year_id = new.academic_year_id),
      0
    ) + 1;
  end if;
  -- On UPDATE with no digits in the (possibly renamed) name, leave the
  -- existing level_order untouched rather than guessing.

  return new;
end;
$$;

revoke execute on function public.assign_class_level_order() from public;
revoke execute on function public.assign_class_level_order() from anon;

create trigger trg_classes_assign_level_order
  before insert or update of name, level_order_is_manual on public.classes
  for each row execute function public.assign_class_level_order();

-- Backfill: only touch rows where a number can be confidently extracted
-- from the existing name, and only when that differs from the current
-- (often wrong/collided) value. Rows with no digits in their name are left
-- exactly as they are -- nothing to safely infer for those.
update public.classes
set level_order = nullif(substring(name from '\d+'), '')::smallint
where substring(name from '\d+') is not null
  and level_order is distinct from nullif(substring(name from '\d+'), '')::smallint;
