"use client";

import { useState, useTransition } from "react";
import { Mail, Paperclip, RefreshCw } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  getZohoFoldersAction,
  getZohoMessagesAction,
  getZohoMessageContentAction,
  type ZohoFolder,
  type ZohoMessageSummary,
} from "@/app/(admin)/admin/company-email/actions";

function formatDate(receivedTimeMs: string) {
  const ms = Number(receivedTimeMs);
  if (!ms) return "—";
  return new Date(ms).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" });
}

export function AdminCompanyEmailPanel({
  initialFolders,
  initialFolderId,
  initialMessages,
  mailboxAddress,
}: {
  initialFolders: ZohoFolder[];
  initialFolderId: string | null;
  initialMessages: ZohoMessageSummary[];
  mailboxAddress: string;
}) {
  const [folders, setFolders] = useState(initialFolders);
  const [activeFolderId, setActiveFolderId] = useState(initialFolderId);
  const [messages, setMessages] = useState(initialMessages);
  const [openMessage, setOpenMessage] = useState<{ folderId: string; messageId: string; content: string } | null>(
    null,
  );
  const [loadingContent, setLoadingContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function switchFolder(folderId: string) {
    setActiveFolderId(folderId);
    setError(null);
    startTransition(async () => {
      const result = await getZohoMessagesAction(folderId);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setMessages(result.messages);
    });
  }

  function refreshFolders() {
    startTransition(async () => {
      const result = await getZohoFoldersAction();
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setFolders(result.folders);
    });
  }

  async function openMessageContent(m: ZohoMessageSummary) {
    setLoadingContent(m.messageId);
    setError(null);
    const result = await getZohoMessageContentAction(m.folderId, m.messageId);
    setLoadingContent(null);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setOpenMessage({ folderId: m.folderId, messageId: m.messageId, content: result.content });
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[220px_1fr]">
      <div className="panel p-2">
        <div className="mb-2 flex items-center justify-between px-2 pt-1">
          <span className="label-eyebrow">Folders</span>
          <Button variant="ghost" size="sm" onClick={refreshFolders} disabled={isPending}>
            <RefreshCw className={`size-3.5 ${isPending ? "animate-spin" : ""}`} />
          </Button>
        </div>
        <nav className="flex flex-col gap-0.5">
          {folders.map((f) => (
            <button
              key={f.folderId}
              onClick={() => switchFolder(f.folderId)}
              className={`flex items-center justify-between rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                f.folderId === activeFolderId ? "bg-primary text-primary-foreground" : "hover:bg-muted"
              }`}
            >
              <span className="truncate">{f.folderName}</span>
              {f.unreadCount > 0 && (
                <span
                  className={`ml-2 shrink-0 rounded-full px-1.5 text-xs ${
                    f.folderId === activeFolderId ? "bg-primary-foreground/20" : "bg-muted-foreground/15"
                  }`}
                >
                  {f.unreadCount}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      <div className="flex flex-col gap-3">
        {error && (
          <div className="panel border-destructive/30 bg-destructive-subtle p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="panel">
          <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <h2 className="flex items-center gap-1.5 text-[0.8125rem] font-semibold">
              <Mail className="size-3.5" />
              {mailboxAddress}
            </h2>
            <span className="text-[0.6875rem] text-muted-foreground">
              {messages.length} message{messages.length === 1 ? "" : "s"}
            </span>
          </header>
          <div className="overflow-x-auto">
            <table className="table-dense w-full">
              <thead className="bg-muted/70">
                <tr>
                  <th></th>
                  <th>From / To</th>
                  <th>Subject</th>
                  <th>Received</th>
                  <th className="text-right">Open</th>
                </tr>
              </thead>
              <tbody>
                {messages.length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-center text-muted-foreground">
                      {isPending ? "Loading…" : "No messages in this folder."}
                    </td>
                  </tr>
                )}
                {messages.map((m) => (
                  <tr key={m.messageId} className={m.isUnread ? "font-medium" : undefined}>
                    <td>
                      {m.isUnread && <StatusBadge tone="info" label="Unread" />}
                      {m.hasAttachment && <Paperclip className="ml-1 inline size-3 text-muted-foreground" />}
                    </td>
                    <td className="max-w-[220px] truncate">{m.fromAddress || m.toAddress}</td>
                    <td className="max-w-[320px] truncate">
                      {m.subject || <span className="text-muted-foreground">(no subject)</span>}
                    </td>
                    <td className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDate(m.receivedTime)}
                    </td>
                    <td className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openMessageContent(m)}
                        disabled={loadingContent === m.messageId}
                      >
                        {loadingContent === m.messageId ? "Loading…" : "Read"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {openMessage && (
          <div className="panel p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="label-eyebrow">Message content</span>
              <Button variant="ghost" size="sm" onClick={() => setOpenMessage(null)}>
                Close
              </Button>
            </div>
            {/* Received email HTML is untrusted content -- a malicious/phishing email could embed
                a <script> or event handler. This iframe has NO sandbox permissions (no
                allow-scripts, no allow-same-origin), so anything embedded in the email body
                cannot execute or reach the admin session/DOM. Do not switch this to
                dangerouslySetInnerHTML or add sandbox flags without re-checking that tradeoff. */}
            <iframe
              title="Email content"
              sandbox=""
              srcDoc={openMessage.content}
              className="h-[420px] w-full rounded-md border border-border bg-white"
            />
          </div>
        )}
      </div>
    </div>
  );
}
