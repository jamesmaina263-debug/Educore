"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { bookPtSlotAction, cancelPtBookingAction } from "@/app/portal/actions";

export interface PortalSlotRow {
  id: string;
  teacher_name: string;
  slot_date: string;
  start_time: string;
  end_time: string;
  location: string | null;
  capacity: number;
  booked_count: number;
  my_booking_id: string | null;
}

export function PortalPtMeetingsSection({ studentId, slots }: { studentId: string; slots: PortalSlotRow[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function book(slotId: string) {
    setPendingId(slotId);
    setError(null);
    const res = await bookPtSlotAction(slotId, studentId, "");
    setPendingId(null);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    router.refresh();
  }

  async function cancel(bookingId: string) {
    setPendingId(bookingId);
    setError(null);
    const res = await cancelPtBookingAction(bookingId);
    setPendingId(null);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    router.refresh();
  }

  if (slots.length === 0) {
    return <p className="text-sm text-muted-foreground">No meeting slots published yet.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {error && <p className="text-sm text-danger">{error}</p>}
      {slots.map((s) => {
        const full = s.booked_count >= s.capacity && !s.my_booking_id;
        return (
          <div key={s.id} className="flex items-center justify-between rounded-md border border-border p-3">
            <div>
              <p className="text-sm font-medium">
                {s.slot_date} · {s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)}
              </p>
              <p className="text-xs text-muted-foreground">
                {s.teacher_name}
                {s.location && ` · ${s.location}`}
              </p>
            </div>
            {s.my_booking_id ? (
              <div className="flex items-center gap-2">
                <StatusBadge tone="success" label="Booked" />
                <Button size="sm" variant="outline" onClick={() => cancel(s.my_booking_id as string)} disabled={pendingId === s.my_booking_id}>
                  Cancel
                </Button>
              </div>
            ) : (
              <Button size="sm" onClick={() => book(s.id)} disabled={full || pendingId === s.id}>
                {full ? "Full" : pendingId === s.id ? "Booking…" : "Book"}
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}
