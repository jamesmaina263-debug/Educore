import { notFound, redirect } from "next/navigation";
import { getCachedUser } from "@/lib/supabase/get-user";
import { logout } from "@/app/login/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import { SchemeEditor } from "@/components/academics/scheme-of-work/scheme-editor";
import { loadSchemeDetail } from "../_data";

export default async function SchemeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCachedUser();
  if (!user) redirect("/login");

  const ctx = await loadSchemeDetail(id);
  if (!ctx.scheme) notFound();

  return (
    <AppShell
      breadcrumbs={[
        { label: ctx.schoolName ?? "EduCore", href: "/dashboard" },
        { label: "Scheme of Work", href: "/academics/scheme-of-work" },
        { label: `${ctx.scheme.subject_name} — ${ctx.scheme.class_name}` },
      ]}
      userName={ctx.userName}
      userRole={ctx.userRole}
      onSignOut={logout}
    >
      <SchemeEditor scheme={ctx.scheme} entries={ctx.entries} canEdit={ctx.canEdit} canReview={ctx.canReview} />
    </AppShell>
  );
}
