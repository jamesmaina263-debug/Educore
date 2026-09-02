"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type ActionResult = { error: string } | { success: true };

export async function createLibraryItemAction(input: {
  title: string;
  author?: string;
  isbn?: string;
  category?: string;
  total_copies: number;
}): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: schoolUser } = await supabase.from("school_users").select("school_id").eq("auth_user_id", user?.id ?? "").maybeSingle();
  if (!schoolUser) return { error: "No school context found" };

  const { error } = await supabase.from("library_items").insert({
    school_id: schoolUser.school_id,
    title: input.title,
    author: input.author || null,
    isbn: input.isbn || null,
    category: input.category || null,
    total_copies: input.total_copies,
    available_copies: input.total_copies,
  });
  if (error) return { error: error.message };
  revalidatePath("/library", "layout");
  return { success: true };
}

export async function issueLoanAction(input: {
  library_item_id: string;
  student_id: string;
  due_date: string;
  // OS-08: generated once by the caller at queue time (see library-section.tsx) so an
  // offline-queue retry after a lost ack reuses the same key -- issue_library_loan()
  // recognizes it and returns the already-issued loan instead of issuing a second one.
  client_mutation_id?: string;
}): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("issue_library_loan", {
    p_item_id: input.library_item_id,
    p_student_id: input.student_id,
    p_due_date: input.due_date,
    p_client_mutation_id: input.client_mutation_id || null,
  });
  if (error) return { error: error.message };
  revalidatePath("/library", "layout");
  return { success: true };
}

export async function returnLoanAction(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("return_library_loan", { p_loan_id: id });
  if (error) return { error: error.message };
  revalidatePath("/library", "layout");
  return { success: true };
}

async function currentSchoolUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, schoolUser: null };
  const { data: schoolUser } = await supabase.from("school_users").select("id, school_id").eq("auth_user_id", user.id).maybeSingle();
  return { supabase, schoolUser };
}

export async function issueLoanToStaffAction(input: {
  library_item_id: string;
  staff_id: string;
  due_date: string;
  client_mutation_id?: string;
}): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("issue_library_loan_to_staff", {
    p_item_id: input.library_item_id,
    p_staff_id: input.staff_id,
    p_due_date: input.due_date,
    p_client_mutation_id: input.client_mutation_id || null,
  });
  if (error) return { error: error.message };
  revalidatePath("/library", "layout");
  return { success: true };
}

export async function markLoanLostOrDamagedAction(input: { loan_id: string; item_id: string; status: "lost" | "damaged" }): Promise<ActionResult> {
  const { supabase } = await currentSchoolUser();
  const { error } = await supabase
    .from("library_loans")
    .update({ status: input.status })
    .eq("id", input.loan_id)
    .eq("status", "borrowed");
  if (error) return { error: error.message };

  // A lost book permanently leaves the collection; a damaged one stays
  // counted (it can be repaired later via "Adjust Copies") but the copy
  // that's out is not returned to availability by this action.
  if (input.status === "lost") {
    const { error: adjustError } = await supabase.rpc("adjust_library_item_copies", {
      p_item_id: input.item_id,
      p_total_delta: -1,
      p_available_delta: 0,
    });
    if (adjustError) return { error: adjustError.message };
  }

  revalidatePath("/library", "layout");
  return { success: true };
}

export async function adjustCopiesAction(input: { item_id: string; total_delta: number; available_delta: number }): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("adjust_library_item_copies", {
    p_item_id: input.item_id,
    p_total_delta: input.total_delta,
    p_available_delta: input.available_delta,
  });
  if (error) return { error: error.message };
  revalidatePath("/library", "layout");
  return { success: true };
}

export async function createShelfAction(formData: FormData): Promise<ActionResult> {
  const { supabase, schoolUser } = await currentSchoolUser();
  if (!schoolUser) return { error: "Could not resolve your account." };
  const name = String(formData.get("name") ?? "").trim();
  const location = String(formData.get("location") ?? "").trim();
  if (!name) return { error: "Shelf name is required." };
  const { error } = await supabase.from("library_shelves").insert({ school_id: schoolUser.school_id, name, location: location || null });
  if (error) return { error: error.message };
  revalidatePath("/library", "layout");
  return { success: true };
}

export async function createReservationAction(formData: FormData): Promise<ActionResult> {
  const { supabase, schoolUser } = await currentSchoolUser();
  if (!schoolUser) return { error: "Could not resolve your account." };
  const itemId = String(formData.get("library_item_id") ?? "");
  const studentId = String(formData.get("student_id") ?? "") || null;
  const staffId = String(formData.get("staff_id") ?? "") || null;
  if (!itemId || (!studentId && !staffId)) return { error: "Item and a borrower are required." };

  const { error } = await supabase.from("library_reservations").insert({
    school_id: schoolUser.school_id,
    library_item_id: itemId,
    student_id: studentId,
    staff_id: staffId,
    created_by: schoolUser.id,
  });
  if (error) return { error: error.message };
  revalidatePath("/library", "layout");
  return { success: true };
}

export async function cancelReservationAction(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("library_reservations").update({ status: "cancelled" }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/library", "layout");
  return { success: true };
}

export async function createFineAction(formData: FormData): Promise<ActionResult> {
  const { supabase, schoolUser } = await currentSchoolUser();
  if (!schoolUser) return { error: "Could not resolve your account." };
  const loanId = String(formData.get("loan_id") ?? "");
  const amount = String(formData.get("amount") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!loanId || !amount || !reason) return { error: "Loan, amount, and reason are required." };

  const { error } = await supabase.from("library_fines").insert({
    school_id: schoolUser.school_id,
    loan_id: loanId,
    amount,
    reason,
    created_by: schoolUser.id,
  });
  if (error) return { error: error.message };
  revalidatePath("/library", "layout");
  return { success: true };
}

export async function resolveFineAction(input: { fine_id: string; status: "paid" | "waived" }): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("library_fines")
    .update({ status: input.status, resolved_at: new Date().toISOString() })
    .eq("id", input.fine_id);
  if (error) return { error: error.message };
  revalidatePath("/library", "layout");
  return { success: true };
}
