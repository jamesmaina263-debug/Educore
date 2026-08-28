"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/status-badge";
import { markConnectItemReadAction, acknowledgeConnectItemAction, replyConnectItemAction } from "@/app/portal/actions";

export interface PortalConnectEventRow {
  id: string;
  event_type: string;
  actor_role: string;
  body: string | null;
  created_at: string;
}

export interface PortalConnectItemRow {
  id: string;
  category: string;
  title: string;
  body: string;
  due_date: string | null;
  requires_response: boolean;
  status: string;
  created_at: string;
  my_read_at: string | null;
  events: PortalConnectEventRow[];
}

const CATEGORY_LABELS: Record<string, string> = {
  request: "Request",
  academic: "Academic",
  attendance: "Attendance",
};

export function PortalConnectSection({ items }: { items: PortalConnectItemRow[] }) {
  const router = useRouter();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [openedOnce, setOpenedOnce] = useState<Set<string>>(new Set());
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleExpand(item: PortalConnectItemRow) {
    const wasExpanded = expandedId === item.id;
    setExpandedId(wasExpanded ? null : item.id);
    if (!wasExpanded && !item.my_read_at && !openedOnce.has(item.id)) {
      setOpenedOnce((prev) => new Set(prev).add(item.id));
      const result = await markConnectItemReadAction(item.id);
      if ("success" in result) router.refresh();
    }
  }

  async function handleAcknowledge(itemId: string) {
    setPendingId(itemId);
    setError(null);
    const result = await acknowledgeConnectItemAction(itemId);
    setPendingId(null);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  async function handleReply(itemId: string) {
    setPendingId(itemId);
    setError(null);
    const result = await replyConnectItemAction(itemId, replyDrafts[itemId] ?? "");
    setPendingId(null);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setReplyDrafts((prev) => ({ ...prev, [itemId]: "" }));
    router.refresh();
  }

  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">Messages from your child&apos;s teacher will appear here.</p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {error && <p className="text-sm text-danger">{error}</p>}
      {items.map((item) => {
        const expanded = expandedId === item.id;
        const alreadyAcknowledgedOrReplied = item.events.some(
          (e) => e.event_type === "acknowledged" || e.event_type === "replied",
        );
        return (
          <div key={item.id} className="rounded-md border border-border p-3">
            <button type="button" onClick={() => handleExpand(item)} className="flex w-full items-center justify-between gap-3 text-left">
              <div>
                <p className="text-sm font-medium">{item.title}</p>
                <p className="text-xs text-muted-foreground">
                  {CATEGORY_LABELS[item.category] ?? item.category} · {new Date(item.created_at).toLocaleDateString()}
                  {item.due_date && ` · Due ${item.due_date}`}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {!item.my_read_at && <StatusBadge tone="info" label="New" />}
                <StatusBadge tone={item.status === "resolved" ? "success" : "neutral"} label={item.status === "resolved" ? "Resolved" : "Open"} />
              </div>
            </button>

            {expanded && (
              <div className="mt-3 border-t border-border pt-3">
                <p className="text-sm">{item.body}</p>

                {item.events.length > 0 && (
                  <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
                    {item.events.map((e) => (
                      <div key={e.id} className="text-xs">
                        <span className="font-medium">
                          {e.event_type === "status_changed" ? "Marked resolved by the teacher" : e.event_type === "replied" ? "Your reply" : "Acknowledged"}
                        </span>
                        {" · "}
                        <span className="text-muted-foreground">{new Date(e.created_at).toLocaleString()}</span>
                        {e.body && <p className="mt-0.5 text-foreground">{e.body}</p>}
                      </div>
                    ))}
                  </div>
                )}

                {item.status === "open" && (
                  <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
                    {!alreadyAcknowledgedOrReplied && (
                      <Button size="sm" variant="outline" onClick={() => handleAcknowledge(item.id)} disabled={pendingId === item.id}>
                        {pendingId === item.id ? "Acknowledging…" : "Acknowledge"}
                      </Button>
                    )}
                    {item.requires_response && (
                      <div className="flex flex-col gap-1.5">
                        <Textarea
                          value={replyDrafts[item.id] ?? ""}
                          onChange={(e) => setReplyDrafts((prev) => ({ ...prev, [item.id]: e.target.value }))}
                          placeholder="Write a reply…"
                          rows={2}
                        />
                        <Button
                          size="sm"
                          onClick={() => handleReply(item.id)}
                          disabled={pendingId === item.id || !(replyDrafts[item.id] ?? "").trim()}
                        >
                          {pendingId === item.id ? "Sending…" : "Send reply"}
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
