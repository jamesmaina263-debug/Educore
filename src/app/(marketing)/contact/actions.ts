"use server";

import { createClient } from "@/lib/supabase/server";

export type DemoRequestState = {
  status: "idle" | "success" | "error";
  message?: string;
};

// Inserts into public.marketing_demo_requests, a table isolated from the
// app's tenant schema with insert-only RLS (see the Phase 8 migration).
// This never touches any product/school data, and this file does not
// modify src/lib/supabase/server.ts -- it only imports the existing,
// already-shared createClient() helper the rest of the app also uses.
export async function submitDemoRequest(
  _prevState: DemoRequestState,
  formData: FormData,
): Promise<DemoRequestState> {
  const name = String(formData.get("name") ?? "").trim();
  const schoolName = String(formData.get("school_name") ?? "").trim();
  const role = String(formData.get("role") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const studentCountRaw = String(formData.get("student_count") ?? "").trim();
  const message = String(formData.get("message") ?? "").trim();

  if (!name || !schoolName || !role || !email) {
    return {
      status: "error",
      message: "Name, school, role, and email are required.",
    };
  }

  const studentCount = studentCountRaw ? Number(studentCountRaw) : null;
  if (studentCount !== null && (!Number.isFinite(studentCount) || studentCount < 0)) {
    return { status: "error", message: "Student count must be a positive number." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("marketing_demo_requests").insert({
    name,
    school_name: schoolName,
    role,
    email,
    phone: phone || null,
    student_count: studentCount,
    message: message || null,
  });

  if (error) {
    return {
      status: "error",
      message: "Something went wrong on our end. Please try again, or email us directly.",
    };
  }

  return { status: "success" };
}
