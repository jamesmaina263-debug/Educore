"use server";

import { createClient } from "@/lib/supabase/server";
import { extractEdgeFunctionError } from "@/lib/edge-function-error";

export type ZohoFolder = {
  folderId: string;
  folderName: string;
  path: string;
  unreadCount: number;
};

export type ZohoMessageSummary = {
  messageId: string;
  folderId: string;
  subject: string;
  summary: string;
  fromAddress: string;
  toAddress: string;
  sentDateInGMT: string;
  receivedTime: string;
  hasAttachment: boolean;
  isUnread: boolean;
};

async function invokeMonitor<T>(actionQuery: string): Promise<{ error: string } | { success: true; data: T }> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { error: "Not signed in." };

  const { data, error } = await supabase.functions.invoke(`zoho-mail-monitor?${actionQuery}`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (error) return { error: await extractEdgeFunctionError(error, "Failed to reach the Zoho Mail monitor.") };
  if (data?.error) return { error: data.error as string };
  return { success: true, data: data as T };
}

export async function getZohoFoldersAction(): Promise<{ error: string } | { success: true; folders: ZohoFolder[] }> {
  const result = await invokeMonitor<{ folders: ZohoFolder[] }>("action=folders");
  if ("error" in result) return result;
  return { success: true, folders: result.data.folders };
}

export async function getZohoMessagesAction(
  folderId: string,
  start = 1,
  limit = 50,
): Promise<{ error: string } | { success: true; messages: ZohoMessageSummary[] }> {
  const query = new URLSearchParams({ action: "messages", folderId, start: String(start), limit: String(limit) });
  const result = await invokeMonitor<{ messages: ZohoMessageSummary[] }>(query.toString());
  if ("error" in result) return result;
  return { success: true, messages: result.data.messages };
}

export async function getZohoMessageContentAction(
  folderId: string,
  messageId: string,
): Promise<{ error: string } | { success: true; content: string }> {
  const query = new URLSearchParams({ action: "content", folderId, messageId });
  const result = await invokeMonitor<{ content: string }>(query.toString());
  if ("error" in result) return result;
  return { success: true, content: result.data.content };
}
