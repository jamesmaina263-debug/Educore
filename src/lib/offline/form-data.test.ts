import { describe, expect, it } from "vitest";
import { formDataToObject, objectToFormData } from "./form-data";

describe("formDataToObject / objectToFormData round trip", () => {
  it("round-trips text fields, including empty strings", () => {
    const fd = new FormData();
    fd.set("student_id", "stu-1");
    fd.set("description", "Ran in the corridor");
    fd.set("location", "");

    const obj = formDataToObject(fd);
    expect(obj).toEqual({ student_id: "stu-1", description: "Ran in the corridor", location: "" });

    const rebuilt = objectToFormData(obj);
    expect(rebuilt.get("student_id")).toBe("stu-1");
    expect(rebuilt.get("description")).toBe("Ran in the corridor");
    expect(rebuilt.get("location")).toBe("");
  });

  it("preserves a checked checkbox's 'on' value and the absence of an unchecked one", () => {
    const checked = new FormData();
    checked.set("visible_to_guardian", "on");
    expect(formDataToObject(checked)).toEqual({ visible_to_guardian: "on" });

    // An unchecked checkbox simply isn't present in FormData at all --
    // formDataToObject can't invent a value for a key it never saw, and
    // objectToFormData faithfully reproduces that absence too.
    const unchecked = new FormData();
    const obj = formDataToObject(unchecked);
    expect(obj).toEqual({});
    expect(objectToFormData(obj).has("visible_to_guardian")).toBe(false);
  });

  it("throws rather than silently dropping a File field", () => {
    const fd = new FormData();
    fd.set("attachment", new File(["x"], "evidence.png", { type: "image/png" }));
    expect(() => formDataToObject(fd)).toThrow(/File/);
  });
});
