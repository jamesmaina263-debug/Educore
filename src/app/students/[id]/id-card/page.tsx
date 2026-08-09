import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function IdCardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: student } = await supabase
    .from("students")
    .select(
      "id, admission_number, first_name, last_name, other_names, date_of_birth, photo_storage_path, status, streams(name, classes(name)), schools(name, logo_url, primary_color, address, phone)",
    )
    .eq("id", id)
    .maybeSingle();

  if (!student) notFound();

  const stream = student.streams as unknown as { name: string; classes: { name: string } | null } | null;
  const school = student.schools as unknown as {
    name: string;
    logo_url: string | null;
    primary_color: string | null;
    address: string | null;
    phone: string | null;
  } | null;
  const fullName = [student.first_name, student.other_names, student.last_name].filter(Boolean).join(" ");
  const classLabel = stream ? `${stream.classes?.name ?? ""} ${stream.name}`.trim() : "—";
  const accent = school?.primary_color || "#1e40af";

  // Photo upload isn't built yet anywhere in this app (photo_storage_path exists on the schema
  // but no bucket or upload UI has been wired to it) — this always falls back to initials for
  // now, honestly, rather than pretending a photo feature exists.
  let photoUrl: string | null = null;
  if (student.photo_storage_path) {
    const { data } = await supabase.storage.from("student-documents").createSignedUrl(student.photo_storage_path, 300);
    photoUrl = data?.signedUrl ?? null;
  }
  const initials = `${student.first_name[0] ?? ""}${student.last_name[0] ?? ""}`.toUpperCase();

  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "2rem", background: "#f4f4f5", minHeight: "100vh" }}>
      <div
        style={{
          width: "340px",
          borderRadius: "12px",
          overflow: "hidden",
          border: "1px solid #e4e4e7",
          background: "#fff",
          fontFamily: "system-ui, sans-serif",
          boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
        }}
      >
        <div style={{ background: accent, color: "#fff", padding: "12px 16px", display: "flex", alignItems: "center", gap: "10px" }}>
          {school?.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={school.logo_url} alt="" style={{ width: 32, height: 32, borderRadius: 6, objectFit: "contain", background: "#fff" }} />
          ) : null}
          <div>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{school?.name ?? "EduCore School"}</p>
            <p style={{ margin: 0, fontSize: 10, opacity: 0.85 }}>Student Identification Card</p>
          </div>
        </div>

        <div style={{ padding: "16px", display: "flex", gap: "14px" }}>
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: 8,
              background: "#e4e4e7",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 22,
              fontWeight: 600,
              color: "#52525b",
              flexShrink: 0,
              overflow: "hidden",
            }}
          >
            {photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photoUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              initials
            )}
          </div>
          <div style={{ fontSize: 12, lineHeight: 1.6 }}>
            <p style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{fullName}</p>
            <p style={{ margin: 0, color: "#71717a" }}>Adm. No. {student.admission_number}</p>
            <p style={{ margin: 0, color: "#71717a" }}>Class: {classLabel}</p>
            <p style={{ margin: 0, color: "#71717a" }}>DOB: {student.date_of_birth}</p>
          </div>
        </div>

        {(school?.address || school?.phone) && (
          <div style={{ borderTop: "1px solid #e4e4e7", padding: "10px 16px", fontSize: 10, color: "#71717a" }}>
            {school?.address && <p style={{ margin: 0 }}>{school.address}</p>}
            {school?.phone && <p style={{ margin: 0 }}>{school.phone}</p>}
          </div>
        )}
      </div>

      <style>{`
        @media print {
          body { background: #fff !important; }
        }
      `}</style>
    </div>
  );
}
