import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

import * as Sentry from "@sentry/nextjs";
import { reportServerError } from "./report-server-error";

describe("reportServerError", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("logs a structured JSON line with the action, school, and user", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    reportServerError(new Error("insert failed"), {
      action: "finance.recordPayment",
      schoolId: "school-123",
      userId: "user-456",
      extra: { invoice_id: "inv-1" },
    });

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(consoleSpy.mock.calls[0][0] as string);
    expect(logged.action).toBe("finance.recordPayment");
    expect(logged.school_id).toBe("school-123");
    expect(logged.user_id).toBe("user-456");
    expect(logged.message).toBe("insert failed");
    expect(logged.extra).toEqual({ invoice_id: "inv-1" });
  });

  it("forwards to Sentry.captureException with tags and user set", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("boom");

    reportServerError(error, { action: "health.logVisit", schoolId: "school-9", userId: "user-9" });

    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    const [reportedError, context] = vi.mocked(Sentry.captureException).mock.calls[0];
    expect(reportedError).toBe(error);
    expect(context).toMatchObject({
      tags: { action: "health.logVisit", school_id: "school-9" },
      user: { id: "user-9" },
    });
  });

  it("wraps a non-Error thrown value in an Error before reporting", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    reportServerError("plain string failure", { action: "attendance.mark" });

    const [reportedError] = vi.mocked(Sentry.captureException).mock.calls[0];
    expect(reportedError).toBeInstanceOf(Error);
    expect((reportedError as Error).message).toBe("plain string failure");
  });

  it("never throws even if Sentry.captureException itself throws", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(Sentry.captureException).mockImplementation(() => {
      throw new Error("sentry down");
    });

    expect(() => reportServerError(new Error("x"), { action: "y" })).not.toThrow();
  });

  it("omits school_id tag and user when not provided", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    reportServerError(new Error("no context"), { action: "misc.action" });

    const [, context] = vi.mocked(Sentry.captureException).mock.calls[0];
    expect(context).toMatchObject({ tags: { action: "misc.action" } });
    expect((context as { tags: Record<string, unknown> }).tags.school_id).toBeUndefined();
    expect((context as { user?: unknown }).user).toBeUndefined();
  });
});
