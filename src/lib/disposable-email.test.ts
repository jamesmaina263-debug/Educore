import { describe, it, expect } from "vitest";
import { emailDomain, isDisposableEmail } from "./disposable-email";

describe("emailDomain", () => {
  it("lower-cases and trims the domain", () => {
    expect(emailDomain("Jane@Sunrise.AC.KE ")).toBe("sunrise.ac.ke");
  });
  it("returns null without a domain", () => {
    expect(emailDomain("nope")).toBeNull();
    expect(emailDomain("nope@")).toBeNull();
  });
});

describe("isDisposableEmail", () => {
  it("flags known disposable providers, any case", () => {
    expect(isDisposableEmail("wanjiru@mailinator.com")).toBe(true);
    expect(isDisposableEmail("Wanjiru@MAILINATOR.COM")).toBe(true);
    expect(isDisposableEmail("a@guerrillamail.com")).toBe(true);
    expect(isDisposableEmail("a@yopmail.com")).toBe(true);
  });
  it("flags test/QA signup domains seen in production", () => {
    expect(isDisposableEmail("alice012@punkproof.com")).toBe(true);
    expect(isDisposableEmail("x@mail.punkproof.com")).toBe(true);
  });
  it("flags subdomains of disposable providers", () => {
    expect(isDisposableEmail("a@x.mailinator.com")).toBe(true);
  });
  it("does not flag real school or free-webmail addresses", () => {
    expect(isDisposableEmail("jane@sunrise.ac.ke")).toBe(false);
    expect(isDisposableEmail("ngangavictor10@gmail.com")).toBe(false);
    expect(isDisposableEmail("head@yahoo.com")).toBe(false);
    expect(isDisposableEmail("a@notmailinator.com")).toBe(false);
  });
  it("does not flag a malformed address", () => {
    expect(isDisposableEmail("nope")).toBe(false);
  });
});
