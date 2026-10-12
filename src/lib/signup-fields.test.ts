import { describe, expect, it } from "vitest";
import { cleanSignupText, toE164 } from "./signup-fields";

describe("toE164", () => {
  it.each([
    ["0712 345 678", "+254712345678"],
    ["0112-345-678", "+254112345678"],
    ["254712345678", "+254712345678"],
    ["+254 712 345 678", "+254712345678"],
    ["+44 20 7946 0958", "+442079460958"],
  ])("accepts %s", (input, expected) => expect(toE164(input)).toBe(expected));

  it.each(["", "abc", "12345", "0812345678", "0712 345 67", "+0712345678", "+".repeat(10), "1".repeat(41), "07123456789012"])(
    "rejects %j",
    (input) => expect(toE164(input)).toBeNull(),
  );
});

describe("cleanSignupText", () => {
  it("strips control and zero-width characters, collapses spaces and caps length", () => {
    expect(cleanSignupText("  Sun\u0000rise\u200B   Academy \n", 50)).toBe("Sun rise Academy");
    expect(cleanSignupText("x".repeat(300), 10)).toHaveLength(10);
  });
});
