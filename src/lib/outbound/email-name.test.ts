import { describe, it, expect } from "vitest";
import { nameFromEmail } from "./email-name";

describe("nameFromEmail", () => {
  it("greets by the given name when the address is clearly first.last", () => {
    expect(nameFromEmail("peter.kimani@gmail.com")).toBe("Peter");
    expect(nameFromEmail("Mary_Wanjiku@yahoo.com")).toBe("Mary");
    expect(nameFromEmail("grace-achieng@outlook.com")).toBe("Grace");
    expect(nameFromEmail("peter.kimani+school@gmail.com")).toBe("Peter");
    expect(nameFromEmail("peter.kimani2@gmail.com")).toBe("Peter");
  });

  it("picks the recognised given name when it is the second part", () => {
    expect(nameFromEmail("kimani.peter@gmail.com")).toBe("Peter");
  });

  it("accepts a single recognised given name", () => {
    expect(nameFromEmail("james@school.ac.ke")).toBe("James");
    expect(nameFromEmail("wanjiku@gmail.com")).toBe("Wanjiku");
  });

  it("returns null when it is not sure", () => {
    for (const e of [
      "jmaina263@gmail.com", // handle with digits
      "james2024@gmail.com",
      "j.kimani@gmail.com", // initial + surname
      "kimani.mwangi@gmail.com", // no recognised given name
      "xzqwrt@gmail.com", // single unknown word
      "peter.kimani.otieno@gmail.com", // too many parts to be sure
      "stmarysprimary@gmail.com",
      "",
      "not-an-email",
      null,
      undefined,
    ]) {
      expect(nameFromEmail(e as string | null | undefined), String(e)).toBeNull();
    }
  });

  it("never treats a role, office or institution address as a person", () => {
    for (const e of [
      "info@sunrise.sc.ke",
      "principal@gmail.com",
      "headteacher@gmail.com",
      "bursar.office@gmail.com",
      "admin.james@gmail.com",
      "school.mary@gmail.com",
      "mary.academy@gmail.com",
      "childrenshome@gmail.com",
      "noreply@gmail.com",
    ]) {
      expect(nameFromEmail(e), e).toBeNull();
    }
  });

  it("refuses an address that is really the school's name", () => {
    expect(nameFromEmail("mercy.home@gmail.com", "Mercy Home")).toBeNull();
    expect(nameFromEmail("sunrise.ridge@gmail.com", "Sunrise Ridge Academy")).toBeNull();
  });
});
