import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendSecurityAlert } from "./security-alert";

describe("sendSecurityAlert", () => {
  const originalEnv = process.env.SECURITY_ALERT_WEBHOOK_URL;
  const originalFetch = global.fetch;

  afterEach(() => {
    process.env.SECURITY_ALERT_WEBHOOK_URL = originalEnv;
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("does nothing (no fetch call) when the webhook URL isn't configured", async () => {
    delete process.env.SECURITY_ALERT_WEBHOOK_URL;
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    await sendSecurityAlert("Test event", { foo: "bar" });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("posts to the configured webhook with the event and details", async () => {
    process.env.SECURITY_ALERT_WEBHOOK_URL = "https://hooks.slack.test/webhook";
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchSpy as unknown as typeof fetch;

    await sendSecurityAlert("Login rate limit tripped", { ip: "1.2.3.4" });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://hooks.slack.test/webhook");
    const body = JSON.parse(init.body);
    expect(body.text).toContain("Login rate limit tripped");
    expect(body.text).toContain("1.2.3.4");
  });

  it("never throws when the fetch call fails", async () => {
    process.env.SECURITY_ALERT_WEBHOOK_URL = "https://hooks.slack.test/webhook";
    global.fetch = vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;

    await expect(sendSecurityAlert("Some event", {})).resolves.toBeUndefined();
  });
});
