
create table fee_structures (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  academic_year_id uuid not null references academic_years(id) on delete restrict,
  term_id uuid not null references terms(id) on delete restrict,
  class_id uuid references classes(id) on delete cascade, -- null = applies to all grades
  -- Boarding fee structures are common in Kenyan secondary schools (day-scholar vs boarder), and
  -- interact with the (still deferred) Hostel module. Reserving the column now, per blueprint 7.7's
  -- flagged dependency, avoids a breaking migration when Hostel is eventually built — no boarding
  -- logic is wired up yet, this is a design-now-build-later column exactly like grading_scale_id was.
  boarding_type text not null default 'day' check (boarding_type in ('day', 'boarder')),
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table fee_structures is 'A named fee structure for a term/grade/boarding-type combination. Invoices snapshot from the active structure at generation time and never recompute retroactively if the structure changes later (blueprint Part D) — the structure itself can keep changing after invoices exist.';

create table fee_items (
  id uuid primary key default gen_random_uuid(),
  fee_structure_id uuid not null references fee_structures(id) on delete cascade,
  name text not null,
  amount numeric(10,2) not null check (amount >= 0),
  created_at timestamptz not null default now()
);

alter table fee_structures enable row level security;
alter table fee_items enable row level security;

create index fee_structures_school_id_idx on fee_structures (school_id);
create index fee_structures_term_id_idx on fee_structures (term_id);
create index fee_structures_class_id_idx on fee_structures (class_id);
create index fee_structures_academic_year_id_idx on fee_structures (academic_year_id);
create index fee_items_fee_structure_id_idx on fee_items (fee_structure_id);

-- Finance permissions, per blueprint §8's roles matrix exactly: Bursar and Owner get full Finance;
-- Principal is READ-ONLY on Finance day-to-day (their actual power is the separate discount/expense
-- approval permissions below — oversight and approval are different permissions on purpose, matching
-- "a bursar cannot unilaterally discount a fee" / Principal signs off, doesn't run Finance);
-- Deputy Principal gets none at all per the matrix.
insert into role_permissions (role_id, school_id, permission_key, allowed)
select r.id, null, p.permission_key, true
from roles r
cross join (values ('finance.read'), ('finance.write')) as p(permission_key)
where
  (r.name in ('bursar','principal','school_owner') and p.permission_key = 'finance.read')
  or (r.name in ('bursar','school_owner') and p.permission_key = 'finance.write');

create policy fee_structures_select on fee_structures for select
  using (school_id = auth_school_id() and auth_has_permission('finance.read'));
create policy fee_structures_insert on fee_structures for insert
  with check (school_id = auth_school_id() and auth_has_permission('finance.write'));
create policy fee_structures_update on fee_structures for update
  using (school_id = auth_school_id() and auth_has_permission('finance.write'))
  with check (school_id = auth_school_id() and auth_has_permission('finance.write'));
create policy fee_structures_delete on fee_structures for delete
  using (school_id = auth_school_id() and auth_has_permission('finance.write'));

create policy fee_items_select on fee_items for select
  using (exists (select 1 from fee_structures fs where fs.id = fee_items.fee_structure_id and fs.school_id = auth_school_id() and auth_has_permission('finance.read')));
create policy fee_items_insert on fee_items for insert
  with check (exists (select 1 from fee_structures fs where fs.id = fee_items.fee_structure_id and fs.school_id = auth_school_id() and auth_has_permission('finance.write')));
create policy fee_items_update on fee_items for update
  using (exists (select 1 from fee_structures fs where fs.id = fee_items.fee_structure_id and fs.school_id = auth_school_id() and auth_has_permission('finance.write')))
  with check (exists (select 1 from fee_structures fs where fs.id = fee_items.fee_structure_id and fs.school_id = auth_school_id() and auth_has_permission('finance.write')));
create policy fee_items_delete on fee_items for delete
  using (exists (select 1 from fee_structures fs where fs.id = fee_items.fee_structure_id and fs.school_id = auth_school_id() and auth_has_permission('finance.write')));
