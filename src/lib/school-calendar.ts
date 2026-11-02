// Events and houses calendar (WP 8.6). Pure helpers shared by the page, the server actions and tests.
// The database functions (save_school_event, save_school_house, ...) re-check everything here;
// this file only gives people a clear message before a round trip.

export const CALENDAR_FLAG = "feature.school.events_calendar";

export const EVENT_CATEGORIES = ["academic", "sports", "cultural", "meeting", "holiday", "trip", "exam", "other"] as const;
export type EventCategory = (typeof EVENT_CATEGORIES)[number];
export type EventAudience = "everyone" | "staff_only";
export type EventStatus = "scheduled" | "cancelled";

export const CATEGORY_LABELS: Record<EventCategory, string> = {
  academic: "Academic",
  sports: "Sports",
  cultural: "Cultural",
  meeting: "Meeting",
  holiday: "Holiday",
  trip: "Trip",
  exam: "Exam",
  other: "Other",
};

export interface EventInput {
  id: string | null;
  title: string;
  description: string;
  category: EventCategory;
  startsOn: string; // YYYY-MM-DD
  endsOn: string;
  startTime: string; // HH:MM or ""
  endTime: string;
  location: string;
  houseId: string | null;
  audience: EventAudience;
}

export interface HouseInput {
  id: string | null;
  name: string;
  colour: string;
  status: "active" | "archived";
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const COLOUR_RE = /^#[0-9a-fA-F]{6}$/;

function isRealDate(v: string): boolean {
  if (!DATE_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export function validateEvent(input: EventInput): { error: string } | { value: EventInput } {
  const title = input.title.trim();
  if (title.length < 1 || title.length > 150) return { error: "Give the event a title (up to 150 characters)." };
  if (!EVENT_CATEGORIES.includes(input.category)) return { error: "Choose a category." };
  if (input.audience !== "everyone" && input.audience !== "staff_only") return { error: "Choose who can see the event." };
  if (!isRealDate(input.startsOn) || !isRealDate(input.endsOn)) return { error: "Enter a valid start and end date." };
  if (input.endsOn < input.startsOn) return { error: "The end date cannot be before the start date." };
  if (input.startTime && !TIME_RE.test(input.startTime)) return { error: "Enter a valid start time." };
  if (input.endTime && !TIME_RE.test(input.endTime)) return { error: "Enter a valid end time." };
  if (input.endTime && !input.startTime) return { error: "Add a start time before an end time." };
  if (input.startTime && input.endTime && input.startsOn === input.endsOn && input.endTime <= input.startTime) {
    return { error: "The end time must be after the start time." };
  }
  if (input.description.length > 2000) return { error: "The description is too long (2000 characters at most)." };
  if (input.location.length > 150) return { error: "The location is too long (150 characters at most)." };
  return { value: { ...input, title } };
}

export function validateHouse(input: HouseInput): { error: string } | { value: HouseInput } {
  const name = input.name.trim();
  if (name.length < 1 || name.length > 60) return { error: "Give the house a name (up to 60 characters)." };
  if (!COLOUR_RE.test(input.colour)) return { error: "Choose a valid colour." };
  if (input.status !== "active" && input.status !== "archived") return { error: "Invalid house status." };
  return { value: { ...input, name } };
}

export interface CalendarEvent {
  id: string;
  title: string;
  description: string | null;
  category: EventCategory;
  startsOn: string;
  endsOn: string;
  startTime: string | null;
  endTime: string | null;
  location: string | null;
  houseId: string | null;
  audience: EventAudience;
  status: EventStatus;
  cancelReason: string | null;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "November 2026" for a YYYY-MM-DD date. */
export function monthLabel(date: string): string {
  const [y, m] = date.split("-");
  return `${MONTHS[Number(m) - 1] ?? "?"} ${y}`;
}

/** "20 Nov 2026" or "20 to 22 Nov 2026" (same month) or "30 Nov to 2 Dec 2026". */
export function formatDateRange(startsOn: string, endsOn: string): string {
  const [sy, sm, sd] = startsOn.split("-").map(Number);
  const [ey, em, ed] = endsOn.split("-").map(Number);
  const mon = (m: number) => (MONTHS[m - 1] ?? "?").slice(0, 3);
  if (startsOn === endsOn) return `${sd} ${mon(sm)} ${sy}`;
  if (sy === ey && sm === em) return `${sd} to ${ed} ${mon(sm)} ${sy}`;
  if (sy === ey) return `${sd} ${mon(sm)} to ${ed} ${mon(em)} ${sy}`;
  return `${sd} ${mon(sm)} ${sy} to ${ed} ${mon(em)} ${ey}`;
}

/** Events still running on or after `today` come first (soonest first); finished ones follow, most recent first. */
export function splitUpcoming(events: CalendarEvent[], today: string): { upcoming: CalendarEvent[]; past: CalendarEvent[] } {
  const upcoming = events
    .filter((e) => e.endsOn >= today)
    .sort((a, b) => a.startsOn.localeCompare(b.startsOn) || a.title.localeCompare(b.title));
  const past = events
    .filter((e) => e.endsOn < today)
    .sort((a, b) => b.startsOn.localeCompare(a.startsOn) || a.title.localeCompare(b.title));
  return { upcoming, past };
}

export function groupByMonth(events: CalendarEvent[]): { month: string; events: CalendarEvent[] }[] {
  const groups: { month: string; events: CalendarEvent[] }[] = [];
  for (const e of events) {
    const label = monthLabel(e.startsOn);
    const last = groups[groups.length - 1];
    if (last && last.month === label) last.events.push(e);
    else groups.push({ month: label, events: [e] });
  }
  return groups;
}

export function formatTimeRange(start: string | null, end: string | null): string | null {
  if (!start) return null;
  const s = start.slice(0, 5);
  return end ? `${s} to ${end.slice(0, 5)}` : s;
}
