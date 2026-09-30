import { describe, expect, it } from "vitest";
import { maskEmail } from "./mask-email";

describe("maskEmail", () => {
  it("keeps the first character and the full domain, hides the rest of the local part", () => {
    expect(maskEmail("james.maina@educoreafrica.com")).toBe("j***@educoreafrica.com");
    expect(maskEmail("ben.kimuyu@educoreafrica.com")).toBe("b***@educoreafrica.com");
    expect(maskEmail("boniface.k@educoreafrica.com")).toBe("b***@educoreafrica.com");
  });

  it("never reveals the full local part even for very short ones", () => {
    expect(maskEmail("a@educoreafrica.com")).toBe("a***@educoreafrica.com");
  });
});
