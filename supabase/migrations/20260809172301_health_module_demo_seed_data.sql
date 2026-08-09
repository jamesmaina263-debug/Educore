do $$
declare
  v_school_id uuid := '50f09948-2f38-4802-8b19-2efe073197bb';
  v_alex uuid := 'e8810bbb-b836-4855-906b-9eb11840f80b';
  v_ethan uuid := 'f6aa8ffe-d567-4ed3-a753-b337a8e3143e';
  v_nurse_su_id uuid;
  v_visit1 uuid;
  v_visit2 uuid;
  v_med_category_id uuid;
begin
  select id into v_nurse_su_id from public.school_users where email = 'nurse.demo@educore.app';
  select id into v_med_category_id from public.inventory_categories where school_id = v_school_id and name = 'Medical Supplies';

  -- Medical records (base data) if missing
  insert into public.medical_records (student_id, blood_group, conditions, allergies, emergency_contact_name, emergency_contact_phone, updated_by)
  select v_alex, 'O+', 'Mild asthma', 'Penicillin', 'Jane Mwangi', '+254712345001', v_nurse_su_id
  where not exists (select 1 from public.medical_records where student_id = v_alex);

  insert into public.medical_records (student_id, blood_group, conditions, allergies, emergency_contact_name, emergency_contact_phone, updated_by)
  select v_ethan, 'A+', null, 'Peanuts', 'David Maina', '+254712345002', v_nurse_su_id
  where not exists (select 1 from public.medical_records where student_id = v_ethan);

  -- Resolved sick bay visit (yesterday, headache)
  insert into public.sick_bay_visits (school_id, student_id, check_in_at, reason, symptoms, temperature_c, checked_in_by, check_out_at, check_out_by, outcome, notes)
  values (v_school_id, v_alex, now() - interval '1 day 3 hours', 'Headache', 'Mild headache, no fever', 36.8, v_nurse_su_id, now() - interval '1 day 2 hours 30 minutes', v_nurse_su_id, 'returned_to_class', 'Given water and rest, felt better after 30 min')
  returning id into v_visit1;

  -- Open sick bay visit (currently checked in, stomach ache)
  insert into public.sick_bay_visits (school_id, student_id, check_in_at, reason, symptoms, temperature_c, checked_in_by)
  values (v_school_id, v_ethan, now() - interval '25 minutes', 'Stomach ache', 'Complained of stomach pain after lunch', 37.1, v_nurse_su_id)
  returning id into v_visit2;

  -- Medication administration tied to the resolved visit
  insert into public.medication_administrations (school_id, student_id, sick_bay_visit_id, medication_name, dosage, route, administered_at, administered_by, inventory_item_id, notes)
  values (v_school_id, v_alex, v_visit1, 'Paracetamol', '250mg', 'oral', now() - interval '1 day 2 hours 45 minutes', v_nurse_su_id, null, 'For headache relief');

  -- Referral example
  insert into public.health_referrals (school_id, student_id, referred_to, reason, referral_date, status, guardian_notified, referred_by)
  values (v_school_id, v_alex, 'Nairobi West Hospital', 'Recurring asthma symptoms, needs specialist review', current_date - 3, 'completed', true, v_nurse_su_id);

  -- Emergency example (resolved, guardian notified)
  insert into public.health_emergencies (school_id, student_id, incident_at, description, severity, action_taken, hospital_name, guardian_notified, guardian_notified_at, reported_by)
  values (v_school_id, v_ethan, now() - interval '10 days', 'Fell during PE, suspected wrist fracture', 'severe', 'Immobilized wrist, called guardian, transported to hospital', 'Nairobi West Hospital', true, now() - interval '10 days' + interval '15 minutes', v_nurse_su_id);

  -- A couple of medical inventory items under Medical Supplies category
  insert into public.inventory_items (school_id, category_id, name, unit, quantity, reorder_level, location)
  select v_school_id, v_med_category_id, 'Paracetamol 250mg tablets', 'tablets', 200, 50, 'Sick Bay Cabinet'
  where not exists (select 1 from public.inventory_items where school_id = v_school_id and name = 'Paracetamol 250mg tablets');

  insert into public.inventory_items (school_id, category_id, name, unit, quantity, reorder_level, location)
  select v_school_id, v_med_category_id, 'ORS Sachets', 'sachets', 30, 20, 'Sick Bay Cabinet'
  where not exists (select 1 from public.inventory_items where school_id = v_school_id and name = 'ORS Sachets');

  insert into public.inventory_items (school_id, category_id, name, unit, quantity, reorder_level, location)
  select v_school_id, v_med_category_id, 'Bandages (roll)', 'pieces', 15, 10, 'Sick Bay Cabinet'
  where not exists (select 1 from public.inventory_items where school_id = v_school_id and name = 'Bandages (roll)');
end $$;
