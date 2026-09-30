-- Remove the synthetic "QA Test Account (Little Beginners)" staff login.
-- School: Little Beginners School (bc0e14ef-25ed-492d-8999-8d9718c3c2d1)
-- school_users.id = 55566628-cd0e-4316-82de-f8f6cf342abb
-- auth_user_id      = dae10e74-75e7-4e87-8b43-4f7bdb305b96
-- No dummy student/guardian records exist for this school as of this check.

delete from public.school_users
where id = '55566628-cd0e-4316-82de-f8f6cf342abb';

delete from auth.identities
where user_id = 'dae10e74-75e7-4e87-8b43-4f7bdb305b96';

delete from auth.users
where id = 'dae10e74-75e7-4e87-8b43-4f7bdb305b96';
