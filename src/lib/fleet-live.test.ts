import { describe, expect, it } from "vitest";
import { ageSeconds, ageText, liveState, mapsUrl, speedText } from "./fleet-live";

const now = Date.parse("2026-11-03T05:00:00Z");

describe("fleet live helpers", () => {
  it("computes age and never goes negative", () => {
    expect(ageSeconds("2026-11-03T04:59:30Z", now)).toBe(30);
    expect(ageSeconds("2026-11-03T05:00:10Z", now)).toBe(0);
    expect(ageSeconds(null, now)).toBeNull();
    expect(ageSeconds("garbage", now)).toBeNull();
  });
  it("live within 10 minutes, stale after, none without a position", () => {
    expect(liveState({ recorded_at: "2026-11-03T04:55:00Z", lat: -0.4, lng: 36.9 }, now)).toBe("live");
    expect(liveState({ recorded_at: "2026-11-03T04:50:00Z", lat: -0.4, lng: 36.9 }, now)).toBe("live");
    expect(liveState({ recorded_at: "2026-11-03T04:49:59Z", lat: -0.4, lng: 36.9 }, now)).toBe("stale");
    expect(liveState({ recorded_at: null, lat: null, lng: null }, now)).toBe("none");
  });
  it("formats age text", () => {
    expect(ageText(null)).toBe("never");
    expect(ageText(5)).toBe("5s ago");
    expect(ageText(125)).toBe("2 min ago");
    expect(ageText(7300)).toBe("2 h ago");
    expect(ageText(200000)).toBe("2 d ago");
  });
  it("builds a maps link only for valid coordinates", () => {
    expect(mapsUrl(-0.41, 36.95)).toBe("https://www.google.com/maps?q=-0.41000,36.95000");
    expect(mapsUrl(null, 1)).toBeNull();
    expect(mapsUrl(91, 0)).toBeNull();
    expect(mapsUrl(0, 181)).toBeNull();
    expect(mapsUrl(Number.NaN, 0)).toBeNull();
  });
  it("formats speed", () => {
    expect(speedText(null)).toBe("-");
    expect(speedText(42.4)).toBe("42 km/h");
  });
});
