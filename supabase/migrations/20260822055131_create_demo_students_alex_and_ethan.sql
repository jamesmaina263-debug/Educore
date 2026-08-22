-- Restores the two demo students (Alex, Ethan), both linked to the existing demo
-- parent account (Test Parent, Demo Academy) as primary-contact guardian, then walked
-- through the required status chain: applied -> approved -> enrolled -> active.

insert into students (id, school_id, admission_number, first_name, last_name, date_of_birth, gender, status)
values
  ('e8810bbb-b836-4855-906b-9eb11840f80b', '50f09948-2f38-4802-8b19-2efe073197bb', 'DEMO-ALEX-001', 'Alex', 'Demo', '2015-03-14', 'female', 'applied'),
  ('f6aa8ffe-d567-4ed3-a753-b337a8e3143e', '50f09948-2f38-4802-8b19-2efe073197bb', 'DEMO-ETHAN-001', 'Ethan', 'Demo', '2014-11-02', 'male', 'applied')
on conflict (id) do nothing;

insert into student_guardians (student_id, guardian_user_id, relationship, primary_contact)
select sid, su.id, 'guardian', true
from public.school_users su, (values
  ('e8810bbb-b836-4855-906b-9eb11840f80b'::uuid),
  ('f6aa8ffe-d567-4ed3-a753-b337a8e3143e'::uuid)
) as t(sid)
where su.email = 'parent.demo@educore.test'
and not exists (select 1 from student_guardians where student_id = t.sid);

update students set status = 'approved'
where id in ('e8810bbb-b836-4855-906b-9eb11840f80b','f6aa8ffe-d567-4ed3-a753-b337a8e3143e') and status = 'applied';

update students set status = 'enrolled'
where id in ('e8810bbb-b836-4855-906b-9eb11840f80b','f6aa8ffe-d567-4ed3-a753-b337a8e3143e') and status = 'approved';

update students set status = 'active'
where id in ('e8810bbb-b836-4855-906b-9eb11840f80b','f6aa8ffe-d567-4ed3-a753-b337a8e3143e') and status = 'enrolled';
