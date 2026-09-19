"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { tagSentryRequestContext } from "@/lib/observability/sentry-context";

type ActionResult = { error: string } | { success: true };

async function currentSchoolUser() {
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, schoolUser: null };
  const { data: schoolUser } = await supabase
    .from("school_users")
    .select("id, school_id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  return { supabase, schoolUser };
}

// ---------------------------------------------------------------------------
// Incidents (discipline_records)
// ---------------------------------------------------------------------------
export async function createIncidentAction(formData: FormData): Promise<ActionResult> {
  const { supabase, schoolUser } = await currentSchoolUser();
  if (!schoolUser) return { error: "Could not resolve your account." };

  const studentId = String(formData.get("student_id") ?? "");
  const category = String(formData.get("category") ?? "");
  const incidentType = String(formData.get("incident_type") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const actionTaken = String(formData.get("action_taken") ?? "").trim();
  const location = String(formData.get("location") ?? "").trim();
  const incidentDate = String(formData.get("incident_date") ?? "");
  const visibleToGuardian = formData.get("visible_to_guardian") === "on";
  const staffInvolvedRaw = String(formData.get("staff_involved") ?? "");
  const staffInvolved = staffInvolvedRaw.split(",").map((s) => s.trim()).filter(Boolean);
  // Idempotency: injected once per submit by runAction() in discipline-welfare-section.tsx,
  // same pattern as health's client_mutation_id -- a queued offline retry after a lost ack
  // is recognized here and short-circuited before it can create a duplicate incident (and
  // a duplicate set of discipline_incident_staff rows alongside it).
  const clientMutationId = String(formData.get("client_mutation_id") ?? "") || null;

  if (!studentId || !category || !description) {
    return { error: "Student, category, and description are required." };
  }

  if (clientMutationId) {
    const { data: existing } = await supabase
      .from("discipline_records")
      .select("id")
      .eq("school_id", schoolUser.school_id)
      .eq("client_mutation_id", clientMutationId)
      .maybeSingle();
    if (existing) {
      revalidatePath("/discipline", "layout");
      return { success: true };
    }
  }

  const { data: incident, error } = await supabase
    .from("discipline_records")
    .insert({
      school_id: schoolUser.school_id,
      student_id: studentId,
      category,
      incident_type: incidentType || null,
      description,
      action_taken: actionTaken || null,
      location: location || null,
      incident_date: incidentDate || undefined,
      visible_to_guardian: visibleToGuardian,
      recorded_by: schoolUser.id,
      reported_by: schoolUser.id,
      client_mutation_id: clientMutationId,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };

  if (staffInvolved.length > 0 && incident) {
    await supabase.from("discipline_incident_staff").insert(
      staffInvolved.map((staffId) => ({
        incident_id: incident.id,
        staff_id: staffId,
        school_id: schoolUser.school_id,
      })),
    );
  }

  revalidatePath("/discipline", "layout");
  return { success: true };
}

// ---------------------------------------------------------------------------
// Cases (discipline_cases) — officer tier only, enforced by RLS
// ---------------------------------------------------------------------------
export async function createCaseAction(formData: FormData): Promise<ActionResult> {
  const { supabase, schoolUser } = await currentSchoolUser();
  if (!schoolUser) return { error: "Could not resolve your account." };

  const studentId = String(formData.get("student_id") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const assignedOfficer = String(formData.get("assigned_officer") ?? "") || null;
  // Idempotency: same client_mutation_id pattern as createIncidentAction above.
  const clientMutationId = String(formData.get("client_mutation_id") ?? "") || null;

  if (!studentId || !title) return { error: "Student and a case title are required." };

  if (clientMutationId) {
    const { data: existing } = await supabase
      .from("discipline_cases")
      .select("id")
      .eq("school_id", schoolUser.school_id)
      .eq("client_mutation_id", clientMutationId)
      .maybeSingle();
    if (existing) {
      revalidatePath("/discipline", "layout");
      return { success: true };
    }
  }

  const { error } = await supabase.from("discipline_cases").insert({
    school_id: schoolUser.school_id,
    student_id: studentId,
    title,
    assigned_officer: assignedOfficer,
    opened_by: schoolUser.id,
    client_mutation_id: clientMutationId,
  });
  if (error) return { error: error.message };

  revalidatePath("/discipline", "layout");
  return { success: true };
}

export async function updateCaseAction(formData: FormData): Promise<ActionResult> {
  const { supabase, schoolUser } = await currentSchoolUser();
  if (!schoolUser) return { error: "Could not resolve your account." };

  const caseId = String(formData.get("case_id") ?? "");
  const status = String(formData.get("status") ?? "");
  const investigationNotes = String(formData.get("investigation_notes") ?? "").trim();
  const followUpNotes = String(formData.get("follow_up_notes") ?? "").trim();
  const resolution = String(formData.get("resolution") ?? "").trim();
  if (!caseId || !status) return { error: "Missing case or status." };

  const update: Record<string, unknown> = {
    status,
    investigation_notes: investigationNotes || null,
    follow_up_notes: followUpNotes || null,
    resolution: resolution || null,
    updated_at: new Date().toISOString(),
  };
  if (status === "resolved" || status === "closed") {
    update.closed_by = schoolUser.id;
    update.closed_at = new Date().toISOString();
  }

  // .select() required, not cosmetic: discipline_cases_update's own-assignment clause
  // (assigned_officer = self) can block this for a stale page or a reassigned case, and RLS
  // blocks an update by matching zero rows, not raising an error -- without this check the
  // caller would report success while the case stayed untouched. Every discipline.cases.manage
  // holder also holds discipline.read_any (verified against live role_permissions), which
  // discipline_cases_select requires, so this doesn't false-negative a legitimate update.
  const { data: updated, error } = await supabase.from("discipline_cases").update(update).eq("id", caseId).select("id");
  if (error) return { error: error.message };
  if (!updated || updated.length === 0) {
    return { error: "You don't have permission to update this case." };
  }

  revalidatePath("/discipline", "layout");
  return { success: true };
}

// ---------------------------------------------------------------------------
// Disciplinary Actions
// ---------------------------------------------------------------------------
export async function addDisciplinaryActionAction(formData: FormData): Promise<ActionResult> {
  const { supabase, schoolUser } = await currentSchoolUser();
  if (!schoolUser) return { error: "Could not resolve your account." };

  const studentId = String(formData.get("student_id") ?? "");
  const actionTypeId = String(formData.get("action_type_id") ?? "");
  const caseId = String(formData.get("case_id") ?? "") || null;
  const description = String(formData.get("description") ?? "").trim();
  const startDate = String(formData.get("start_date") ?? "") || null;
  const endDate = String(formData.get("end_date") ?? "") || null;
  // Idempotency: same client_mutation_id pattern as createIncidentAction above.
  const clientMutationId = String(formData.get("client_mutation_id") ?? "") || null;

  if (!studentId || !actionTypeId) return { error: "Student and action type are required." };

  if (clientMutationId) {
    const { data: existing } = await supabase
      .from("disciplinary_actions")
      .select("id")
      .eq("school_id", schoolUser.school_id)
      .eq("client_mutation_id", clientMutationId)
      .maybeSingle();
    if (existing) {
      revalidatePath("/discipline", "layout");
      return { success: true };
    }
  }

  const { error } = await supabase.from("disciplinary_actions").insert({
    school_id: schoolUser.school_id,
    student_id: studentId,
    case_id: caseId,
    action_type_id: actionTypeId,
    description: description || null,
    start_date: startDate,
    end_date: endDate,
    issued_by: schoolUser.id,
    client_mutation_id: clientMutationId,
  });
  if (error) return { error: error.message };

  revalidatePath("/discipline", "layout");
  return { success: true };
}

// ---------------------------------------------------------------------------
// Welfare concerns
// ---------------------------------------------------------------------------
export async function createWelfareConcernAction(formData: FormData): Promise<ActionResult> {
  const { supabase, schoolUser } = await currentSchoolUser();
  if (!schoolUser) return { error: "Could not resolve your account." };

  const studentId = String(formData.get("student_id") ?? "");
  const concernType = String(formData.get("concern_type") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const counsellingReferral = formData.get("counselling_referral") === "on";
  const referredTo = String(formData.get("referred_to") ?? "").trim();
  // Idempotency: same client_mutation_id pattern as createIncidentAction above.
  const clientMutationId = String(formData.get("client_mutation_id") ?? "") || null;

  if (!studentId || !concernType || !description) {
    return { error: "Student, concern type, and description are required." };
  }

  if (clientMutationId) {
    const { data: existing } = await supabase
      .from("welfare_concerns")
      .select("id")
      .eq("school_id", schoolUser.school_id)
      .eq("client_mutation_id", clientMutationId)
      .maybeSingle();
    if (existing) {
      revalidatePath("/discipline", "layout");
      return { success: true };
    }
  }

  const { error } = await supabase.from("welfare_concerns").insert({
    school_id: schoolUser.school_id,
    student_id: studentId,
    concern_type: concernType,
    description,
    counselling_referral: counsellingReferral,
    referred_to: referredTo || null,
    raised_by: schoolUser.id,
    client_mutation_id: clientMutationId,
  });
  if (error) return { error: error.message };

  revalidatePath("/discipline", "layout");
  return { success: true };
}

export async function updateWelfareConcernAction(formData: FormData): Promise<ActionResult> {
  const { supabase, schoolUser } = await currentSchoolUser();
  if (!schoolUser) return { error: "Could not resolve your account." };

  const concernId = String(formData.get("concern_id") ?? "");
  const status = String(formData.get("status") ?? "");
  const followUpNotes = String(formData.get("follow_up_notes") ?? "").trim();
  if (!concernId || !status) return { error: "Missing concern or status." };

  const update: Record<string, unknown> = {
    status,
    follow_up_notes: followUpNotes || null,
    updated_at: new Date().toISOString(),
  };
  if (status === "resolved") {
    update.resolved_at = new Date().toISOString();
    update.resolved_by = schoolUser.id;
  }

  // .select() required, not cosmetic: welfare_concerns_update's own-record clause
  // (raised_by = self) can block this for a stale page, and RLS blocks an update by matching
  // zero rows, not raising an error. welfare_concerns_select requires the same condition
  // (welfare.read_any or raised_by = self) as this update's USING clause, so this doesn't
  // false-negative a legitimate update.
  const { data: updated, error } = await supabase.from("welfare_concerns").update(update).eq("id", concernId).select("id");
  if (error) return { error: error.message };
  if (!updated || updated.length === 0) {
    return { error: "You don't have permission to update this concern." };
  }

  revalidatePath("/discipline", "layout");
  return { success: true };
}

// ---------------------------------------------------------------------------
// Safeguarding. Update actions below explicitly check the row came back (see comment on
// updateSafeguardingReportAction) rather than assuming RLS produces a thrown error on
// denial -- it doesn't, for a USING-clause block; it silently matches zero rows.
// ---------------------------------------------------------------------------
export async function createSafeguardingReportAction(formData: FormData): Promise<ActionResult> {
  const { supabase, schoolUser } = await currentSchoolUser();
  if (!schoolUser) return { error: "Could not resolve your account." };

  const studentId = String(formData.get("student_id") ?? "");
  const reportType = String(formData.get("report_type") ?? "");
  const description = String(formData.get("description") ?? "").trim();
  // Idempotency: same client_mutation_id pattern as createIncidentAction above.
  const clientMutationId = String(formData.get("client_mutation_id") ?? "") || null;

  if (!studentId || !reportType || !description) {
    return { error: "Student, report type, and description are required." };
  }

  if (clientMutationId) {
    const { data: existing } = await supabase
      .from("safeguarding_reports")
      .select("id")
      .eq("school_id", schoolUser.school_id)
      .eq("client_mutation_id", clientMutationId)
      .maybeSingle();
    if (existing) {
      revalidatePath("/discipline", "layout");
      return { success: true };
    }
  }

  const { error } = await supabase.from("safeguarding_reports").insert({
    school_id: schoolUser.school_id,
    student_id: studentId,
    report_type: reportType,
    description,
    reported_by: schoolUser.id,
    client_mutation_id: clientMutationId,
  });
  if (error) return { error: error.message };

  revalidatePath("/discipline", "layout");
  return { success: true };
}

export async function updateSafeguardingReportAction(formData: FormData): Promise<ActionResult> {
  const { supabase, schoolUser } = await currentSchoolUser();
  if (!schoolUser) return { error: "Could not resolve your account." };

  const reportId = String(formData.get("report_id") ?? "");
  const status = String(formData.get("status") ?? "");
  const escalatedTo = String(formData.get("escalated_to") ?? "") || null;
  const followUpNotes = String(formData.get("follow_up_notes") ?? "").trim();
  if (!reportId || !status) return { error: "Missing report or status." };

  const update: Record<string, unknown> = {
    status,
    follow_up_notes: followUpNotes || null,
    updated_at: new Date().toISOString(),
  };
  if (status === "escalated") {
    update.escalated_to = escalatedTo;
    update.escalated_at = new Date().toISOString();
  }
  if (status === "resolved" || status === "closed") {
    update.resolved_at = new Date().toISOString();
    update.resolved_by = schoolUser.id;
  }

  // .select() required, not cosmetic: safeguarding_reports_update's USING clause requires
  // safeguarding.read, which -- unlike some of this file's other RLS-blocked-update checks --
  // isn't hypothetical here: safeguarding_reports_select requires the exact same permission,
  // so this doesn't false-negative a legitimate update, and verified every safeguarding.read
  // holder also holds safeguarding.write (the WITH CHECK requirement) against live
  // role_permissions.
  const { data: updated, error } = await supabase.from("safeguarding_reports").update(update).eq("id", reportId).select("id");
  if (error) return { error: error.message };
  if (!updated || updated.length === 0) {
    return { error: "You don't have permission to update this report." };
  }

  revalidatePath("/discipline", "layout");
  return { success: true };
}
