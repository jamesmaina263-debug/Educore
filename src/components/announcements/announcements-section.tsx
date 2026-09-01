"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/status-badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import {
  createAnnouncementAction,
  publishAnnouncementAction,
  withdrawAnnouncementAction,
  uploadAnnouncementAttachmentAction,
  deleteAnnouncementAttachmentAction,
  getAnnouncementAttachmentUrlAction,
} from "@/app/(app)/announcements/actions";

export interface GradeOption {
  id: string;
  name: string;
}

export interface StreamOption {
  id: string;
  label: string;
}

export interface StudentOption {
  id: string;
  name: string;
  stream_label: string;
}

export interface HouseOption {
  id: string;
  name: string;
}

export interface AttachmentRow {
  id: string;
  storage_path: string;
  file_name: string;
  file_size: number | null;
}

export interface AnnouncementRow {
  id: string;
  created_by: string;
  title: string;
  body: string;
  urgency: "normal" | "action_required" | "urgent";
  scope: string;
  target_label: string;
  status: string;
  created_at: string;
  published_at: string | null;
  withdrawn_at: string | null;
  withdrawal_reason: string | null;
  scheduled_at: string | null;
  attachments: AttachmentRow[];
  recipient_count: number;
  read_count: number;
  acknowledged_count: number;
}

const URGENCY_TONE: Record<string, "success" | "info" | "neutral" | "danger"> = {
  normal: "neutral",
  action_required: "info",
  urgent: "danger",
};

const URGENCY_LABEL: Record<string, string> = {
  normal: "Normal",
  action_required: "Action required",
  urgent: "Urgent",
};

const SCOPE_LABEL: Record<string, string> = {
  whole_school: "Whole school",
  grade: "Grade",
  class: "Class",
  student: "Student",
  boarding_house: "Boarding house",
};

export function AnnouncementsSection({
  items,
  grades,
  streams,
  students,
  houses,
  canPublishSchoolWide,
  currentSchoolUserId,
}: {
  items: AnnouncementRow[];
  grades: GradeOption[];
  streams: StreamOption[];
  students: StudentOption[];
  houses: HouseOption[];
  canPublishSchoolWide: boolean;
  currentSchoolUserId: string;
}) {
  const router = useRouter();
  const [composeOpen, setComposeOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [withdrawReason, setWithdrawReason] = useState<Record<string, string>>({});

  const [scope, setScope] = useState<"whole_school" | "grade" | "class" | "student" | "boarding_house">(
    canPublishSchoolWide ? "whole_school" : "class",
  );
  const [urgency, setUrgency] = useState<"normal" | "action_required" | "urgent">("normal");
  const [targetId, setTargetId] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [scheduledAt, setScheduledAt] = useState(""); // datetime-local string, empty = no schedule

  const canCompose = canPublishSchoolWide || streams.length > 0 || students.length > 0 || houses.length > 0;

  function resetForm() {
    setScope(canPublishSchoolWide ? "whole_school" : "class");
    setUrgency("normal");
    setTargetId("");
    setTitle("");
    setBody("");
    setScheduledAt("");
  }

  async function handleCreate(mode: "draft" | "publish" | "schedule") {
    setPendingId("compose");
    setError(null);
    const result = await createAnnouncementAction({
      title,
      body,
      urgency,
      scope,
      targetClassId: scope === "grade" ? targetId : null,
      targetStreamId: scope === "class" ? targetId : null,
      targetStudentId: scope === "student" ? targetId : null,
      targetHouseId: scope === "boarding_house" ? targetId : null,
      publishNow: mode === "publish",
      scheduledAt: mode === "schedule" && scheduledAt ? new Date(scheduledAt).toISOString() : null,
    });
    setPendingId(null);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setComposeOpen(false);
    resetForm();
    router.refresh();
  }

  async function handlePublish(id: string) {
    setPendingId(id);
    setError(null);
    const result = await publishAnnouncementAction(id);
    setPendingId(null);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  async function handleWithdraw(id: string) {
    setPendingId(id);
    setError(null);
    const result = await withdrawAnnouncementAction(id, withdrawReason[id] || null);
    setPendingId(null);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  async function handleUploadAttachment(announcementId: string, file: File) {
    setPendingId(`attach-${announcementId}`);
    setError(null);
    const formData = new FormData();
    formData.set("file", file);
    const result = await uploadAnnouncementAttachmentAction(announcementId, formData);
    setPendingId(null);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  async function handleDeleteAttachment(attachmentId: string) {
    setPendingId(`delete-attach-${attachmentId}`);
    setError(null);
    const result = await deleteAnnouncementAttachmentAction(attachmentId);
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

  const needsTarget = scope === "grade" || scope === "class" || scope === "student" || scope === "boarding_house";
  const targetOptions = scope === "grade" ? grades.map((g) => ({ id: g.id, label: g.name }))
    : scope === "class" ? streams.map((s) => ({ id: s.id, label: s.label }))
    : scope === "student" ? students.map((s) => ({ id: s.id, label: `${s.name} — ${s.stream_label}` }))
    : scope === "boarding_house" ? houses.map((h) => ({ id: h.id, label: h.name }))
    : [];

  return (
    <div className="flex flex-col gap-4">
      {error && <p className="text-sm text-danger">{error}</p>}

      {canCompose && (
        <div>
          <Dialog open={composeOpen} onOpenChange={setComposeOpen}>
            <DialogTrigger asChild>
              <Button size="sm">New announcement</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>New announcement</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Audience</Label>
                  <Select
                    value={scope}
                    onValueChange={(v) => {
                      setScope(v as typeof scope);
                      setTargetId("");
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {canPublishSchoolWide && <SelectItem value="whole_school">Whole school</SelectItem>}
                      {canPublishSchoolWide && <SelectItem value="grade">A grade</SelectItem>}
                      <SelectItem value="class">A class</SelectItem>
                      <SelectItem value="student">A single student&apos;s guardians</SelectItem>
                      {(canPublishSchoolWide || houses.length > 0) && (
                        <SelectItem value="boarding_house">A boarding house</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>

                {needsTarget && (
                  <div className="space-y-1.5">
                    <Label>{SCOPE_LABEL[scope]}</Label>
                    <Select value={targetId} onValueChange={setTargetId}>
                      <SelectTrigger>
                        <SelectValue placeholder={`Select a ${SCOPE_LABEL[scope].toLowerCase()}`} />
                      </SelectTrigger>
                      <SelectContent>
                        {targetOptions.map((o) => (
                          <SelectItem key={o.id} value={o.id}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {targetOptions.length === 0 && (
                      <p className="text-xs text-muted-foreground">
                        {scope === "class"
                          ? "No class found where you're the class teacher."
                          : scope === "boarding_house"
                          ? "No house found where you're the master or assistant."
                          : "No students found in a class you're the class teacher of."}
                      </p>
                    )}
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label>Urgency</Label>
                  <Select value={urgency} onValueChange={(v) => setUrgency(v as typeof urgency)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="normal">Normal</SelectItem>
                      <SelectItem value="action_required">Action required</SelectItem>
                      <SelectItem value="urgent">Urgent</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Title</Label>
                  <Input value={title} onChange={(e) => setTitle(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Message</Label>
                  <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} />
                </div>
                <div className="space-y-1.5">
                  <Label>Schedule for later (optional)</Label>
                  <Input
                    type="datetime-local"
                    value={scheduledAt}
                    onChange={(e) => setScheduledAt(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Leave blank to publish immediately or save as a draft. If set, this is published
                    automatically — no need to come back.
                  </p>
                </div>
              </div>
              <DialogFooter className="gap-2">
                <Button
                  variant="outline"
                  onClick={() => handleCreate("draft")}
                  disabled={pendingId === "compose" || !title.trim() || !body.trim() || (needsTarget && !targetId)}
                >
                  Save draft
                </Button>
                {scheduledAt ? (
                  <Button
                    onClick={() => handleCreate("schedule")}
                    disabled={pendingId === "compose" || !title.trim() || !body.trim() || (needsTarget && !targetId)}
                  >
                    {pendingId === "compose" ? "Scheduling…" : "Schedule"}
                  </Button>
                ) : (
                  <Button
                    onClick={() => handleCreate("publish")}
                    disabled={pendingId === "compose" || !title.trim() || !body.trim() || (needsTarget && !targetId)}
                  >
                    {pendingId === "compose" ? "Publishing…" : "Publish now"}
                  </Button>
                )}
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      )}

      {items.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No announcements yet.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((item) => {
            const expanded = expandedId === item.id;
            const isMine = item.created_by === currentSchoolUserId;
            const canManage = isMine || canPublishSchoolWide;
            return (
              <div key={item.id} className="rounded-md border border-border p-3">
                <button
                  type="button"
                  onClick={() => setExpandedId(expanded ? null : item.id)}
                  className="flex w-full cursor-pointer items-center justify-between gap-3 text-left hover:opacity-80"
                >
                  <div>
                    <p className="text-sm font-medium">{item.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {SCOPE_LABEL[item.scope]} · {item.target_label} · {new Date(item.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <StatusBadge tone={URGENCY_TONE[item.urgency]} label={URGENCY_LABEL[item.urgency]} />
                    <StatusBadge
                      tone={item.status === "published" ? "success" : item.status === "withdrawn" ? "danger" : "neutral"}
                      label={
                        item.status === "published"
                          ? "Published"
                          : item.status === "withdrawn"
                          ? "Withdrawn"
                          : item.scheduled_at
                          ? "Scheduled"
                          : "Draft"
                      }
                    />
                    <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} />
                  </div>
                </button>

                {expanded && (
                  <div className="mt-3 border-t border-border pt-3">
                    <p className="text-sm whitespace-pre-wrap">{item.body}</p>

                    {(item.attachments.length > 0 || (canManage && item.status !== "withdrawn")) && (
                      <div className="mt-3 flex flex-col gap-1.5 border-t border-border pt-3">
                        <Label className="text-xs">Attachments</Label>
                        {item.attachments.map((att) => (
                          <div key={att.id} className="flex items-center justify-between gap-2 text-sm">
                            <button
                              type="button"
                              onClick={() => handleDownloadAttachment(att.storage_path)}
                              className="cursor-pointer truncate text-left text-primary hover:underline"
                            >
                              {att.file_name}
                              {att.file_size ? ` (${Math.max(1, Math.round(att.file_size / 1024))} KB)` : ""}
                            </button>
                            {canManage && (
                              <button
                                type="button"
                                onClick={() => handleDeleteAttachment(att.id)}
                                disabled={pendingId === `delete-attach-${att.id}`}
                                className="cursor-pointer text-xs text-danger hover:underline"
                              >
                                Remove
                              </button>
                            )}
                          </div>
                        ))}
                        {canManage && item.status !== "withdrawn" && (
                          <Input
                            type="file"
                            className="mt-1"
                            disabled={pendingId === `attach-${item.id}`}
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) void handleUploadAttachment(item.id, file);
                              e.target.value = "";
                            }}
                          />
                        )}
                      </div>
                    )}

                    {item.status === "published" && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        {item.recipient_count} guardian{item.recipient_count === 1 ? "" : "s"} notified · {item.read_count} read ·{" "}
                        {item.acknowledged_count} acknowledged
                      </p>
                    )}
                    {item.status === "withdrawn" && (
                      <p className="mt-2 text-xs text-danger">
                        Withdrawn{item.withdrawal_reason ? `: ${item.withdrawal_reason}` : "."}
                      </p>
                    )}

                    {canManage && item.status === "draft" && (
                      <div className="mt-3 border-t border-border pt-3">
                        {item.scheduled_at && (
                          <p className="mb-2 text-xs text-muted-foreground">
                            Scheduled to publish automatically at {new Date(item.scheduled_at).toLocaleString()}.
                            You can still publish it now instead.
                          </p>
                        )}
                        <Button size="sm" onClick={() => handlePublish(item.id)} disabled={pendingId === item.id}>
                          {pendingId === item.id ? "Publishing…" : "Publish now"}
                        </Button>
                      </div>
                    )}

                    {canManage && item.status === "published" && (
                      <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
                        <Input
                          placeholder="Reason for withdrawal (optional, shown to guardians)"
                          value={withdrawReason[item.id] ?? ""}
                          onChange={(e) => setWithdrawReason((prev) => ({ ...prev, [item.id]: e.target.value }))}
                        />
                        <Button size="sm" variant="outline" onClick={() => handleWithdraw(item.id)} disabled={pendingId === item.id}>
                          {pendingId === item.id ? "Withdrawing…" : "Withdraw"}
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
