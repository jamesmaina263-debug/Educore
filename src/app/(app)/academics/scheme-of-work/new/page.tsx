import { redirect } from "next/navigation";
import { getCachedUser } from "@/lib/supabase/get-user";
import { logout } from "@/app/login/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import { SchemeCreateForm } from "@/components/academics/scheme-of-work/scheme-create-form";
import { loadCreateSchemeOptions } from "../_data";

// generateSchemeWithAI (invoked from this page's form) can now run several
// sequential Gemini calls for a large scheme (see chunkWeekRanges in
// src/lib/ai/scheme-of-work.ts) -- raised from the platform's default so a
// multi-chunk generation isn't cut off mid-request. Available on Vercel's
// Hobby plan without a plan upgrade.
export const maxDuration = 60;

export default async function NewSchemeOfWorkPage() {
  const user = await getCachedUser();
  if (!user) redirect("/login");

  const options = await loadCreateSchemeOptions();

  return (
    <AppShell
      breadcrumbs={[
        { label: options.schoolName ?? "EduCore", href: "/dashboard" },
        { label: "Scheme of Work", href: "/academics/scheme-of-work" },
        { label: "New Scheme" },
      ]}
      userName={options.userName}
      userRole={options.userRole}
      onSignOut={logout}
    >
      {!options.canWrite ? (
        <p className="panel border-dashed p-10 text-center text-sm text-muted-foreground">
          You don&apos;t have permission to create a scheme of work.
        </p>
      ) : (
        <SchemeCreateForm options={options} />
      )}
    </AppShell>
  );
}
