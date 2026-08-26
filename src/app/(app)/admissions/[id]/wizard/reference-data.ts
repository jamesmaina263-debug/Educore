import type { SupabaseClient } from "@supabase/supabase-js";

// One loader, called once from page.tsx, so every step works off the same live snapshot of
// capacity/availability rather than five separate ad-hoc queries that could disagree with each
// other mid-wizard (Brief 4.16.9: "live capacity", "live bed availability", "live capacity" —
// each step's own authoritative module, read the same way that module's own page reads it).
export async function loadWizardReferenceData(supabase: SupabaseClient) {
  const [
    { data: academicYears },
    { data: terms },
    { data: classes },
    { data: streams },
    { data: streamOccupancy },
    { data: houses },
    { data: dormitories },
    { data: rooms },
    { data: beds },
    { data: activeAllocations },
    { data: routes },
    { data: stops },
    { data: vehicles },
    { data: activeTransportAssignments },
    { data: feeStructures },
  ] = await Promise.all([
    supabase.from("academic_years").select("id, name, status").order("start_date", { ascending: false }),
    supabase.from("terms").select("id, academic_year_id, name, term_number, status").order("term_number"),
    supabase.from("classes").select("id, academic_year_id, name, level_order").order("level_order"),
    supabase.from("streams").select("id, class_id, name, capacity"),
    supabase.from("students").select("current_class_id").not("current_class_id", "is", null),
    supabase.from("boarding_houses").select("id, name, gender, capacity, status").eq("status", "active").order("name"),
    supabase.from("dormitories").select("id, house_id, name, gender, capacity, status").eq("status", "active").order("name"),
    supabase.from("hostel_rooms").select("id, dormitory_id, room_number, capacity, gender"),
    supabase.from("beds").select("id, room_id, bed_number, status"),
    supabase.from("hostel_allocations").select("bed_id").eq("status", "active"),
    supabase.from("transport_routes").select("id, name, fee_amount"),
    supabase.from("transport_stops").select("id, route_id, name, sequence, pickup_time, capacity").order("sequence"),
    supabase.from("transport_vehicles").select("id, registration_number, capacity, driver_name, driver_phone"),
    supabase.from("student_transport_assignments").select("route_id, vehicle_id").eq("status", "active"),
    // Gap 4 (audit): early, non-blocking warning when a term has no fee structure configured
    // yet, surfaced at Admission Details (Step 1) instead of only being discovered when
    // Finance's invoice creation fails mid-wizard (Aug 25 fix). Existence check only —
    // reuses the same term-only match complete_enrollment's checklist already gates on.
    supabase.from("fee_structures").select("term_id").eq("is_active", true),
  ]);

  const occupancyByStream = new Map<string, number>();
  for (const s of streamOccupancy ?? []) {
    if (!s.current_class_id) continue;
    occupancyByStream.set(s.current_class_id, (occupancyByStream.get(s.current_class_id) ?? 0) + 1);
  }
  const classNameById = new Map((classes ?? []).map((c) => [c.id, c.name]));

  const streamOptions = (streams ?? []).map((s) => ({
    id: s.id as string,
    label: `${classNameById.get(s.class_id) ?? "Class"} — ${s.name}`,
    class_id: s.class_id as string,
    capacity: s.capacity as number | null,
    occupied: occupancyByStream.get(s.id) ?? 0,
  }));

  const occupiedBedIds = new Set((activeAllocations ?? []).map((a) => a.bed_id));
  const dormNameById = new Map((dormitories ?? []).map((d) => [d.id, d.name]));
  const roomsByDorm = new Map<string, typeof rooms>();
  for (const r of rooms ?? []) {
    const list = roomsByDorm.get(r.dormitory_id ?? "") ?? [];
    list.push(r);
    roomsByDorm.set(r.dormitory_id ?? "", list);
  }
  const bedsByRoom = new Map<string, typeof beds>();
  for (const b of beds ?? []) {
    const list = bedsByRoom.get(b.room_id) ?? [];
    list.push(b);
    bedsByRoom.set(b.room_id, list);
  }

  const houseOptions = (houses ?? []).map((h) => {
    const dorms = (dormitories ?? []).filter((d) => d.house_id === h.id);
    return {
      id: h.id as string,
      name: h.name as string,
      gender: h.gender as string,
      dormitories: dorms.map((d) => {
        const roomList = roomsByDorm.get(d.id) ?? [];
        return {
          id: d.id as string,
          name: d.name as string,
          gender: d.gender as string,
          rooms: (roomList ?? []).map((r) => {
            const bedList = bedsByRoom.get(r.id) ?? [];
            return {
              id: r.id as string,
              room_number: r.room_number as string,
              gender: r.gender as string,
              beds: (bedList ?? []).map((b) => ({
                id: b.id as string,
                bed_number: b.bed_number as string,
                available: b.status === "available" && !occupiedBedIds.has(b.id),
                status: b.status as string,
              })),
            };
          }),
        };
      }),
    };
  });

  const assignedCountByRoute = new Map<string, number>();
  for (const a of activeTransportAssignments ?? []) {
    assignedCountByRoute.set(a.route_id, (assignedCountByRoute.get(a.route_id) ?? 0) + 1);
  }
  const routeOptions = (routes ?? []).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    fee_amount: r.fee_amount as number | null,
    stops: (stops ?? []).filter((s) => s.route_id === r.id),
  }));
  const vehicleOptions = (vehicles ?? []).map((v) => ({
    id: v.id as string,
    label: `${v.registration_number}${v.driver_name ? ` — ${v.driver_name}` : ""}`,
    capacity: v.capacity as number | null,
    assigned: assignedCountByRoute.get(v.id) ?? 0, // approximate; vehicles aren't route-exclusive today
  }));

  const termsWithFeeStructure = Array.from(new Set((feeStructures ?? []).map((f) => f.term_id as string)));

  return {
    academicYears: academicYears ?? [],
    terms: terms ?? [],
    classes: classes ?? [],
    streamOptions,
    houseOptions,
    routeOptions,
    vehicleOptions,
    dormNameById,
    termsWithFeeStructure,
  };
}
