-- Academic-year rollover / bulk student promotion (Gap Analysis Tier 1 #2).
-- students.current_class_id actually points to streams.id (existing naming),
-- so promotion history stores stream ids under from_stream_id/to_stream_id
-- to avoid perpetuating that ambiguity in a new table.
create table student_promotion_history (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id),
  student_id uuid not null references students(id),
  from_academic_year_id uuid not null references academic_years(id),
  to_academic_year_id uuid not null references academic_years(id),
  from_stream_id uuid references streams(id),
  to_stream_id uuid references streams(id),
  outcome text not null check (outcome in ('promoted','repeated','graduated')),
  promoted_by uuid references school_users(id),
  created_at timestamptz not null default now()
);

comment on table student_promotion_history is
  'Immutable audit trail of every rollover_academic_year() outcome per student. No delete/update policy, same convention as teacher_performance_reviews/ai_query_logs.';

create index idx_promotion_history_school_student on student_promotion_history(school_id, student_id);
create index idx_promotion_history_to_year on student_promotion_history(to_academic_year_id);

alter table student_promotion_history enable row level security;

create policy student_promotion_history_select on student_promotion_history
  for select to authenticated
  using (school_id = auth_school_id() and auth_has_permission('students.read'));

-- No insert/update/delete policy for authenticated role: rows are only ever
-- written by the SECURITY DEFINER rollover_academic_year() function.
