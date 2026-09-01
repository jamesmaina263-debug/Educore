-- ============================================================================
-- Announcements -- PA-05: boarding-house targeting
--
-- Adds `boarding_house` as a fifth scope. A student's house is resolved at
-- publish time via their active hostel_allocations row -> hostel_rooms,
-- which attaches to a house either directly (hostel_rooms.house_id) or
-- through a dormitory (hostel_rooms.dormitory_id -> dormitories.house_id),
-- per the flexible hierarchy from phase27_flexible_boarding_hierarchy. A
-- room with neither set (standalone room, no house concept) simply can't
-- be reached by boarding_house scope -- that's a real limitation of a
-- school not using the House concept, not a bug in this feature.
--
-- Constraint names (announcements_scope_check, announcements_check2)
-- confirmed against the live schema before writing this migration.
-- ============================================================================

alter table announcements add column target_house_id uuid references boarding_houses(id);

create index idx_announcements_target_house_id on announcements(target_house_id) where target_house_id is not null;

alter table announcements drop constraint announcements_scope_check;
alter table announcements add constraint announcements_scope_check
  check (scope in ('whole_school', 'grade', 'class', 'student', 'boarding_house'));

alter table announcements drop constraint announcements_check2;
alter table announcements add constraint announcements_check2
  check (
    (scope = 'whole_school' and target_class_id is null and target_stream_id is null and target_student_id is null and target_house_id is null)
    or (scope = 'grade' and target_class_id is not null and target_stream_id is null and target_student_id is null and target_house_id is null)
    or (scope = 'class' and target_class_id is null and target_stream_id is not null and target_student_id is null and target_house_id is null)
    or (scope = 'student' and target_class_id is null and target_stream_id is null and target_student_id is not null and target_house_id is null)
    or (scope = 'boarding_house' and target_class_id is null and target_stream_id is null and target_student_id is null and target_house_id is not null)
  );
