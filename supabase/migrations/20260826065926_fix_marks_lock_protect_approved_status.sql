-- enforce_marks_lock() only guarded edits once the parent exam was formally closed --
-- it never checked the mark's own status. Since marks.status isn't included in
-- submitMarks()'s upsert payload, re-submitting the roster (the normal, everyday path
-- teachers use) silently overwrites raw_score/band_id on an already-approved mark while
-- leaving status='approved', approved_by, and approved_at untouched -- misrepresenting
-- that the original approver certified the new score, with no edit_reason captured at
-- all, as long as the exam hadn't yet been formally closed. Extend the same
-- edit-reason-required rule that already applies to closed exams to also apply whenever
-- an already-approved mark's score is changing, regardless of exam status.

create or replace function public.enforce_marks_lock()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_status text;
begin
  select status into v_status from exams where id = new.exam_id;
  if v_status = 'closed' then
    if TG_OP = 'INSERT' then
      raise exception 'Cannot add marks to a closed exam. Reopen it first.';
    end if;
    if new.edit_reason is null or btrim(new.edit_reason) = '' then
      raise exception 'Editing a mark on a closed exam requires a reason.';
    end if;
  end if;

  if TG_OP = 'UPDATE' and old.status = 'approved'
     and (new.raw_score is distinct from old.raw_score or new.band_id is distinct from old.band_id) then
    if new.edit_reason is null or btrim(new.edit_reason) = '' then
      raise exception 'Editing an approved mark requires a reason.';
    end if;
  end if;

  return new;
end;
$function$;
