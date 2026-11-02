import { StatusBadge } from "@/components/status-badge";
import { CATEGORY_LABELS, formatDateRange, formatTimeRange, type CalendarEvent } from "@/lib/school-calendar";

export interface PortalCalendarHouse {
  id: string;
  name: string;
  colour: string;
}

/** Read-only list of upcoming school events for parents. Staff-only events never reach this component. */
export function PortalCalendarSection({ events, houses }: { events: CalendarEvent[]; houses: PortalCalendarHouse[] }) {
  if (events.length === 0) {
    return <p className="text-sm text-muted-foreground">No upcoming events.</p>;
  }
  const houseById = new Map(houses.map((h) => [h.id, h]));
  return (
    <ul className="flex flex-col divide-y">
      {events.map((e) => {
        const house = e.houseId ? houseById.get(e.houseId) : null;
        const time = formatTimeRange(e.startTime, e.endTime);
        const cancelled = e.status === "cancelled";
        return (
          <li key={e.id} className="flex flex-col gap-1 py-2 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`text-sm font-medium ${cancelled ? "text-muted-foreground line-through" : ""}`}>{e.title}</span>
              <StatusBadge tone={cancelled ? "danger" : "neutral"} label={cancelled ? "Cancelled" : CATEGORY_LABELS[e.category]} />
              {house && (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: house.colour }} />
                  {house.name}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {formatDateRange(e.startsOn, e.endsOn)}
              {time ? `, ${time}` : ""}
              {e.location ? `, ${e.location}` : ""}
            </p>
            {e.description && !cancelled && <p className="text-sm">{e.description}</p>}
            {cancelled && e.cancelReason && <p className="text-xs text-muted-foreground">Reason: {e.cancelReason}</p>}
          </li>
        );
      })}
    </ul>
  );
}
