import { afterEach, describe, expect, it, vi } from "vitest";
import {
  beginDocumentRequest,
  looksLikePin,
  submitPinAndDeliver,
  NO_PIN_REPLY,
  PIN_LOCKED_REPLY,
  DAILY_LIMIT_REPLY,
  type DocContext,
  type DocumentServiceConfig,
} from "../../../supabase/functions/_shared/chatbot/documents";

const ACK = "ESCALATED";
type Rpc = (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;

function ctx(rpc: Rpc, messageText = "2580"): { ctx: DocContext; calls: { name: string; args: Record<string, unknown> }[] } {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const supabase = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return rpc(name, args);
    },
  };
  return {
    ctx: { supabase: supabase as unknown as DocContext["supabase"], schoolId: "s1", conversationId: "c1", guardianUserId: "g1", messageText },
    calls,
  };
}

const SERVICE: DocumentServiceConfig = { url: "https://app.example/api/bot/documents", secret: "sek" };
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("looksLikePin", () => {
  it("accepts 4-6 digits only", () => {
    expect(looksLikePin("2580")).toBe(true);
    expect(looksLikePin(" 258012 ")).toBe(true);
    expect(looksLikePin("123")).toBe(false);
    expect(looksLikePin("1234567")).toBe(false);
    expect(looksLikePin("pin 2580")).toBe(false);
  });
});

describe("beginDocumentRequest", () => {
  const student = { student_id: "st1", first_name: "Sam" };
  it("asks for the PIN", async () => {
    const { ctx: c } = ctx(async () => ({ data: { status: "awaiting_pin", request_id: "r1" }, error: null }));
    const r = await beginDocumentRequest(c, "report_card", student, ACK);
    expect(r.replyText).toContain("Sam's report card");
    expect(r.replyText).toContain("PIN");
    expect(r.escalate).toBe(false);
  });
  it("tells a guardian without a PIN to set one", async () => {
    const { ctx: c } = ctx(async () => ({ data: { status: "no_pin" }, error: null }));
    expect((await beginDocumentRequest(c, "statement", student, ACK)).replyText).toBe(NO_PIN_REPLY);
  });
  it("applies the daily limit", async () => {
    const { ctx: c } = ctx(async () => ({ data: { status: "daily_limit" }, error: null }));
    expect((await beginDocumentRequest(c, "statement", student, ACK)).replyText).toBe(DAILY_LIMIT_REPLY);
  });
  it("hands off to the office on a database error", async () => {
    const { ctx: c } = ctx(async () => ({ data: null, error: { message: "boom" } }));
    const r = await beginDocumentRequest(c, "statement", student, ACK);
    expect(r).toMatchObject({ replyText: ACK, escalate: true, escalationReason: "tool_error" });
  });
});

describe("submitPinAndDeliver", () => {
  it("nothing pending -> null (message is handled normally)", async () => {
    const { ctx: c } = ctx(async () => ({ data: { result: "none" }, error: null }));
    expect(await submitPinAndDeliver(c, ACK, SERVICE)).toBeNull();
  });
  it("wrong PIN says how many tries are left and does not call the document service", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { ctx: c } = ctx(async () => ({ data: { result: "wrong", attempts_left: 3 }, error: null }));
    const r = await submitPinAndDeliver(c, ACK, SERVICE);
    expect(r!.replyText).toContain("3 tries");
    expect(r!.document).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("locked PIN", async () => {
    const { ctx: c } = ctx(async () => ({ data: { result: "locked" }, error: null }));
    expect((await submitPinAndDeliver(c, ACK, SERVICE))!.replyText).toBe(PIN_LOCKED_REPLY);
  });
  it("right PIN -> asks the document service and returns the file to send", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, url: "https://signed/x.pdf", filename: "x.pdf", caption: "Sam's fee statement" }) });
    vi.stubGlobal("fetch", fetchMock);
    const { ctx: c } = ctx(async () => ({ data: { result: "ok", request_id: "r1", student_id: "st1", doc_type: "statement" }, error: null }));
    const r = await submitPinAndDeliver(c, ACK, SERVICE);
    expect(r).toMatchObject({ replyText: "Sam's fee statement", escalate: false, studentId: "st1", document: { url: "https://signed/x.pdf", filename: "x.pdf", requestId: "r1" } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://app.example/api/bot/documents");
    expect(init.headers.Authorization).toBe("Bearer sek");
    expect(JSON.parse(init.body)).toEqual({ request_id: "r1" });
  });
  it("no released report card -> denied with a plain message, no escalation", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: false, code: "not_available", message: "No released report card for Sam yet." }) }));
    const { ctx: c, calls } = ctx(async (name) => (name === "bot_submit_pin" ? { data: { result: "ok", request_id: "r1", student_id: "st1", doc_type: "report_card" }, error: null } : { data: null, error: null }));
    const r = await submitPinAndDeliver(c, ACK, SERVICE);
    expect(r).toMatchObject({ replyText: "No released report card for Sam yet.", escalate: false });
    expect(calls.find((x) => x.name === "bot_complete_document_request")?.args).toMatchObject({ p_request_id: "r1", p_status: "denied" });
  });
  it("document service down -> request marked failed and handed to the office", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    const { ctx: c, calls } = ctx(async (name) => (name === "bot_submit_pin" ? { data: { result: "ok", request_id: "r1", student_id: "st1", doc_type: "statement" }, error: null } : { data: null, error: null }));
    const r = await submitPinAndDeliver(c, ACK, SERVICE);
    expect(r).toMatchObject({ replyText: ACK, escalate: true, escalationReason: "tool_error" });
    expect(calls.find((x) => x.name === "bot_complete_document_request")?.args).toMatchObject({ p_status: "failed" });
  });
  it("service secret not configured -> failed, never calls out", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { ctx: c } = ctx(async (name) => (name === "bot_submit_pin" ? { data: { result: "ok", request_id: "r1", student_id: "st1", doc_type: "statement" }, error: null } : { data: null, error: null }));
    expect((await submitPinAndDeliver(c, ACK, { url: undefined, secret: undefined }))!.escalate).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
