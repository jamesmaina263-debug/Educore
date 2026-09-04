-- Performance advisor: multiple_permissive_policies. For 31 tables, a
-- "_write" policy with FOR ALL doubled up with the dedicated "_select"
-- policy on every SELECT (two permissive policies OR'd together = wasted
-- evaluation per row). Verified via role_permissions that every role
-- holding the write-side permission also holds the corresponding read-side
-- permission (or the select policy has no permission gate at all), so
-- splitting the ALL policy into INSERT/UPDATE/DELETE-only policies removes
-- the redundant SELECT evaluation without changing what any role can see.
-- Generated directly from pg_policies.qual/with_check (not hand-transcribed)
-- to eliminate transcription risk on security-relevant expressions.

drop policy academic_years_write on public.academic_years;
create policy academic_years_insert on public.academic_years for insert with check ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('academics.write'::text))));
create policy academic_years_update on public.academic_years for update using ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('academics.write'::text)))) with check ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('academics.write'::text))));
create policy academic_years_delete on public.academic_years for delete using ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('academics.write'::text))));

drop policy application_document_requirements_write on public.application_document_requirements;
create policy application_document_requirements_insert on public.application_document_requirements for insert with check ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('admissions.write'::text))));
create policy application_document_requirements_update on public.application_document_requirements for update using ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('admissions.write'::text)))) with check ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('admissions.write'::text))));
create policy application_document_requirements_delete on public.application_document_requirements for delete using ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('admissions.write'::text))));

drop policy assessment_components_write on public.assessment_components;
create policy assessment_components_insert on public.assessment_components for insert with check ((EXISTS ( SELECT 1
   FROM assessment_schemes s
  WHERE ((s.id = assessment_components.scheme_id) AND (s.school_id = auth_school_id()) AND auth_has_permission('exams.write'::text)))));
create policy assessment_components_update on public.assessment_components for update using ((EXISTS ( SELECT 1
   FROM assessment_schemes s
  WHERE ((s.id = assessment_components.scheme_id) AND (s.school_id = auth_school_id()) AND auth_has_permission('exams.write'::text))))) with check ((EXISTS ( SELECT 1
   FROM assessment_schemes s
  WHERE ((s.id = assessment_components.scheme_id) AND (s.school_id = auth_school_id()) AND auth_has_permission('exams.write'::text)))));
create policy assessment_components_delete on public.assessment_components for delete using ((EXISTS ( SELECT 1
   FROM assessment_schemes s
  WHERE ((s.id = assessment_components.scheme_id) AND (s.school_id = auth_school_id()) AND auth_has_permission('exams.write'::text)))));

drop policy assessment_schemes_write on public.assessment_schemes;
create policy assessment_schemes_insert on public.assessment_schemes for insert with check (((school_id = auth_school_id()) AND auth_has_permission('exams.write'::text)));
create policy assessment_schemes_update on public.assessment_schemes for update using (((school_id = auth_school_id()) AND auth_has_permission('exams.write'::text))) with check (((school_id = auth_school_id()) AND auth_has_permission('exams.write'::text)));
create policy assessment_schemes_delete on public.assessment_schemes for delete using (((school_id = auth_school_id()) AND auth_has_permission('exams.write'::text)));

drop policy asset_maintenance_write on public.asset_maintenance_records;
create policy asset_maintenance_records_insert on public.asset_maintenance_records for insert with check ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('inventory.write'::text))));
create policy asset_maintenance_records_update on public.asset_maintenance_records for update using ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('inventory.write'::text)))) with check ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('inventory.write'::text))));
create policy asset_maintenance_records_delete on public.asset_maintenance_records for delete using ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('inventory.write'::text))));

drop policy assets_write on public.assets;
create policy assets_insert on public.assets for insert with check ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('inventory.write'::text))));
create policy assets_update on public.assets for update using ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('inventory.write'::text)))) with check ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('inventory.write'::text))));
create policy assets_delete on public.assets for delete using ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('inventory.write'::text))));

drop policy beds_write on public.beds;
create policy beds_insert on public.beds for insert with check ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('hostel.write'::text)) OR ((school_id = auth_school_id()) AND auth_has_permission('hostel.write_assigned'::text) AND (EXISTS ( SELECT 1
   FROM (hostel_rooms hr
     JOIN dormitories d ON ((d.id = hr.dormitory_id)))
  WHERE ((hr.id = beds.room_id) AND ((auth_school_user_id() = d.master_id) OR (auth_school_user_id() = d.assistant_id))))))));
create policy beds_update on public.beds for update using ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('hostel.write'::text)) OR ((school_id = auth_school_id()) AND auth_has_permission('hostel.write_assigned'::text) AND (EXISTS ( SELECT 1
   FROM (hostel_rooms hr
     JOIN dormitories d ON ((d.id = hr.dormitory_id)))
  WHERE ((hr.id = beds.room_id) AND ((auth_school_user_id() = d.master_id) OR (auth_school_user_id() = d.assistant_id)))))))) with check ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('hostel.write'::text)) OR ((school_id = auth_school_id()) AND auth_has_permission('hostel.write_assigned'::text) AND (EXISTS ( SELECT 1
   FROM (hostel_rooms hr
     JOIN dormitories d ON ((d.id = hr.dormitory_id)))
  WHERE ((hr.id = beds.room_id) AND ((auth_school_user_id() = d.master_id) OR (auth_school_user_id() = d.assistant_id))))))));
create policy beds_delete on public.beds for delete using ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('hostel.write'::text)) OR ((school_id = auth_school_id()) AND auth_has_permission('hostel.write_assigned'::text) AND (EXISTS ( SELECT 1
   FROM (hostel_rooms hr
     JOIN dormitories d ON ((d.id = hr.dormitory_id)))
  WHERE ((hr.id = beds.room_id) AND ((auth_school_user_id() = d.master_id) OR (auth_school_user_id() = d.assistant_id))))))));

drop policy boarding_houses_write on public.boarding_houses;
create policy boarding_houses_insert on public.boarding_houses for insert with check ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('hostel.write'::text))));
create policy boarding_houses_update on public.boarding_houses for update using ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('hostel.write'::text)))) with check ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('hostel.write'::text))));
create policy boarding_houses_delete on public.boarding_houses for delete using ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('hostel.write'::text))));

drop policy boarding_incidents_write on public.boarding_incidents;
create policy boarding_incidents_insert on public.boarding_incidents for insert with check ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('hostel.write'::text))));
create policy boarding_incidents_update on public.boarding_incidents for update using ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('hostel.write'::text)))) with check ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('hostel.write'::text))));
create policy boarding_incidents_delete on public.boarding_incidents for delete using ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('hostel.write'::text))));

drop policy boarding_transfers_write on public.boarding_transfers;
create policy boarding_transfers_insert on public.boarding_transfers for insert with check ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('hostel.write'::text)) OR ((school_id = auth_school_id()) AND auth_has_permission('hostel.write_assigned'::text) AND (EXISTS ( SELECT 1
   FROM ((beds b
     JOIN hostel_rooms hr ON ((hr.id = b.room_id)))
     JOIN dormitories d ON ((d.id = hr.dormitory_id)))
  WHERE ((b.id = boarding_transfers.to_bed_id) AND ((auth_school_user_id() = d.master_id) OR (auth_school_user_id() = d.assistant_id))))))));
create policy boarding_transfers_update on public.boarding_transfers for update using ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('hostel.write'::text)) OR ((school_id = auth_school_id()) AND auth_has_permission('hostel.write_assigned'::text) AND (EXISTS ( SELECT 1
   FROM ((beds b
     JOIN hostel_rooms hr ON ((hr.id = b.room_id)))
     JOIN dormitories d ON ((d.id = hr.dormitory_id)))
  WHERE ((b.id = boarding_transfers.to_bed_id) AND ((auth_school_user_id() = d.master_id) OR (auth_school_user_id() = d.assistant_id)))))))) with check ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('hostel.write'::text)) OR ((school_id = auth_school_id()) AND auth_has_permission('hostel.write_assigned'::text) AND (EXISTS ( SELECT 1
   FROM ((beds b
     JOIN hostel_rooms hr ON ((hr.id = b.room_id)))
     JOIN dormitories d ON ((d.id = hr.dormitory_id)))
  WHERE ((b.id = boarding_transfers.to_bed_id) AND ((auth_school_user_id() = d.master_id) OR (auth_school_user_id() = d.assistant_id))))))));
create policy boarding_transfers_delete on public.boarding_transfers for delete using ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('hostel.write'::text)) OR ((school_id = auth_school_id()) AND auth_has_permission('hostel.write_assigned'::text) AND (EXISTS ( SELECT 1
   FROM ((beds b
     JOIN hostel_rooms hr ON ((hr.id = b.room_id)))
     JOIN dormitories d ON ((d.id = hr.dormitory_id)))
  WHERE ((b.id = boarding_transfers.to_bed_id) AND ((auth_school_user_id() = d.master_id) OR (auth_school_user_id() = d.assistant_id))))))));

drop policy class_subjects_write on public.class_subjects;
create policy class_subjects_insert on public.class_subjects for insert with check ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('academics.write'::text))));
create policy class_subjects_update on public.class_subjects for update using ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('academics.write'::text)))) with check ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('academics.write'::text))));
create policy class_subjects_delete on public.class_subjects for delete using ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('academics.write'::text))));

drop policy curriculum_strands_write on public.curriculum_strands;
create policy curriculum_strands_insert on public.curriculum_strands for insert with check ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('academics.write'::text))));
create policy curriculum_strands_update on public.curriculum_strands for update using ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('academics.write'::text)))) with check ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('academics.write'::text))));
create policy curriculum_strands_delete on public.curriculum_strands for delete using ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('academics.write'::text))));

drop policy curriculum_sub_strands_write on public.curriculum_sub_strands;
create policy curriculum_sub_strands_insert on public.curriculum_sub_strands for insert with check ((EXISTS ( SELECT 1
   FROM curriculum_strands cs
  WHERE ((cs.id = curriculum_sub_strands.strand_id) AND (auth_is_super_admin() OR ((cs.school_id = auth_school_id()) AND auth_has_permission('academics.write'::text)))))));
create policy curriculum_sub_strands_update on public.curriculum_sub_strands for update using ((EXISTS ( SELECT 1
   FROM curriculum_strands cs
  WHERE ((cs.id = curriculum_sub_strands.strand_id) AND (auth_is_super_admin() OR ((cs.school_id = auth_school_id()) AND auth_has_permission('academics.write'::text))))))) with check ((EXISTS ( SELECT 1
   FROM curriculum_strands cs
  WHERE ((cs.id = curriculum_sub_strands.strand_id) AND (auth_is_super_admin() OR ((cs.school_id = auth_school_id()) AND auth_has_permission('academics.write'::text)))))));
create policy curriculum_sub_strands_delete on public.curriculum_sub_strands for delete using ((EXISTS ( SELECT 1
   FROM curriculum_strands cs
  WHERE ((cs.id = curriculum_sub_strands.strand_id) AND (auth_is_super_admin() OR ((cs.school_id = auth_school_id()) AND auth_has_permission('academics.write'::text)))))));

drop policy disciplinary_action_types_write on public.disciplinary_action_types;
create policy disciplinary_action_types_insert on public.disciplinary_action_types for insert with check ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('discipline.cases.manage'::text))));
create policy disciplinary_action_types_update on public.disciplinary_action_types for update using ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('discipline.cases.manage'::text)))) with check ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('discipline.cases.manage'::text))));
create policy disciplinary_action_types_delete on public.disciplinary_action_types for delete using ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('discipline.cases.manage'::text))));

drop policy dormitories_write on public.dormitories;
create policy dormitories_insert on public.dormitories for insert with check ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('hostel.write'::text)) OR ((school_id = auth_school_id()) AND auth_has_permission('hostel.write_assigned'::text) AND ((auth_school_user_id() = master_id) OR (auth_school_user_id() = assistant_id)))));
create policy dormitories_update on public.dormitories for update using ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('hostel.write'::text)) OR ((school_id = auth_school_id()) AND auth_has_permission('hostel.write_assigned'::text) AND ((auth_school_user_id() = master_id) OR (auth_school_user_id() = assistant_id))))) with check ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('hostel.write'::text)) OR ((school_id = auth_school_id()) AND auth_has_permission('hostel.write_assigned'::text) AND ((auth_school_user_id() = master_id) OR (auth_school_user_id() = assistant_id)))));
create policy dormitories_delete on public.dormitories for delete using ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('hostel.write'::text)) OR ((school_id = auth_school_id()) AND auth_has_permission('hostel.write_assigned'::text) AND ((auth_school_user_id() = master_id) OR (auth_school_user_id() = assistant_id)))));

drop policy exam_schedules_write on public.exam_schedules;
create policy exam_schedules_insert on public.exam_schedules for insert with check ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('exams.write'::text))));
create policy exam_schedules_update on public.exam_schedules for update using ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('exams.write'::text)))) with check ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('exams.write'::text))));
create policy exam_schedules_delete on public.exam_schedules for delete using ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('exams.write'::text))));

drop policy leave_types_write on public.leave_types;
create policy leave_types_insert on public.leave_types for insert with check ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('staff.manage'::text))));
create policy leave_types_update on public.leave_types for update using ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('staff.manage'::text)))) with check ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('staff.manage'::text))));
create policy leave_types_delete on public.leave_types for delete using ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('staff.manage'::text))));

drop policy library_fines_write on public.library_fines;
create policy library_fines_insert on public.library_fines for insert with check ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('library.write'::text))));
create policy library_fines_update on public.library_fines for update using ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('library.write'::text)))) with check ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('library.write'::text))));
create policy library_fines_delete on public.library_fines for delete using ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('library.write'::text))));

drop policy library_reservations_write on public.library_reservations;
create policy library_reservations_insert on public.library_reservations for insert with check ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('library.write'::text))));
create policy library_reservations_update on public.library_reservations for update using ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('library.write'::text)))) with check ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('library.write'::text))));
create policy library_reservations_delete on public.library_reservations for delete using ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('library.write'::text))));

drop policy library_shelves_write on public.library_shelves;
create policy library_shelves_insert on public.library_shelves for insert with check ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('library.write'::text))));
create policy library_shelves_update on public.library_shelves for update using ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('library.write'::text)))) with check ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('library.write'::text))));
create policy library_shelves_delete on public.library_shelves for delete using ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('library.write'::text))));

drop policy medical_records_write on public.medical_records;
create policy medical_records_insert on public.medical_records for insert with check ((auth_is_super_admin() OR (EXISTS ( SELECT 1
   FROM students s
  WHERE ((s.id = medical_records.student_id) AND (s.school_id = auth_school_id()) AND auth_has_permission('students.medical.write'::text))))));
create policy medical_records_update on public.medical_records for update using ((auth_is_super_admin() OR (EXISTS ( SELECT 1
   FROM students s
  WHERE ((s.id = medical_records.student_id) AND (s.school_id = auth_school_id()) AND auth_has_permission('students.medical.write'::text)))))) with check ((auth_is_super_admin() OR (EXISTS ( SELECT 1
   FROM students s
  WHERE ((s.id = medical_records.student_id) AND (s.school_id = auth_school_id()) AND auth_has_permission('students.medical.write'::text))))));
create policy medical_records_delete on public.medical_records for delete using ((auth_is_super_admin() OR (EXISTS ( SELECT 1
   FROM students s
  WHERE ((s.id = medical_records.student_id) AND (s.school_id = auth_school_id()) AND auth_has_permission('students.medical.write'::text))))));

drop policy purchase_order_items_write on public.purchase_order_items;
create policy purchase_order_items_insert on public.purchase_order_items for insert with check ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('inventory.procurement.approve'::text))));
create policy purchase_order_items_update on public.purchase_order_items for update using ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('inventory.procurement.approve'::text)))) with check ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('inventory.procurement.approve'::text))));
create policy purchase_order_items_delete on public.purchase_order_items for delete using ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('inventory.procurement.approve'::text))));

drop policy purchase_requisition_items_write on public.purchase_requisition_items;
create policy purchase_requisition_items_insert on public.purchase_requisition_items for insert with check ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND (auth_has_permission('inventory.write'::text) OR (auth_has_permission('health.procurement.request'::text) AND (EXISTS ( SELECT 1
   FROM purchase_requisitions r
  WHERE ((r.id = purchase_requisition_items.requisition_id) AND (r.requested_by = auth_school_user_id())))))))));
create policy purchase_requisition_items_update on public.purchase_requisition_items for update using ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND (auth_has_permission('inventory.write'::text) OR (auth_has_permission('health.procurement.request'::text) AND (EXISTS ( SELECT 1
   FROM purchase_requisitions r
  WHERE ((r.id = purchase_requisition_items.requisition_id) AND (r.requested_by = auth_school_user_id()))))))))) with check ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND (auth_has_permission('inventory.write'::text) OR (auth_has_permission('health.procurement.request'::text) AND (EXISTS ( SELECT 1
   FROM purchase_requisitions r
  WHERE ((r.id = purchase_requisition_items.requisition_id) AND (r.requested_by = auth_school_user_id())))))))));
create policy purchase_requisition_items_delete on public.purchase_requisition_items for delete using ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND (auth_has_permission('inventory.write'::text) OR (auth_has_permission('health.procurement.request'::text) AND (EXISTS ( SELECT 1
   FROM purchase_requisitions r
  WHERE ((r.id = purchase_requisition_items.requisition_id) AND (r.requested_by = auth_school_user_id())))))))));

drop policy salary_structure_allowances_write on public.salary_structure_allowances;
create policy salary_structure_allowances_insert on public.salary_structure_allowances for insert with check ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('payroll.write'::text))));
create policy salary_structure_allowances_update on public.salary_structure_allowances for update using ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('payroll.write'::text)))) with check ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('payroll.write'::text))));
create policy salary_structure_allowances_delete on public.salary_structure_allowances for delete using ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('payroll.write'::text))));

drop policy salary_structure_deductions_write on public.salary_structure_deductions;
create policy salary_structure_deductions_insert on public.salary_structure_deductions for insert with check ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('payroll.write'::text))));
create policy salary_structure_deductions_update on public.salary_structure_deductions for update using ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('payroll.write'::text)))) with check ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('payroll.write'::text))));
create policy salary_structure_deductions_delete on public.salary_structure_deductions for delete using ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('payroll.write'::text))));

drop policy student_guardians_write on public.student_guardians;
create policy student_guardians_insert on public.student_guardians for insert with check ((auth_is_super_admin() OR (EXISTS ( SELECT 1
   FROM students s
  WHERE ((s.id = student_guardians.student_id) AND (s.school_id = auth_school_id()) AND auth_has_permission('students.write'::text))))));
create policy student_guardians_update on public.student_guardians for update using ((auth_is_super_admin() OR (EXISTS ( SELECT 1
   FROM students s
  WHERE ((s.id = student_guardians.student_id) AND (s.school_id = auth_school_id()) AND auth_has_permission('students.write'::text)))))) with check ((auth_is_super_admin() OR (EXISTS ( SELECT 1
   FROM students s
  WHERE ((s.id = student_guardians.student_id) AND (s.school_id = auth_school_id()) AND auth_has_permission('students.write'::text))))));
create policy student_guardians_delete on public.student_guardians for delete using ((auth_is_super_admin() OR (EXISTS ( SELECT 1
   FROM students s
  WHERE ((s.id = student_guardians.student_id) AND (s.school_id = auth_school_id()) AND auth_has_permission('students.write'::text))))));

drop policy supplier_invoices_write on public.supplier_invoices;
create policy supplier_invoices_insert on public.supplier_invoices for insert with check ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND (auth_has_permission('inventory.procurement.approve'::text) OR auth_has_permission('finance.write'::text)))));
create policy supplier_invoices_update on public.supplier_invoices for update using ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND (auth_has_permission('inventory.procurement.approve'::text) OR auth_has_permission('finance.write'::text))))) with check ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND (auth_has_permission('inventory.procurement.approve'::text) OR auth_has_permission('finance.write'::text)))));
create policy supplier_invoices_delete on public.supplier_invoices for delete using ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND (auth_has_permission('inventory.procurement.approve'::text) OR auth_has_permission('finance.write'::text)))));

drop policy suppliers_write on public.suppliers;
create policy suppliers_insert on public.suppliers for insert with check ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('inventory.write'::text))));
create policy suppliers_update on public.suppliers for update using ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('inventory.write'::text)))) with check ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('inventory.write'::text))));
create policy suppliers_delete on public.suppliers for delete using ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('inventory.write'::text))));

drop policy terms_write on public.terms;
create policy terms_insert on public.terms for insert with check ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('academics.write'::text))));
create policy terms_update on public.terms for update using ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('academics.write'::text)))) with check ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('academics.write'::text))));
create policy terms_delete on public.terms for delete using ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('academics.write'::text))));

drop policy timetable_periods_write on public.timetable_periods;
create policy timetable_periods_insert on public.timetable_periods for insert with check ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('academics.write'::text))));
create policy timetable_periods_update on public.timetable_periods for update using ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('academics.write'::text)))) with check ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('academics.write'::text))));
create policy timetable_periods_delete on public.timetable_periods for delete using ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('academics.write'::text))));

drop policy user_permission_overrides_write on public.user_permission_overrides;
create policy user_permission_overrides_insert on public.user_permission_overrides for insert with check ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('settings.roles.manage'::text) AND ((allowed = false) OR auth_has_permission(permission_key)))));
create policy user_permission_overrides_update on public.user_permission_overrides for update using ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('settings.roles.manage'::text)))) with check ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('settings.roles.manage'::text) AND ((allowed = false) OR auth_has_permission(permission_key)))));
create policy user_permission_overrides_delete on public.user_permission_overrides for delete using ((auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('settings.roles.manage'::text))));
