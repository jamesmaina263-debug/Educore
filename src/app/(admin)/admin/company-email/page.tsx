import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AdminCompanyEmailPanel } from "@/components/admin/admin-company-email-panel";
import { getZohoFoldersAction, getZohoMessagesAction } from "./actions";

export default async function AdminCompanyEmailPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: isSuperAdmin } = await supabase.rpc("auth_is_super_admin");
  if (isSuperAdmin !== true) redirect("/dashboard");

  const foldersResult = await getZohoFoldersAction();
  const folders = "success" in foldersResult ? foldersResult.folders : [];
  const folderError = "error" in foldersResult ? foldersResult.error : null;

  // Prefer the Inbox folder if present, else the first folder returned.
  const defaultFolder = folders.find((f) => f.path?.toLowerCase() === "/inbox") ?? folders[0] ?? null;

  const messagesResult = defaultFolder ? await getZohoMessagesAction(defaultFolder.folderId) : null;
  const messages = messagesResult && "success" in messagesResult ? messagesResult.messages : [];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">Company Email</h1>
        <p className="text-sm text-muted-foreground">
          Read-only monitoring of james.maina@educoreafrica.com via Zoho Mail — separate from the
          Resend-backed school communication system. Visible to platform super admins only.
        </p>
      </div>

      {folderError && !defaultFolder && (
        <div className="panel border-destructive/30 bg-destructive-subtle p-4 text-sm text-destructive">
          Could not load Zoho Mail: {folderError}
        </div>
      )}

      {defaultFolder && (
        <AdminCompanyEmailPanel
          initialFolders={folders}
          initialFolderId={defaultFolder.folderId}
          initialMessages={messages}
          mailboxAddress="james.maina@educoreafrica.com"
        />
      )}
    </div>
  );
}
