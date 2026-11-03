import { describe, expect, it } from "vitest";
import {
  MAX_BODY,
  MAX_TITLE,
  buildPushPayload,
  classifyPushStatus,
  looksLikeVapidPublicKey,
  safeNotificationUrl,
  urlBase64ToUint8Array,
} from "./payload";

describe("safeNotificationUrl", () => {
  it("keeps same-origin paths", () => {
    expect(safeNotificationUrl("/portal")).toBe("/portal");
    expect(safeNotificationUrl("/staff/training?days=30")).toBe("/staff/training?days=30");
  });
  it("rejects other origins, protocol-relative and script URLs", () => {
    for (const bad of ["https://evil.example", "//evil.example", "javascript:alert(1)", "evil.example/x", "\\\\evil", "/a\\b", "/ok\nbad", ""]) {
      expect(safeNotificationUrl(bad), bad).toBe("/");
    }
  });
  it("rejects non-strings and very long values", () => {
    expect(safeNotificationUrl(undefined)).toBe("/");
    expect(safeNotificationUrl(42)).toBe("/");
    expect(safeNotificationUrl("/" + "a".repeat(400))).toBe("/");
  });
});

describe("buildPushPayload", () => {
  it("builds a trimmed payload with a safe url", () => {
    const r = buildPushPayload({ title: "  Fees due ", body: " Term 1 ", url: "/portal", tag: "fees" });
    expect("payload" in r && JSON.parse(r.payload)).toEqual({ title: "Fees due", body: "Term 1", url: "/portal", tag: "fees" });
  });
  it("requires a title", () => {
    expect(buildPushPayload({ title: "   " })).toHaveProperty("error");
  });
  it("caps the title and body and replaces an unsafe url", () => {
    const r = buildPushPayload({ title: "t".repeat(500), body: "b".repeat(500), url: "https://evil.example" });
    const p = "payload" in r ? JSON.parse(r.payload) : null;
    expect(p.title).toHaveLength(MAX_TITLE);
    expect(p.body).toHaveLength(MAX_BODY);
    expect(p.url).toBe("/");
    expect(p).not.toHaveProperty("tag");
  });
});

describe("classifyPushStatus", () => {
  it("classifies push service responses", () => {
    expect(classifyPushStatus(201)).toBe("ok");
    expect(classifyPushStatus(404)).toBe("dead");
    expect(classifyPushStatus(410)).toBe("dead");
    expect(classifyPushStatus(429)).toBe("retry");
    expect(classifyPushStatus(503)).toBe("retry");
    expect(classifyPushStatus(400)).toBe("failed");
    expect(classifyPushStatus(401)).toBe("failed");
  });
});

describe("VAPID key helpers", () => {
  const KEY = "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U";
  it("decodes a base64url public key to 65 bytes starting with 0x04", () => {
    const bytes = urlBase64ToUint8Array(KEY);
    expect(bytes.length).toBe(65);
    expect(bytes[0]).toBe(4);
  });
  it("recognises a well-formed key and rejects junk", () => {
    expect(looksLikeVapidPublicKey(KEY)).toBe(true);
    expect(looksLikeVapidPublicKey("short")).toBe(false);
    expect(looksLikeVapidPublicKey(undefined)).toBe(false);
    expect(looksLikeVapidPublicKey(KEY + "=")).toBe(false);
  });
});
