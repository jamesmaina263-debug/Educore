import { NextResponse } from "next/server";

// A device POSTs here to report the result of a command from
// /iclock/getrequest. Since EduCore never queues any commands (see that
// route's comment), this should never receive anything meaningful in
// practice -- it exists only so a device that tries anyway gets a clean
// 200 instead of a 404, which some firmwares treat as a reason to retry
// aggressively or log a persistent error state. Logged, not authenticated
// against a device row: there's nothing sensitive in a command-ack, and
// requiring auth here would just be one more way for this endpoint to
// reject a device that has nothing useful to send it in the first place.

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.text();
  if (body.trim()) console.warn("[iclock/devicecmd] unexpected command result received:", body.slice(0, 500));
  return new NextResponse("OK", { status: 200 });
}
