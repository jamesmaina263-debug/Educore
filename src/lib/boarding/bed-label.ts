import type { createClient } from "@/lib/supabase/server";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Replicates boarding/_data.ts's roomLabel()/bedLabel() logic for the
 * standalone paginated table queries (get-allocations-page.ts etc.), which
 * don't go through loadBoardingContext.
 *
 * beds/rooms/dormitories/boarding_houses are structural tables bounded by
 * physical capacity (rooms/beds a school actually has), not by student
 * count or history -- unlike hostel_allocations/boarding_transfers/
 * boarding_incidents, they're safe to fetch in full every time, same as
 * _data.ts already does.
 */
export async function createBedLabelResolver(supabase: SupabaseClient) {
  const [{ data: beds }, { data: rooms }, { data: dorms }, { data: houses }] = await Promise.all([
    supabase.from("beds").select("id, room_id, bed_number"),
    supabase.from("hostel_rooms").select("id, room_number, dormitory_id, house_id"),
    supabase.from("dormitories").select("id, name, house_id"),
    supabase.from("boarding_houses").select("id, name"),
  ]);

  const bedsList = beds ?? [];
  const roomsList = rooms ?? [];
  const dormsList = dorms ?? [];
  const housesList = houses ?? [];

  function roomLabel(r: { room_number: string; dormitory_id: string | null; house_id: string | null }): string {
    if (r.dormitory_id) {
      const dorm = dormsList.find((d) => d.id === r.dormitory_id);
      const house = housesList.find((h) => h.id === dorm?.house_id);
      return `${house?.name ?? "?"} > ${dorm?.name ?? "?"} > Room ${r.room_number}`;
    }
    if (r.house_id) {
      const house = housesList.find((h) => h.id === r.house_id);
      return `${house?.name ?? "?"} > Room ${r.room_number}`;
    }
    return `Room ${r.room_number}`;
  }

  function bedLabel(bedId: string | null): string {
    if (!bedId) return "—";
    const bed = bedsList.find((b) => b.id === bedId);
    if (!bed) return "—";
    const room = roomsList.find((r) => r.id === bed.room_id);
    if (!room) return "—";
    return `${roomLabel(room)} > Bed ${bed.bed_number}`;
  }

  return { bedLabel };
}
