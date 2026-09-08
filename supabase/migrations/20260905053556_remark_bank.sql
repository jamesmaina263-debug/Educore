create table remark_bank_entries (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references schools(id) on delete cascade,
  category text not null check (category in (
    'strength', 'progress', 'needs_support',
    'communication_and_collaboration', 'critical_thinking_and_problem_solving',
    'creativity_and_imagination', 'citizenship', 'digital_literacy',
    'learning_to_learn', 'self_efficacy', 'general'
  )),
  body text not null check (char_length(body) between 1 and 500),
  content_source text not null default 'school_authored' check (content_source in ('school_authored', 'draft')),
  is_active boolean not null default true,
  created_by uuid references school_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table remark_bank_entries is 'Searchable, categorized report-card remark templates. A teacher searches/filters, picks one, and edits the inserted copy before saving -- this table is never itself shown to a parent. school_id null = global EduCore-authored library (super_admin-managed); school_id set = that school''s own additions. Never contains KICD-licensed text -- see content_source check constraint.';

create index idx_remark_bank_entries_school on remark_bank_entries(school_id);
create index idx_remark_bank_entries_category on remark_bank_entries(category);

create trigger trg_remark_bank_entries_updated_at before update on remark_bank_entries
  for each row execute function set_updated_at();

alter table remark_bank_entries enable row level security;

create policy remark_bank_entries_select on remark_bank_entries
  for select to authenticated
  using (school_id is null or (school_id = auth_school_id() and auth_has_permission('academics.read')));

create policy remark_bank_entries_super_admin_write on remark_bank_entries
  for all to authenticated
  using (school_id is null and auth_is_super_admin())
  with check (school_id is null and auth_is_super_admin());

create policy remark_bank_entries_school_write on remark_bank_entries
  for all to authenticated
  using (school_id = auth_school_id() and auth_has_permission('academics.write'))
  with check (school_id = auth_school_id() and auth_has_permission('academics.write'));

insert into remark_bank_entries (category, body) values
  ('strength', 'Consistently produces high-quality work and shows strong command of the subject matter.'),
  ('strength', 'Demonstrates confidence and independence when tackling new tasks.'),
  ('progress', 'Has shown steady improvement this term and is building on previous feedback well.'),
  ('progress', 'Making encouraging progress -- keep up the consistent effort shown this term.'),
  ('needs_support', 'Would benefit from additional practice and more consistent revision at home.'),
  ('needs_support', 'Needs continued support and encouragement to build confidence in this area.'),
  ('communication_and_collaboration', 'Communicates ideas clearly and works well with peers in group settings.'),
  ('communication_and_collaboration', 'Is developing the confidence to share ideas out loud; benefits from more speaking opportunities.'),
  ('critical_thinking_and_problem_solving', 'Applies logical reasoning confidently when solving unfamiliar problems.'),
  ('critical_thinking_and_problem_solving', 'Is developing problem-solving skills; benefits from guided practice breaking problems into steps.'),
  ('creativity_and_imagination', 'Brings original ideas and creative approaches to tasks and projects.'),
  ('citizenship', 'Shows respect and responsibility towards classmates, staff, and school property.'),
  ('digital_literacy', 'Uses digital tools confidently and appropriately to support learning.'),
  ('learning_to_learn', 'Sets personal goals and reflects thoughtfully on their own learning.'),
  ('self_efficacy', 'Shows growing self-confidence and a willingness to try again after setbacks.'),
  ('general', 'A pleasure to have in class -- consistently positive and engaged.');
