
create table teacher_performance_reviews (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  teacher_id uuid not null references school_users(id) on delete cascade,
  reviewer_id uuid references school_users(id) on delete set null,
  academic_year_id uuid not null references academic_years(id) on delete restrict,
  term_id uuid references terms(id) on delete restrict, -- null = an annual review, not tied to one term
  review_type text not null check (review_type in ('termly', 'annual')),
  -- Structured competency scores as jsonb ({"classroom_management": 4, "subject_knowledge": 5, ...})
  -- rather than a fixed set of columns or a separate configurable-categories table — the blueprint
  -- calls this "a human-judgment record, not an algorithmic one" and asks for something simple;
  -- jsonb lets a school's competency categories evolve without a migration, while overall_rating
  -- (computed below) still gives the "simple performance-trend report" a single trendable number.
  competency_scores jsonb not null default '{}'::jsonb,
  overall_rating numeric(3,2),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table teacher_performance_reviews is 'Periodic (termly/annual) reviews by Principal/Deputy/Owner. No AI scoring — blueprint 7.2 is explicit this is a human-judgment record. Visible only to the reviewed staff member and the reviewer tier above them, never broadly to other staff.';

alter table teacher_performance_reviews enable row level security;

create index teacher_performance_reviews_school_id_idx on teacher_performance_reviews (school_id);
create index teacher_performance_reviews_teacher_id_idx on teacher_performance_reviews (teacher_id);
create index teacher_performance_reviews_reviewer_id_idx on teacher_performance_reviews (reviewer_id);
create index teacher_performance_reviews_term_id_idx on teacher_performance_reviews (term_id);
create index teacher_performance_reviews_academic_year_id_idx on teacher_performance_reviews (academic_year_id);

-- Computes overall_rating as the average of whatever numeric competency_scores were given, so it
-- stays correct even as a school's set of tracked competencies changes review to review.
create or replace function compute_review_overall_rating() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_avg numeric;
begin
  select avg(value::numeric) into v_avg
  from jsonb_each_text(new.competency_scores)
  where value ~ '^[0-9]+(\.[0-9]+)?$';
  new.overall_rating := v_avg;
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function compute_review_overall_rating() from public, anon, authenticated;

create trigger teacher_performance_reviews_compute_rating
  before insert or update on teacher_performance_reviews
  for each row execute function compute_review_overall_rating();

insert into role_permissions (role_id, school_id, permission_key, allowed)
select r.id, null, p.permission_key, true
from roles r
cross join (values ('teacher_performance.write'), ('teacher_performance.read_any')) as p(permission_key)
where r.name in ('deputy_principal', 'principal', 'school_owner');

-- Visible to: reviewer-tier staff (read_any) for anyone in their school, or the reviewed staff
-- member themselves — nobody else, per blueprint 7.2's explicit hierarchy-only visibility rule.
create policy teacher_performance_reviews_select on teacher_performance_reviews for select
  using (
    (school_id = auth_school_id() and auth_has_permission('teacher_performance.read_any'))
    or exists (select 1 from school_users su where su.id = teacher_performance_reviews.teacher_id and su.auth_user_id = (select auth.uid()))
  );

create policy teacher_performance_reviews_insert on teacher_performance_reviews for insert
  with check (school_id = auth_school_id() and auth_has_permission('teacher_performance.write'));

create policy teacher_performance_reviews_update on teacher_performance_reviews for update
  using (school_id = auth_school_id() and auth_has_permission('teacher_performance.write'))
  with check (school_id = auth_school_id() and auth_has_permission('teacher_performance.write'));
-- No delete policy — a review is a historical record, same precedent as audit_log (Phase 1): corrections
-- happen via update, the fact that a review existed is never silently erased.
