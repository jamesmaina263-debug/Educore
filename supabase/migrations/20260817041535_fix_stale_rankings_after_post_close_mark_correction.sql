-- close_exam() computed class_rankings once at close time, but the UI
-- deliberately allows correcting a mark after close (with a mandatory reason).
-- Nothing recomputed rankings afterward, so report cards and the parent portal
-- (both read class_rankings directly, not a live computation) would silently
-- show stale averages/ranks after any post-close correction.
--
-- Extract the ranking computation into its own function, reused by close_exam,
-- and add a trigger that recomputes automatically whenever a closed exam's
-- marks change.

create or replace function public.recompute_class_rankings(p_exam_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  delete from public.class_rankings where exam_id = p_exam_id;

  insert into public.class_rankings (exam_id, class_id, stream_id, student_id, total_score, average_score, subjects_counted, rank_in_stream, rank_in_class)
  select
    p_exam_id,
    m.class_id,
    st.current_class_id,
    m.student_id,
    sum(m.raw_score),
    avg(m.raw_score),
    count(m.raw_score),
    rank() over (partition by st.current_class_id order by avg(m.raw_score) desc),
    rank() over (partition by m.class_id order by avg(m.raw_score) desc)
  from public.marks m
  join public.students st on st.id = m.student_id
  join public.classes c on c.id = m.class_id
  join public.schools s on s.id = c.school_id
  where m.exam_id = p_exam_id
    and m.raw_score is not null -- numeric-scale marks only; CBC marks have no raw_score to average
  group by m.class_id, st.current_class_id, m.student_id;
end;
$$;

revoke all on function public.recompute_class_rankings(uuid) from public, anon, authenticated;

create or replace function public.close_exam(p_exam_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school_id uuid := auth_school_id();
  v_caller_id uuid;
begin
  if not auth_has_permission('exams.write') then
    raise exception 'Not authorized to close exams.';
  end if;
  if not exists (select 1 from exams where id = p_exam_id and school_id = v_school_id) then
    raise exception 'Exam not found.';
  end if;

  select id into v_caller_id from school_users where auth_user_id = auth.uid() and status = 'active';

  update exams set status = 'closed', closed_at = now(), closed_by = v_caller_id where id = p_exam_id;

  perform public.recompute_class_rankings(p_exam_id);
end;
$$;

-- Auto-recompute rankings whenever a closed exam's marks change (the
-- post-close correction path). Only fires when the exam is actually closed
-- and the score actually changed -- a no-op edit or an open-exam edit (which
-- has no rankings yet to go stale) doesn't trigger a recompute.
create or replace function public.marks_recompute_rankings_on_correction()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_status text;
begin
  select status into v_status from public.exams where id = new.exam_id;
  if v_status = 'closed' and new.raw_score is distinct from old.raw_score then
    perform public.recompute_class_rankings(new.exam_id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_marks_recompute_rankings_on_correction on public.marks;
create trigger trg_marks_recompute_rankings_on_correction
after update on public.marks
for each row
execute function public.marks_recompute_rankings_on_correction();
