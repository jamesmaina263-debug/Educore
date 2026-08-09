import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/login/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import { AskAIPanel } from "@/components/ai/ask-ai-panel";

export default async function AIPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: schoolUser }, { data: canAskAI }] = await Promise.all([
    supabase
      .from("school_users")
      .select("id, full_name, roles(display_name), schools(name)")
      .eq("auth_user_id", user.id)
      .maybeSingle(),
    supabase.rpc("auth_has_permission", { p_permission_key: "ai.read" }),
  ]);

  const roleName = (schoolUser?.roles as unknown as { display_name: string } | null)?.display_name;
  const schoolName = (schoolUser?.schools as unknown as { name: string } | null)?.name;

  let history: { id: string; question_text: string; matched_intent: string | null; answer_text: string | null; created_at: string }[] = [];
  if (canAskAI) {
    const { data } = await supabase
      .from("ai_query_logs")
      .select("id, question_text, matched_intent, answer_text, created_at")
      .order("created_at", { ascending: false })
      .limit(20);
    history = data ?? [];
  }

  return (
    <AppShell
      breadcrumbs={[{ label: schoolName ?? "EduCore", href: "/dashboard" }, { label: "Trimora AI" }]}
      userName={schoolUser?.full_name ?? user.email ?? "Account"}
      userRole={roleName}
      onSignOut={logout}
    >
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-lg font-semibold">Trimora AI</h1>
          <p className="text-sm text-muted-foreground">
            {schoolName ? `${schoolName} — ` : ""}
            ask a question, get a grounded answer
          </p>
        </div>

        {!canAskAI ? (
          <p className="text-sm text-muted-foreground">
            Trimora AI is available to the School Owner and Principal.
          </p>
        ) : (
          <AskAIPanel initialHistory={history} />
        )}
      </div>
    </AppShell>
  );
}
