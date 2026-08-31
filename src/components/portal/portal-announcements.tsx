"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { markAnnouncementReadAction, acknowledgeAnnouncementAction } from "@/app/portal/actions";

export interface PortalAnnouncementRow {
  id: string;
  title: string;
  body: string;
  urgency: "normal" | "action_required" | "urgent";
  status: string;
  created_at: string;
  withdrawal_reason: string | null;
  my_read_at: string | null;
  my_acknowledged_at: string | null;
}

const URGENCY_TONE: Record<string, "success" | "info" | "neutral" | "danger"> = {
  normal: "neutral",
  action_required: "info",
  urgent: "danger",
};

const URGENCY_LABEL: Record<string, string> = {
  normal: "Notice",
  action_required: "Action required",
  urgent: "Urgent",
};

export function PortalAnnouncementsSection({ items }: { items: PortalAnnouncementRow[] }) {
  const router = useRouter();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [openedOnce, setOpenedOnce] = useState<Set<string>>(new Set());
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleExpand(item: PortalAnnouncementRow) {
    const wasExpanded = expandedId === item.id;
    setExpandedId(wasExpanded ? null : item.id);
    if (!wasExpanded && !item.my_read_at && !openedOnce.has(item.id)) {
      setOpenedOnce((prev) => new Set(prev).add(item.id));
      const result = await markAnnouncementReadAction(item.id);
      if ("success" in result) router.refresh();
    }
  }

  async function handleAcknowledge(id: string) {
    setPendingId(id);
    setError(null);
    const result = await acknowledgeAnnouncementAction(id);
    setPendingId(null);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">School announcements will appear here.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {error && <p className="text-sm text-danger">{error}</p>}
      {items.map((item) => {
        const expanded = expandedId === item.id;
        const withdrawn = item.status === "withdrawn";
        return (
          <div key={item.id} className={`rounded-md border border-border p-3 ${withdrawn ? "opacity-60" : ""}`}>
            <button
              type="button"
              onClick={() => handleExpand(item)}
              className="flex w-full cursor-pointer items-center justify-between gap-3 text-left hover:opacity-80"
            >
              <div>
                <p className="text-sm font-medium">{item.title}</p>
                <p className="text-xs text-muted-foreground">{new Date(item.created_at).toLocaleDateString()}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {!item.my_read_at && !withdrawn && <StatusBadge tone="info" label="New" />}
                <StatusBadge tone={withdrawn ? "neutral" : URGENCY_TONE[item.urgency]} label={withdrawn ? "Withdrawn" : URGENCY_LABEL[item.urgency]} />
                <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} />
              </div>
            </button>

            {expanded && (
              <div className="mt-3 border-t border-border pt-3">
                <p className="text-sm whitespace-pre-wrap">{item.body}</p>
                {withdrawn && (
                  <p className="mt-2 text-xs text-danger">
                    This announcement was withdrawn{item.withdrawal_reason ? `: ${item.withdrawal_reason}` : "."}
                  </p>
                )}
                {!withdrawn && (
                  <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
                    {item.my_acknowledged_at ? (
                      <p className="text-xs text-muted-foreground">
                        Acknowledged {new Date(item.my_acknowledged_at).toLocaleString()}
                      </p>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => handleAcknowledge(item.id)} disabled={pendingId === item.id}>
                        {pendingId === item.id ? "Acknowledging…" : "Acknowledge"}
                      </Button>
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
