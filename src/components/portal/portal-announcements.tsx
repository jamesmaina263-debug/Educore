"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/status-badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import {
  markAnnouncementReadAction,
  acknowledgeAnnouncementAction,
  completeAnnouncementAction,
  getAnnouncementAttachmentUrlAction,
} from "@/app/portal/actions";

export interface PortalAnnouncementAttachment {
  id: string;
  storage_path: string;
  file_name: string;
}

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
  my_completed_at: string | null;
  attachments: PortalAnnouncementAttachment[];
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
  // PA-10: guardian-side search/filter over notice history.
  const [query, setQuery] = useState("");
  const [urgencyFilter, setUrgencyFilter] = useState<"all" | "normal" | "action_required" | "urgent">("all");
  const [readFilter, setReadFilter] = useState<"all" | "unread">("all");

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      if (urgencyFilter !== "all" && item.urgency !== urgencyFilter) return false;
      if (readFilter === "unread" && item.my_read_at) return false;
      if (q && !item.title.toLowerCase().includes(q) && !item.body.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [items, query, urgencyFilter, readFilter]);

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

  async function handleComplete(id: string) {
    setPendingId(id);
    setError(null);
    const result = await completeAnnouncementAction(id);
    setPendingId(null);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  async function handleDownloadAttachment(storagePath: string) {
    const result = await getAnnouncementAttachmentUrlAction(storagePath);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    window.open(result.url, "_blank", "noopener,noreferrer");
  }

  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">School announcements will appear here.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search announcements…"
            className="pl-8"
          />
        </div>
        <Select value={urgencyFilter} onValueChange={(v) => setUrgencyFilter(v as typeof urgencyFilter)}>
          <SelectTrigger className="sm:w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All urgencies</SelectItem>
            <SelectItem value="normal">Notice</SelectItem>
            <SelectItem value="action_required">Action required</SelectItem>
            <SelectItem value="urgent">Urgent</SelectItem>
          </SelectContent>
        </Select>
        <Select value={readFilter} onValueChange={(v) => setReadFilter(v as typeof readFilter)}>
          <SelectTrigger className="sm:w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="unread">Unread</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {filteredItems.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No announcements match your search.
        </p>
      ) : (
      <div className="flex flex-col gap-2">
      {filteredItems.map((item) => {
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
                {item.attachments.length > 0 && (
                  <div className="mt-3 flex flex-col gap-1 border-t border-border pt-3">
                    {item.attachments.map((att) => (
                      <button
                        key={att.id}
                        type="button"
                        onClick={() => handleDownloadAttachment(att.storage_path)}
                        className="cursor-pointer truncate text-left text-sm text-primary hover:underline"
                      >
                        {att.file_name}
                      </button>
                    ))}
                  </div>
                )}
                {!withdrawn && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
                    {item.my_acknowledged_at ? (
                      <p className="text-xs text-muted-foreground">
                        Acknowledged {new Date(item.my_acknowledged_at).toLocaleString()}
                      </p>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => handleAcknowledge(item.id)} disabled={pendingId === item.id}>
                        {pendingId === item.id ? "Acknowledging…" : "Acknowledge"}
                      </Button>
                    )}
                    {/* PA-14: "completed" is a distinct fourth state, only meaningful
                        when the notice actually asked for an action -- acknowledging
                        just means "I saw this", completing means "I did the thing". */}
                    {item.urgency === "action_required" && (
                      item.my_completed_at ? (
                        <p className="text-xs font-medium text-success">
                          Completed {new Date(item.my_completed_at).toLocaleString()}
                        </p>
                      ) : (
                        <Button size="sm" onClick={() => handleComplete(item.id)} disabled={pendingId === item.id}>
                          {pendingId === item.id ? "Marking complete…" : "Mark action complete"}
                        </Button>
                      )
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
      </div>
      )}
    </div>
  );
}
