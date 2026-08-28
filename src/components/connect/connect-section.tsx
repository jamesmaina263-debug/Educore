"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusBadge } from "@/components/status-badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { createConnectItemAction, resolveConnectItemAction } from "@/app/(app)/connect/actions";

export interface ConnectStudentOption {
  id: string;
  name: string;
  stream_label: string;
}

export interface ConnectEventRow {
  id: string;
  event_type: string;
  actor_role: string;
  body: string | null;
  old_status: string | null;
  new_status: string | null;
  created_at: string;
}

export interface ConnectItemRow {
  id: string;
  created_by: string;
  student_name: string;
  category: string;
  title: string;
  body: string;
  due_date: string | null;
  requires_response: boolean;
  status: string;
  created_at: string;
  resolved_at: string | null;
  read_by_any: boolean;
  recipient_count: number;
  events: ConnectEventRow[];
}

const CATEGORY_LABELS: Record<string, string> = {
  request: "Request",
  academic: "Academic",
  attendance: "Attendance",
};

function latestGuardianAction(events: ConnectEventRow[]): { label: string; tone: "success" | "info" | "neutral" } {
  const relevant = [...events].reverse().find((e) => e.event_type === "acknowledged" || e.event_type === "replied");
  if (!relevant) return { label: "No response yet", tone: "neutral" };
  return relevant.event_type === "replied" ? { label: "Replied", tone: "success" } : { label: "Acknowledged", tone: "info" };
}

export function ConnectSection({
  items,
  studentOptions,
  canCreate,
  currentSchoolUserId,
}: {
  items: ConnectItemRow[];
  studentOptions: ConnectStudentOption[];
  canCreate: boolean;
  currentSchoolUserId: string | null;
}) {
  const router = useRouter();
  const [composeOpen, setComposeOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [studentId, setStudentId] = useState("");
  const [category, setCategory] = useState<"request" | "academic" | "attendance">("request");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [requiresResponse, setRequiresResponse] = useState(false);

  function resetComposeForm() {
    setStudentId("");
    setCategory("request");
    setTitle("");
    setBody("");
    setDueDate("");
    setRequiresResponse(false);
  }

  async function handleCreate() {
    setPending(true);
    setError(null);
    const result = await createConnectItemAction({
      studentId,
      category,
      title,
      body,
      dueDate: dueDate || null,
      requiresResponse,
    });
    setPending(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setComposeOpen(false);
    resetComposeForm();
    router.refresh();
  }

  async function handleResolve(itemId: string) {
    setPending(true);
    setError(null);
    const result = await resolveConnectItemAction(itemId);
    setPending(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <p className="text-sm text-danger">{error}</p>}

      {canCreate && (
        <div>
          <Dialog open={composeOpen} onOpenChange={setComposeOpen}>
            <DialogTrigger asChild>
              <Button size="sm">New item</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>New Connect item</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Student</Label>
                  <Select value={studentId} onValueChange={setStudentId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a student" />
                    </SelectTrigger>
                    <SelectContent>
                      {studentOptions.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name} — {s.stream_label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {studentOptions.length === 0 && (
                    <p className="text-xs text-muted-foreground">No students found in a class you&apos;re the class teacher of.</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label>Category</Label>
                  <Select value={category} onValueChange={(v) => setCategory(v as typeof category)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="request">Request</SelectItem>
                      <SelectItem value="academic">Academic</SelectItem>
                      <SelectItem value="attendance">Attendance</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Title</Label>
                  <Input value={title} onChange={(e) => setTitle(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Message</Label>
                  <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} />
                </div>
                <div className="space-y-1.5">
                  <Label>Due date (optional)</Label>
                  <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox checked={requiresResponse} onCheckedChange={(c) => setRequiresResponse(c === true)} id="requires-response" />
                  <Label htmlFor="requires-response" className="cursor-pointer font-normal">
                    Response required from guardian
                  </Label>
                </div>
              </div>
              <DialogFooter>
                <Button onClick={handleCreate} disabled={pending || !studentId || !title.trim() || !body.trim()}>
                  {pending ? "Sending…" : "Send"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      )}

      {items.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No Connect items yet.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((item) => {
            const expanded = expandedId === item.id;
            const guardianAction = latestGuardianAction(item.events);
            const canResolve = item.status === "open" && item.created_by === currentSchoolUserId;
            return (
              <div key={item.id} className="rounded-md border border-border p-3">
                <button
                  type="button"
                  onClick={() => setExpandedId(expanded ? null : item.id)}
                  className="flex w-full cursor-pointer items-center justify-between gap-3 text-left hover:opacity-80"
                >
                  <div>
                    <p className="text-sm font-medium">
                      {item.student_name} · {item.title}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {CATEGORY_LABELS[item.category] ?? item.category} · {new Date(item.created_at).toLocaleDateString()}
                      {item.due_date && ` · Due ${item.due_date}`}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <StatusBadge tone={item.read_by_any ? "success" : "neutral"} label={item.read_by_any ? "Read" : "Unread"} />
                    {item.requires_response && <StatusBadge tone={guardianAction.tone} label={guardianAction.label} />}
                    <StatusBadge tone={item.status === "resolved" ? "success" : "info"} label={item.status === "resolved" ? "Resolved" : "Open"} />
                    <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} />
                  </div>
                </button>

                {expanded && (
                  <div className="mt-3 border-t border-border pt-3">
                    <p className="text-sm">{item.body}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {item.recipient_count} guardian{item.recipient_count === 1 ? "" : "s"} notified
                    </p>

                    {item.events.length > 0 && (
                      <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
                        <p className="text-xs font-medium text-muted-foreground">Timeline</p>
                        {item.events.map((e) => (
                          <div key={e.id} className="text-xs">
                            <span className="font-medium">
                              {e.event_type === "status_changed"
                                ? `Marked ${e.new_status} by ${e.actor_role}`
                                : `${e.event_type === "replied" ? "Reply" : "Acknowledged"} by guardian`}
                            </span>
                            {" · "}
                            <span className="text-muted-foreground">{new Date(e.created_at).toLocaleString()}</span>
                            {e.body && <p className="mt-0.5 text-foreground">{e.body}</p>}
                          </div>
                        ))}
                      </div>
                    )}

                    {canResolve && (
                      <div className="mt-3">
                        <Button size="sm" variant="outline" onClick={() => handleResolve(item.id)} disabled={pending}>
                          {pending ? "Resolving…" : "Resolve"}
                        </Button>
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
