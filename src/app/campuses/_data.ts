import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { CampusSummaryRow } from "@/components/campuses/campus-summary-table";
import type { GroupBrandingData } from "@/components/campuses/group-branding-form";
import type { ApiKeyRow } from "@/components/settings/api-keys-panel";

export interface CampusesContext {
  userName: string;
  userRole?: string;
  schoolName: string;
  isGroupAdmin: boolean;
  summaryRows: CampusSummaryRow[];
  brandingData: GroupBrandingData | null;
  apiKeyRows: ApiKeyRow[];
  canManageApiKeys: boolean;
}

export async function loadCampusesContext(): Promise<CampusesContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: schoolUser }, { data: groupId }] = await Promise.all([
    supabase.from("school_users").select("id, full_name, roles(display_name), schools(name)").eq("auth_user_id", user.id).maybeSingle(),
    supabase.rpc("auth_group_id"),
  ]);

  const roleName = (schoolUser?.roles as unknown as { display_name: string } | null)?.display_name;
  const schoolName = (schoolUser?.schools as unknown as { name: string } | null)?.name ?? "EduCore";
  const isGroupAdmin = Boolean(groupId);

  let summaryRows: CampusSummaryRow[] = [];
  let brandingData: GroupBrandingData | null = null;
  let apiKeyRows: ApiKeyRow[] = [];
  let canManageApiKeys = false;

  if (isGroupAdmin) {
    const [{ data: summary }, { data: group }, { data: canManageKeys }] = await Promise.all([
      supabase.rpc("group_schools_summary"),
      supabase
        .from("school_groups")
        .select("logo_url, primary_color, custom_domain, custom_domain_status, whitelabel_enabled")
        .eq("id", groupId)
        .maybeSingle(),
      supabase.rpc("auth_has_permission", { p_permission_key: "api.manage" }),
    ]);

    summaryRows = (summary ?? []) as CampusSummaryRow[];
    brandingData = group
      ? {
          logo_url: group.logo_url,
          primary_color: group.primary_color,
          custom_domain: group.custom_domain,
          custom_domain_status: group.custom_domain_status,
          whitelabel_enabled: group.whitelabel_enabled,
        }
      : null;
    canManageApiKeys = canManageKeys === true;

    if (canManageApiKeys) {
      const { data: keys } = await supabase
        .from("api_keys")
        .select("id, name, key_prefix, scopes, status, last_used_at, expires_at, created_at")
        .eq("school_group_id", groupId)
        .order("created_at", { ascending: false });
      apiKeyRows = (keys ?? []) as ApiKeyRow[];
    }
  }

  return {
    userName: schoolUser?.full_name ?? user.email ?? "Account",
    userRole: roleName,
    schoolName,
    isGroupAdmin,
    summaryRows,
    brandingData,
    apiKeyRows,
    canManageApiKeys,
  };
}
