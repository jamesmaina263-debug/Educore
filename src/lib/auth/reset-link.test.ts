import { describe, expect, it } from "vitest";
import {
  friendlyLinkError,
  isAllowedTokenHashType,
  LINK_EXPIRED_MESSAGE,
  LINK_VERIFY_FAILED_MESSAGE,
  resolveAuthRedirectOrigin,
  rootAuthFallback,
} from "./reset-link";

const SITE = "https://www.educoreafrica.com";

describe("resolveAuthRedirectOrigin", () => {
  it("always uses the canonical origin in production, even for the Vercel alias", () => {
    expect(resolveAuthRedirectOrigin("https://educore-beige.vercel.app", "production", SITE)).toBe(SITE);
    expect(resolveAuthRedirectOrigin("https://educoreafrica.com", "production", SITE)).toBe(SITE);
    expect(resolveAuthRedirectOrigin(null, "production", SITE)).toBe(SITE);
  });

  it("strips a trailing slash from the configured site URL", () => {
    expect(resolveAuthRedirectOrigin(null, "production", `${SITE}/`)).toBe(SITE);
  });

  it("uses the request origin outside production (previews, local dev)", () => {
    expect(resolveAuthRedirectOrigin("http://localhost:3000", undefined, SITE)).toBe("http://localhost:3000");
    expect(resolveAuthRedirectOrigin("https://educore-git-x.vercel.app", "preview", SITE)).toBe(
      "https://educore-git-x.vercel.app",
    );
  });

  it("falls back to the canonical origin when the request origin is missing or malformed", () => {
    expect(resolveAuthRedirectOrigin(null, undefined, SITE)).toBe(SITE);
    expect(resolveAuthRedirectOrigin("not a url", undefined, SITE)).toBe(SITE);
    expect(resolveAuthRedirectOrigin("javascript:alert(1)", undefined, SITE)).toBe(SITE);
  });
});

describe("isAllowedTokenHashType", () => {
  it("accepts only recovery", () => {
    expect(isAllowedTokenHashType("recovery")).toBe(true);
    expect(isAllowedTokenHashType("signup")).toBe(false);
    expect(isAllowedTokenHashType("magiclink")).toBe(false);
    expect(isAllowedTokenHashType(null)).toBe(false);
  });
});

describe("friendlyLinkError", () => {
  it("maps otp_expired to the expired message and everything else to the generic one", () => {
    expect(friendlyLinkError("otp_expired")).toBe(LINK_EXPIRED_MESSAGE);
    expect(friendlyLinkError("something_else")).toBe(LINK_VERIFY_FAILED_MESSAGE);
    expect(friendlyLinkError(null)).toBe(LINK_VERIFY_FAILED_MESSAGE);
  });
});

describe("rootAuthFallback", () => {
  it("forwards a stray PKCE code at the root to /auth/confirm with next=/reset-password", () => {
    expect(rootAuthFallback(new URL("https://www.educoreafrica.com/?code=abc-123"))).toBe(
      "/auth/confirm?code=abc-123&next=%2Freset-password",
    );
  });

  it("sends an otp_expired error at the root to /login with a friendly message", () => {
    const out = rootAuthFallback(
      new URL("https://www.educoreafrica.com/?error=access_denied&error_code=otp_expired&error_description=x"),
    );
    expect(out).toBe(`/login?error=${encodeURIComponent(LINK_EXPIRED_MESSAGE)}`);
  });

  it("encodes the code so it cannot inject extra params", () => {
    const out = rootAuthFallback(new URL("https://www.educoreafrica.com/?code=a%26next%3D%2Fevil"));
    expect(out).toBe("/auth/confirm?code=a%26next%3D%2Fevil&next=%2Freset-password");
  });

  it("ignores ordinary traffic and any non-root path", () => {
    expect(rootAuthFallback(new URL("https://www.educoreafrica.com/"))).toBeNull();
    expect(rootAuthFallback(new URL("https://www.educoreafrica.com/?utm_source=ads"))).toBeNull();
    expect(rootAuthFallback(new URL("https://www.educoreafrica.com/pricing?code=abc"))).toBeNull();
    expect(rootAuthFallback(new URL("https://www.educoreafrica.com/apply?error_code=x"))).toBeNull();
  });
});
