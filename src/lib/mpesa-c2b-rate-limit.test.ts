import { describe, expect, it } from "vitest";
import {
  REJECT_ALERT_MAX,
  VOLUME_MAX,
  ipKey,
  isWithinLimit,
  rejectBucket,
  suppressedNoticeBucket,
  volumeAlertBucket,
  volumeBucket,
} from "../../supabase/functions/_shared/mpesa/c2bRateLimit";

const SCHOOL = "123e4567-e89b-42d3-a456-426614174000";

describe("isWithinLimit (fails open)", () => {
  it("only an explicit false is over the limit", () => {
    expect(isWithinLimit(false, null)).toBe(false);
    expect(isWithinLimit(true, null)).toBe(true);
  });
  it("a database error never blocks or silences anything", () => {
    expect(isWithinLimit(false, { message: "boom" })).toBe(true);
    expect(isWithinLimit(null, { message: "boom" })).toBe(true);
  });
  it("a missing or odd answer is treated as within the limit", () => {
    expect(isWithinLimit(null, null)).toBe(true);
    expect(isWithinLimit(undefined, null)).toBe(true);
    expect(isWithinLimit("false", null)).toBe(true);
  });
});

describe("ipKey", () => {
  it("falls back to unknown for empty input", () => {
    expect(ipKey(null)).toBe("unknown");
    expect(ipKey(undefined)).toBe("unknown");
    expect(ipKey("   ")).toBe("unknown");
  });
  it("keeps IPv4 and IPv6 literals, lower-cased", () => {
    expect(ipKey("196.201.214.200")).toBe("196.201.214.200");
    expect(ipKey("2001:DB8::1")).toBe("2001:db8::1");
  });
  it("neutralises unexpected characters and bounds the length", () => {
    expect(ipKey("1.2.3.4; drop table")).not.toMatch(/[ ;]/);
    expect(ipKey("a".repeat(500)).length).toBeLessThanOrEqual(64);
  });
});

describe("bucket names", () => {
  it("are distinct per purpose and per subject", () => {
    const all = [
      rejectBucket("1.1.1.1"),
      suppressedNoticeBucket("1.1.1.1"),
      volumeBucket(SCHOOL),
      volumeAlertBucket(SCHOOL),
      rejectBucket("2.2.2.2"),
    ];
    expect(new Set(all).size).toBe(all.length);
  });
  it("never contain the confirmation token path", () => {
    expect(volumeBucket(SCHOOL)).toBe(`c2b-volume:${SCHOOL}`);
  });
});

describe("limits", () => {
  it("probe alerts are capped low and valid-traffic tripwire is generous", () => {
    expect(REJECT_ALERT_MAX).toBeLessThanOrEqual(10);
    expect(VOLUME_MAX).toBeGreaterThanOrEqual(100);
  });
});
