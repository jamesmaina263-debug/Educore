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
  revalidatePath("/library");
  return { success: true };
}

export async function issueLoanAction(input: { library_item_id: string; student_id: string; due_date: string }): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("issue_library_loan", {
    p_item_id: input.library_item_id,
    p_student_id: input.student_id,
    p_due_date: input.due_date,
  });
  if (error) return { error: error.message };
  revalidatePath("/library");
  return { success: true };
}

export async function returnLoanAction(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("return_library_loan", { p_loan_id: id });
  if (error) return { error: error.message };
  revalidatePath("/library");
  return { success: true };
}
