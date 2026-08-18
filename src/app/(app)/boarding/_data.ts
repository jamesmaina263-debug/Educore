import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { DashboardStats } from "@/components/boarding/dashboard-section";
import type { HouseRow, StaffOption } from "@/components/boarding/structure-section";
import type { AllocationRow, StudentOption, AvailableBedOption } from "@/components/boarding/allocation-section";
import type { BoardingStudentRow } from "@/components/boarding/roll-call-section";
import type { TransferRow } from "@/components/boarding/transfers-section";
import type { IncidentRow } from "@/components/boarding/incidents-section";
import type { ReportsData } from "@/components/boarding/reports-section";

function fullName(row: { first_name: string; last_name: string } | null) {
  return row ? `${row.first_name} ${row.last_name}` : "Unknown";
}

export interface BoardingContext {
  userName: string;
  userRole?: string;
  schoolName: string;
  canReadAny: boolean;
  canWrite: boolean;
  houseTree: HouseRow[];
  standaloneDormitories: HouseRow["dormitories"];
  standaloneRooms: HouseRow["direct_rooms"];
  staffOptions: StaffOption[];
  availableBeds: AvailableBedOption[];
  studentOptions: StudentOption[];
  boardingStudentOptions: StudentOption[];
  allocationTableRows: AllocationRow[];
  transferTableRows: TransferRow[];
  incidentTableRows: IncidentRow[];
  rollCallDate: string;
  rollCallSession: "boarding_am" | "boarding_pm";
  rollCallStudents: BoardingStudentRow[];
  dashboardStats: DashboardStats;
  reportsData: ReportsData;
}

export async function loadBoardingContext(date?: string, session?: string): Promise<BoardingContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: viewer }, { data: canReadAny }, { data: canWriteData }, { data: canWriteAssigned }] = await Promise.all([
    supabase.from("school_users").select("full_name, roles(display_name), schools(name)").eq("auth_user_id", user.id).maybeSingle(),
    supabase.rpc("auth_has_permission", { p_permission_key: "hostel.read_any" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "hostel.write" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "hostel.write_assigned" }),
  ]);
  // hostel.write_assigned holders (e.g. a dormitory master without the
  // hostel_warden role) genuinely have DB-level write access to their
  // assigned dormitory via RLS -- without this, the UI hid every write
  // control from them even though their writes would have succeeded.
  const canWrite = canWriteData === true || canWriteAssigned === true;

  const [
    { data: houseRows },
    { data: dormRows },
    { data: roomRows },
    { data: bedRows },
    { data: allocationRows },
    { data: transferRows },
    { data: incidentRows },
    { data: staffRows },
  ] = await Promise.all([
    supabase.from("boarding_houses").select("*").order("name"),
    supabase.from("dormitories").select("*, school_users_master:master_id(full_name), school_users_assistant:assistant_id(full_name)").order("name"),
    supabase.from("hostel_rooms").select("*").order("room_number"),
    supabase.from("beds").select("*").order("bed_number"),
    supabase
      .from("hostel_allocations")
      .select("id, student_id, bed_id, start_date, end_date, status, students(first_name, last_name, current_class_id)")
      .order("start_date", { ascending: false }),
    supabase
      .from("boarding_transfers")
      .select("id, student_id, from_bed_id, to_bed_id, transfer_date, reason, students(first_name, last_name), authorizer:authorized_by(full_name)")
      .order("transfer_date", { ascending: false }),
    supabase
      .from("boarding_incidents")
      .select("id, student_id, incident_type, incident_date, location, description, action_taken, follow_up, status, students(first_name, last_name), school_users(full_name)")
      .order("incident_date", { ascending: false }),
    supabase.from("school_users").select("id, full_name, roles!inner(name)").not("roles.name", "in", "(parent,student,super_admin)").order("full_name"),
  ]);

  const staffById = new Map((staffRows ?? []).map((s) => [s.id, s.full_name]));

  const beds = bedRows ?? [];
  const rooms = roomRows ?? [];
  const dorms = dormRows ?? [];
  const houses = houseRows ?? [];
  const allocations = allocationRows ?? [];

  const activeAllocationByBed = new Map(allocations.filter((a) => a.status === "active").map((a) => [a.bed_id, a]));

  function roomLabel(r: { room_number: string; dormitory_id: string | null; house_id: string | null }): string {
    if (r.dormitory_id) {
      const dorm = dorms.find((d) => d.id === r.dormitory_id);
      const house = houses.find((h) => h.id === dorm?.house_id);
      return `${house?.name ?? "?"} > ${dorm?.name ?? "?"} > Room ${r.room_number}`;
    }
    if (r.house_id) {
      const house = houses.find((h) => h.id === r.house_id);
      return `${house?.name ?? "?"} > Room ${r.room_number}`;
    }
    return `Room ${r.room_number}`;
  }

  function bedLabel(bedId: string | null): string {
    if (!bedId) return "—";
    const bed = beds.find((b) => b.id === bedId);
    if (!bed) return "—";
    const room = rooms.find((r) => r.id === bed.room_id);
    if (!room) return "—";
    return `${roomLabel(room)} > Bed ${bed.bed_number}`;
  }

  function mapRoom(r: (typeof rooms)[number]) {
    return {
      id: r.id,
      room_number: r.room_number,
      capacity: r.capacity,
      gender: r.gender,
      beds: beds
        .filter((b) => b.room_id === r.id)
        .map((b) => {
          const occ = activeAllocationByBed.get(b.id);
          return {
            id: b.id,
            bed_number: b.bed_number,
            status: b.status,
            occupant_name: occ ? fullName(occ.students as unknown as { first_name: string; last_name: string }) : null,
          };
        }),
    };
  }

  function mapDormitory(d: (typeof dorms)[number]) {
    return {
      id: d.id,
      name: d.name,
      capacity: d.capacity,
      gender: d.gender,
      master_name: (d.school_users_master as unknown as { full_name: string } | null)?.full_name ?? null,
      assistant_name: (d.school_users_assistant as unknown as { full_name: string } | null)?.full_name ?? null,
      rooms: rooms.filter((r) => r.dormitory_id === d.id).map(mapRoom),
    };
  }

  // Every school gets a House/Dormitory/Room tree in the UI, but none of the
  // three levels is mandatory (Brief item #5). houseTree covers the fully
  // hierarchical case; standaloneDormitories covers a school that names
  // dormitories directly with no House concept; standaloneRooms covers plain
  // room-level tracking with neither. A house's own direct_rooms covers a
  // room attached straight to a house, skipping Dormitory.
  const houseTree: HouseRow[] = houses.map((h) => ({
    id: h.id,
    name: h.name,
    description: h.description,
    gender: h.gender,
    capacity: h.capacity,
    master_name: h.master_id ? (staffById.get(h.master_id) ?? null) : null,
    assistant_name: h.assistant_id ? (staffById.get(h.assistant_id) ?? null) : null,
    dormitories: dorms.filter((d) => d.house_id === h.id).map(mapDormitory),
    direct_rooms: rooms.filter((r) => r.house_id === h.id && !r.dormitory_id).map(mapRoom),
  }));

  const standaloneDormitories = dorms.filter((d) => !d.house_id).map(mapDormitory);
  const standaloneRooms = rooms.filter((r) => !r.house_id && !r.dormitory_id).map(mapRoom);

  const staffOptions: StaffOption[] = (staffRows ?? []).map((s) => ({ id: s.id, full_name: s.full_name }));

  const availableBeds: AvailableBedOption[] = beds
    .filter((b) => b.status === "available" && !activeAllocationByBed.has(b.id))
    .map((b) => ({ id: b.id, label: bedLabel(b.id), gender: rooms.find((r) => r.id === b.room_id)?.gender ?? "mixed" }));

  let studentOptions: StudentOption[] = [];
  if (canWrite) {
    const { data: students } = await supabase
      .from("students")
      .select("id, first_name, last_name, admission_number, gender")
      .eq("status", "active")
      .order("first_name");
    const boardedIds = new Set(allocations.filter((a) => a.status === "active").map((a) => a.student_id));
    studentOptions = (students ?? [])
      .filter((s) => !boardedIds.has(s.id))
      .map((s) => ({ id: s.id, name: `${s.first_name} ${s.last_name} (${s.admission_number})`, gender: s.gender }));
  }

  const boardingStudentOptions: StudentOption[] = allocations
    .filter((a) => a.status === "active")
    .map((a) => {
      const s = a.students as unknown as { first_name: string; last_name: string } | null;
      return { id: a.student_id, name: s ? `${s.first_name} ${s.last_name}` : "Unknown", gender: "" };
    });

  const allocationTableRows: AllocationRow[] = allocations.map((a) => ({
    id: a.id,
    student_name: fullName(a.students as unknown as { first_name: string; last_name: string }),
    bed_label: bedLabel(a.bed_id),
    start_date: a.start_date,
    end_date: a.end_date,
    status: a.status as "active" | "ended",
  }));

  const transferTableRows: TransferRow[] = (transferRows ?? []).map((t) => ({
    id: t.id,
    student_name: fullName(t.students as unknown as { first_name: string; last_name: string }),
    from_bed_label: t.from_bed_id ? bedLabel(t.from_bed_id) : null,
    to_bed_label: bedLabel(t.to_bed_id),
    transfer_date: t.transfer_date,
    reason: t.reason,
    authorized_by_name: (t.authorizer as unknown as { full_name: string } | null)?.full_name ?? null,
  }));

  const incidentTableRows: IncidentRow[] = (incidentRows ?? []).map((i) => ({
    id: i.id,
    student_name: fullName(i.students as unknown as { first_name: string; last_name: string }),
    incident_type: i.incident_type,
    incident_date: i.incident_date,
    location: i.location,
    description: i.description,
    staff_name: (i.school_users as unknown as { full_name: string } | null)?.full_name ?? null,
    action_taken: i.action_taken,
    follow_up: i.follow_up,
    status: i.status as "open" | "closed",
  }));

  const rollCallDate = date ?? new Date().toISOString().slice(0, 10);
  const rollCallSession = session === "boarding_pm" ? "boarding_pm" : "boarding_am";
  const { data: rollCallExisting } = await supabase
    .from("student_attendance")
    .select("student_id, status")
    .eq("attendance_date", rollCallDate)
    .eq("session", rollCallSession);
  const rollCallStatusByStudent = new Map((rollCallExisting ?? []).map((r) => [r.student_id, r.status]));

  const rollCallStudents: BoardingStudentRow[] = allocations
    .filter((a) => a.status === "active")
    .map((a) => {
      const s = a.students as unknown as { first_name: string; last_name: string; current_class_id: string | null } | null;
      return {
        student_id: a.student_id,
        stream_id: s?.current_class_id ?? "",
        name: s ? `${s.first_name} ${s.last_name}` : "Unknown",
        bed_label: bedLabel(a.bed_id),
        existing_status: (rollCallStatusByStudent.get(a.student_id) as BoardingStudentRow["existing_status"]) ?? null,
      };
    })
    .filter((s) => s.stream_id);

  const today = new Date().toISOString().slice(0, 10);
  const { data: todayRollCall } = await supabase
    .from("student_attendance")
    .select("status")
    .eq("attendance_date", today)
    .in("session", ["boarding_am", "boarding_pm"]);
  const { count: openIncidentsCount } = await supabase.from("boarding_incidents").select("id", { count: "exact", head: true }).eq("status", "open");

  const dashboardStats: DashboardStats = {
    totalBoardingStudents: allocations.filter((a) => a.status === "active").length,
    totalBeds: beds.length,
    occupiedBeds: activeAllocationByBed.size,
    availableBeds: beds.filter((b) => b.status === "available" && !activeAllocationByBed.has(b.id)).length,
    rollCallAbsenteesToday: (todayRollCall ?? []).filter((r) => r.status === "absent").length,
    sickBayCountToday: (todayRollCall ?? []).filter((r) => r.status === "sick_bay").length,
    openIncidents: openIncidentsCount ?? 0,
    capacityAlerts: rooms
      .map((r) => {
        const roomBeds = beds.filter((b) => b.room_id === r.id);
        const occupied = roomBeds.filter((b) => activeAllocationByBed.has(b.id)).length;
        return { label: roomLabel(r), occupied, capacity: r.capacity };
      })
      .filter((a) => a.capacity > 0 && a.occupied >= a.capacity),
  };

  const reportsData: ReportsData = {
    totalBeds: beds.length,
    occupiedBeds: activeAllocationByBed.size,
    availableBeds: beds.filter((b) => b.status === "available" && !activeAllocationByBed.has(b.id)).length,
    reservedBeds: beds.filter((b) => b.status === "reserved").length,
    unavailableBeds: beds.filter((b) => b.status === "unavailable").length,
    activeAllocations: allocations.filter((a) => a.status === "active").length,
    endedAllocationsThisTerm: allocations.filter((a) => a.status === "ended").length,
    transfersThisTerm: (transferRows ?? []).length,
    incidentsOpenClosed: {
      open: incidentTableRows.filter((i) => i.status === "open").length,
      closed: incidentTableRows.filter((i) => i.status === "closed").length,
    },
    dormUtilization: dorms.map((d) => {
      const house = houses.find((h) => h.id === d.house_id);
      const dormRooms = rooms.filter((r) => r.dormitory_id === d.id);
      const dormBeds = beds.filter((b) => dormRooms.some((r) => r.id === b.room_id));
      const occupied = dormBeds.filter((b) => activeAllocationByBed.has(b.id)).length;
      return { house_name: house?.name ?? "?", dorm_name: d.name, capacity: d.capacity, occupied, beds: dormBeds.length };
    }),
  };

  const roleName = (viewer?.roles as unknown as { display_name: string } | null)?.display_name;
  const schoolName = (viewer?.schools as unknown as { name: string } | null)?.name;

  return {
    userName: viewer?.full_name ?? user.email ?? "Account",
    userRole: roleName,
    schoolName: schoolName ?? "EduCore",
    canReadAny: canReadAny === true,
    canWrite,
    houseTree,
    standaloneDormitories,
    standaloneRooms,
    staffOptions,
    availableBeds,
    studentOptions,
    boardingStudentOptions,
    allocationTableRows,
    transferTableRows,
    incidentTableRows,
    rollCallDate,
    rollCallSession,
    rollCallStudents,
    dashboardStats,
    reportsData,
  };
}
