
-- Academic years
create table academic_years (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id),
  name text not null,
  start_date date not null,
  end_date date not null,
  status text not null default 'upcoming' check (status in ('upcoming','active','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, name),
  check (end_date > start_date)
);
create unique index academic_years_one_active_per_school on academic_years(school_id) where status = 'active';
create trigger trg_academic_years_updated_at before update on academic_years for each row execute function set_updated_at();

-- Terms
create table terms (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id),
  academic_year_id uuid not null references academic_years(id),
  name text not null,
  term_number smallint not null check (term_number between 1 and 3),
  start_date date not null,
  end_date date not null,
  status text not null default 'upcoming' check (status in ('upcoming','active','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (academic_year_id, term_number),
  check (end_date > start_date)
);
create unique index terms_one_active_per_year on terms(academic_year_id) where status = 'active';
create trigger trg_terms_updated_at before update on terms for each row execute function set_updated_at();

-- Classes (grade/level definition, one row per grade per academic year)
create table classes (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id),
  academic_year_id uuid not null references academic_years(id),
  name text not null,
  level_order smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (academic_year_id, name)
);
create trigger trg_classes_updated_at before update on classes for each row execute function set_updated_at();

-- Streams (the concrete teaching unit students belong to, e.g. "6A")
create table streams (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id),
  class_id uuid not null references classes(id),
  name text not null,
  class_teacher_id uuid references school_users(id),
  capacity int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (class_id, name)
);
create trigger trg_streams_updated_at before update on streams for each row execute function set_updated_at();

-- Link students to their concrete teaching unit
alter table students add constraint students_current_class_id_fkey foreign key (current_class_id) references streams(id);

-- Subjects
create table subjects (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id),
  name text not null,
  code text,
  is_core boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, name)
);
create trigger trg_subjects_updated_at before update on subjects for each row execute function set_updated_at();

-- Subject-teacher assignment per stream
create table class_subjects (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id),
  stream_id uuid not null references streams(id),
  subject_id uuid not null references subjects(id),
  teacher_id uuid references school_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (stream_id, subject_id)
);
create trigger trg_class_subjects_updated_at before update on class_subjects for each row execute function set_updated_at();

-- Timetable slots (schema only this item; UI deferred to post-MVP per blueprint Part C)
create table timetable_slots (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id),
  stream_id uuid not null references streams(id),
  subject_id uuid not null references subjects(id),
  teacher_id uuid references school_users(id),
  day_of_week smallint not null check (day_of_week between 1 and 7),
  period_number smallint not null check (period_number > 0),
  start_time time not null,
  end_time time not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (stream_id, day_of_week, period_number),
  unique (teacher_id, day_of_week, period_number),
  check (end_time > start_time)
);
create trigger trg_timetable_slots_updated_at before update on timetable_slots for each row execute function set_updated_at();

-- Enable RLS everywhere
alter table academic_years enable row level security;
alter table terms enable row level security;
alter table classes enable row level security;
alter table streams enable row level security;
alter table subjects enable row level security;
alter table class_subjects enable row level security;
alter table timetable_slots enable row level security;
