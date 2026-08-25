import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// A device polls GET /iclock/getrequest?SN=... periodically to ask "do you
// have a command queued for me" (reboot, clear logs, force a user re-sync,
// etc.). EduCore doesn't queue any commands yet -- this just needs to
// exist and respond "OK" (ADMS's way of saying "nothing pending"), or the
// device may back off polling /iclock/cdata too. Still authenticates by
// serial number so an unregistered/deactivated device can't confirm it's
// being talked to.

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sn = url.searchParams.get("SN");
  const commKey = url.searchParams.get("commkey") ?? url.searchParams.get("pushcommkey");
  if (!sn) return new NextResponse("SN is required.", { status: 400 });

  let admin;
  try {
    admin = createAdminClient();
  } catch (e) {
    return new NextResponse(e instanceof Error ? e.message : "Server not configured.", { status: 500 });
  }

  const { data: device } = await admin
    .from("biometric_devices")
    .select("id, status, comm_key")
    .eq("serial_number", sn)
    .eq("provider", "zkteco")
    .maybeSingle();
  if (!device) return new NextResponse("Unregistered device serial number.", { status: 401 });
  if (device.status !== "active") return new NextResponse("This device has been deactivated.", { status: 401 });
  if (device.comm_key && device.comm_key !== commKey) return new NextResponse("Invalid comm key.", { status: 401 });

  return new NextResponse("OK", { status: 200 });
}
