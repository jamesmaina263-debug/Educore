import { describe, expect, it } from "vitest";
import { safeStorageFilename } from "./storage-path";

describe("safeStorageFilename", () => {
  it("keeps a normal filename intact", () => {
    expect(safeStorageFilename("birth-certificate.pdf")).toBe("birth-certificate.pdf");
  });

  it("strips path separators so the name can't escape its storage prefix", () => {
    expect(safeStorageFilename("../../etc/passwd")).not.toContain("/");
    expect(safeStorageFilename("..\\..\\windows\\system32")).not.toContain("\\");
  });

  it("strips spaces and special characters", () => {
    expect(safeStorageFilename("my report (final) v2.docx")).toBe("my-report-final-v2.docx");
  });

  it("falls back to a default name when nothing usable remains", () => {
    expect(safeStorageFilename("???.pdf")).toBe("file.pdf");
  });

  it("caps an excessively long name", () => {
    const long = "a".repeat(500) + ".pdf";
    const result = safeStorageFilename(long);
    expect(result.length).toBeLessThanOrEqual(71); // 60 base + '.' + 10 ext
  });

  it("handles a filename with no extension", () => {
    expect(safeStorageFilename("README")).toBe("README");
  });

  it("handles a leading dot (hidden-file style name) without treating it as an extension", () => {
    expect(safeStorageFilename(".gitignore")).toBe(".gitignore");
  });
});
