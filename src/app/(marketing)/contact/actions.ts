"use server";

import { createClient } from "@/lib/supabase/server";

export type DemoRequestState = {
  status: "idle" | "success" | "error";
  message?: string;
};

// Simple, dependency-free bot mitigation for this public unauthenticated
// insert endpoint -- no CAPTCHA/third-party service, since those add a
// dependency and a privacy trade-off this form doesn't clearly need yet.
// Covers the two cheapest classes of abuse (naive form-fillers, scripted
// submits with no render delay) without adding friction for real visitors.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_FILL_TIME_MS = 1500;

// Inserts into public.marketing_demo_requests, a table isolated from the
// app's tenant schema with insert-only RLS (see the Phase 8 migration).
// This never touches any product/school data, and this file does not
// modify src/lib/supabase/server.ts -- it only imports the existing,
// already-shared createClient() helper the rest of the app also uses.
export async function submitDemoRequest(
  _prevState: DemoRequestState,
  formData: FormData,
): Promise<DemoRequestState> {
  // Honeypot: real visitors never see or fill this field. If it's non-empty,
  // silently report success without writing anything, so a bot gets no
  // signal that it was caught and doesn't retry with adjusted behavior.
  const honeypot = String(formData.get("company_website") ?? "").trim();
  if (honeypot) {
    return { status: "success" };
  }

  const renderedAt = Number(formData.get("rendered_at") ?? 0);
  if (renderedAt && Date.now() - renderedAt < MIN_FILL_TIME_MS) {
    return { status: "success" };
  }

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

  if (!EMAIL_RE.test(email)) {
    return { status: "error", message: "Enter a valid email address." };
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
