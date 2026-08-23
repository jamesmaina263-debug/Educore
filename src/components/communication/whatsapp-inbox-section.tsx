"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/status-badge";
import { cn } from "@/lib/utils";
import {
  fetchWhatsAppMessages,
  sendWhatsAppReplyAction,
  claimWhatsAppConversationAction,
  closeWhatsAppConversationAction,
  returnWhatsAppConversationToBotAction,
  type WhatsAppMessageRow,
} from "@/app/(app)/communication/actions";

export interface ConversationRow {
  id: string;
  phone_number: string;
  status: "bot" | "escalated" | "staff_handling" | "closed";
  unread_count: number;
  last_message_at: string;
  last_message_preview: string | null;
  guardian_name: string | null;
  student_name: string | null;
  assigned_to_name: string | null;
}

const STATUS_TONE: Record<ConversationRow["status"], "info" | "warning" | "success" | "neutral"> = {
  bot: "info",
  escalated: "warning",
  staff_handling: "success",
  closed: "neutral",
};
const STATUS_LABEL: Record<ConversationRow["status"], string> = {
  bot: "Bot handling",
  escalated: "Needs you",
  staff_handling: "You're handling",
  closed: "Closed",
};

export function WhatsAppInboxSection({ conversations }: { conversations: ConversationRow[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(conversations[0]?.id ?? null);
  const [messages, setMessages] = useState<WhatsAppMessageRow[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const selected = conversations.find((c) => c.id === selectedId) ?? null;

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    async function load() {
      setLoadingMessages(true);
      const result = await fetchWhatsAppMessages(selectedId!);
      if (cancelled) return;
      setLoadingMessages(false);
      if ("error" in result) return setError(result.error);
      setMessages(result);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  function handleSend() {
    if (!selectedId || !draft.trim()) return;
    const text = draft;
    setDraft("");
    setError(null);
    startTransition(async () => {
      const result = await sendWhatsAppReplyAction(selectedId, text);
      if ("error" in result) {
        setError(result.error);
        setDraft(text); // give the message back so it isn't silently lost
        return;
      }
      const refreshed = await fetchWhatsAppMessages(selectedId);
      if (!("error" in refreshed)) setMessages(refreshed);
    });
  }

  function handleClaim() {
    if (!selectedId) return;
    startTransition(async () => {
      const result = await claimWhatsAppConversationAction(selectedId);
      if ("error" in result) setError(result.error);
    });
  }
  function handleClose() {
    if (!selectedId) return;
    startTransition(async () => {
      const result = await closeWhatsAppConversationAction(selectedId);
      if ("error" in result) setError(result.error);
    });
  }
  function handleReturnToBot() {
    if (!selectedId) return;
    startTransition(async () => {
      const result = await returnWhatsAppConversationToBotAction(selectedId);
      if ("error" in result) setError(result.error);
    });
  }

  if (conversations.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
        No WhatsApp conversations yet. Once a guardian messages your school&apos;s WhatsApp number, threads will show up here.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex h-[32rem] overflow-hidden rounded-xl border border-border">
        {/* Conversation list */}
        <div className="w-72 shrink-0 overflow-y-auto border-r border-border">
          {conversations.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelectedId(c.id)}
              className={cn(
                "flex w-full flex-col gap-1 border-b border-border p-3 text-left transition-colors hover:bg-muted cursor-pointer",
                c.id === selectedId && "bg-muted",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">{c.guardian_name ?? c.phone_number}</span>
                {c.unread_count > 0 && c.id !== selectedId && (
                  <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[0.6875rem] font-medium text-primary-foreground">
                    {c.unread_count}
                  </span>
                )}
              </div>
              {c.student_name && <span className="text-xs text-muted-foreground">Re: {c.student_name}</span>}
              <span className="truncate text-xs text-muted-foreground">{c.last_message_preview ?? ""}</span>
              <StatusBadge tone={STATUS_TONE[c.status]} label={STATUS_LABEL[c.status]} className="mt-1 w-fit" />
            </button>
          ))}
        </div>

        {/* Thread */}
        <div className="flex flex-1 flex-col">
          {selected ? (
            <>
              <div className="flex items-center justify-between border-b border-border p-3">
                <div>
                  <p className="text-sm font-medium">{selected.guardian_name ?? selected.phone_number}</p>
                  <p className="text-xs text-muted-foreground">
                    {selected.phone_number}
                    {selected.assigned_to_name ? ` · Assigned to ${selected.assigned_to_name}` : ""}
                  </p>
                </div>
                <div className="flex gap-2">
                  {selected.status !== "staff_handling" && selected.status !== "closed" && (
                    <Button size="sm" variant="outline" disabled={isPending} onClick={handleClaim}>
                      Claim
                    </Button>
                  )}
                  {selected.status !== "closed" && (
                    <Button size="sm" variant="outline" disabled={isPending} onClick={handleClose}>
                      Close
                    </Button>
                  )}
                  {selected.status !== "bot" && selected.status !== "closed" && (
                    <Button size="sm" variant="outline" disabled={isPending} onClick={handleReturnToBot}>
                      Return to bot
                    </Button>
                  )}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-3">
                {loadingMessages ? (
                  <p className="text-sm text-muted-foreground">Loading…</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {messages.map((m) => (
                      <div
                        key={m.id}
                        className={cn("flex flex-col gap-0.5", m.direction === "inbound" ? "items-start" : "items-end")}
                      >
                        <div
                          className={cn(
                            "max-w-[75%] rounded-lg px-3 py-2 text-sm",
                            m.direction === "inbound" ? "bg-muted" : m.sender_type === "bot" ? "bg-info-subtle" : "bg-primary text-primary-foreground",
                          )}
                        >
                          {m.body}
                        </div>
                        <span className="px-1 text-[0.6875rem] text-muted-foreground">
                          {m.sender_type === "bot" ? "Bot" : m.sender_type === "staff" ? "Staff" : "Guardian"} ·{" "}
                          {new Date(m.created_at).toLocaleString()}
                          {m.status === "failed" ? " · Failed to send" : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {selected.status !== "closed" && (
                <div className="flex gap-2 border-t border-border p-3">
                  <Textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="Type a reply…"
                    className="min-h-0 flex-1 resize-none"
                    rows={2}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleSend();
                      }
                    }}
                  />
                  <Button disabled={isPending || !draft.trim()} onClick={handleSend}>
                    Send
                  </Button>
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Select a conversation</div>
          )}
        </div>
      </div>
    </div>
  );
}
