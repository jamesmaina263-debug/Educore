import { describe, expect, it } from "vitest";
import { MAX_LOGO_BYTES, sniffLogoType, validateLogoFile } from "./logo-upload";

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0];
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0];
const WEBP = [0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50];
const SVG = Array.from(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'));

const file = (bytes: number[], type: string, name = "logo") => new File([new Uint8Array(bytes)], name, { type });

describe("sniffLogoType", () => {
  it("recognises PNG, JPEG and WebP", () => {
    expect(sniffLogoType(new Uint8Array(PNG))).toBe("image/png");
    expect(sniffLogoType(new Uint8Array(JPEG))).toBe("image/jpeg");
    expect(sniffLogoType(new Uint8Array(WEBP))).toBe("image/webp");
  });
  it("rejects SVG/text and RIFF containers that aren't WebP", () => {
    expect(sniffLogoType(new Uint8Array(SVG))).toBeNull();
    expect(sniffLogoType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45]))).toBeNull();
    expect(sniffLogoType(new Uint8Array([]))).toBeNull();
  });
});

describe("validateLogoFile", () => {
  it("accepts a real PNG and returns its extension", async () => {
    expect(await validateLogoFile(file(PNG, "image/png"))).toEqual({ contentType: "image/png", extension: "png" });
  });
  it("rejects SVG even when declared as an allowed type", async () => {
    expect(await validateLogoFile(file(SVG, "image/svg+xml"))).toHaveProperty("error");
    expect(await validateLogoFile(file(SVG, "image/png"))).toHaveProperty("error");
  });
  it("rejects a declared/actual type mismatch", async () => {
    expect(await validateLogoFile(file(JPEG, "image/png"))).toHaveProperty("error");
  });
  it("rejects empty and oversized files", async () => {
    expect(await validateLogoFile(file([], "image/png"))).toHaveProperty("error");
    const big = new File([new Uint8Array(MAX_LOGO_BYTES + 1)], "big.png", { type: "image/png" });
    expect(await validateLogoFile(big)).toHaveProperty("error");
  });
});
