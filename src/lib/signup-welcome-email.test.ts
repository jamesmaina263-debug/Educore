import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sendSchoolWelcomeEmail } from "./signup-welcome-email";

const fetchMock = vi.fn();
const SCHOOL_ID = "0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d";

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("sendSchoolWelcomeEmail", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://proj.supabase.co");
    vi.stubEnv("DISPATCH_SECRET", "s3cret");
    vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("calls the send-school-welcome function with the dispatch secret and only the school id", async () => {
    fetchMock.mockResolvedValue(reply({ sent: true }));
    expect(await sendSchoolWelcomeEmail(SCHOOL_ID)).toEqual({ sent: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://proj.supabase.co/functions/v1/send-school-welcome");
    expect(init.method).toBe("POST");
    expect(init.headers["x-dispatch-secret"]).toBe("s3cret");
    // The recipient and school name are read from the database by the function, never sent from here.
    expect(JSON.parse(init.body)).toEqual({ school_id: SCHOOL_ID });
  });

  it("reports a repeat call as not sent (the function refuses a second send)", async () => {
    fetchMock.mockResolvedValue(reply({ sent: false, reason: "already_sent_or_unknown_school" }));
    expect(await sendSchoolWelcomeEmail(SCHOOL_ID)).toEqual({ sent: false, reason: "already_sent_or_unknown_school" });
  });

  it("returns not-sent instead of throwing when the provider/function fails", async () => {
    fetchMock.mockResolvedValue(reply({ error: "The welcome email could not be sent." }, 502));
    expect(await sendSchoolWelcomeEmail(SCHOOL_ID)).toEqual({ sent: false, reason: "The welcome email could not be sent." });
  });

  it("returns not-sent instead of throwing on a network error or timeout", async () => {
    fetchMock.mockRejectedValue(new DOMException("timed out", "TimeoutError"));
    expect(await sendSchoolWelcomeEmail(SCHOOL_ID)).toEqual({ sent: false, reason: "request_failed" });
  });

  it("copes with a non-JSON error body", async () => {
    fetchMock.mockResolvedValue(new Response("<html>bad gateway</html>", { status: 502 }));
    expect(await sendSchoolWelcomeEmail(SCHOOL_ID)).toEqual({ sent: false, reason: "status_502" });
  });

  it("skips quietly, without calling out, when the secret or URL is not configured", async () => {
    vi.stubEnv("DISPATCH_SECRET", "");
    expect(await sendSchoolWelcomeEmail(SCHOOL_ID)).toEqual({ sent: false, reason: "not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
