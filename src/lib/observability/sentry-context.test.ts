import { beforeEach, describe, expect, it, vi } from "vitest";

const setUser = vi.fn();
const setTag = vi.fn();
vi.mock("@sentry/nextjs", () => ({ setUser: (...a: unknown[]) => setUser(...a), setTag: (...a: unknown[]) => setTag(...a) }));

import { tagSentryRequestContext } from "./sentry-context";

type Client = Parameters<typeof tagSentryRequestContext>[0];

function fakeClient(opts: { session: unknown; userId?: string; schoolId?: string | null; getSessionThrows?: boolean }) {
  const rpc = vi.fn().mockResolvedValue({ data: opts.schoolId ?? null, error: null });
  const getUser = vi.fn().mockResolvedValue({ data: { user: opts.userId ? { id: opts.userId } : null } });
  const getSession = opts.getSessionThrows
    ? vi.fn().mockRejectedValue(new Error("boom"))
    : vi.fn().mockResolvedValue({ data: { session: opts.session } });
  return { client: { auth: { getSession, getUser }, rpc } as unknown as Client, rpc, getUser };
}

describe("tagSentryRequestContext", () => {
  beforeEach(() => {
    setUser.mockClear();
    setTag.mockClear();
  });

  it("makes NO auth_school_id call when there is no session (login, signup, expired session)", async () => {
    const { client, rpc, getUser } = fakeClient({ session: null });
    await tagSentryRequestContext(client);
    expect(rpc).not.toHaveBeenCalled();
    expect(getUser).not.toHaveBeenCalled();
    expect(setUser).not.toHaveBeenCalled();
    expect(setTag).not.toHaveBeenCalled();
  });

  it("tags the user and school when a session exists", async () => {
    const { client, rpc } = fakeClient({ session: { access_token: "t" }, userId: "u1", schoolId: "s1" });
    await tagSentryRequestContext(client);
    expect(rpc).toHaveBeenCalledWith("auth_school_id");
    expect(setUser).toHaveBeenCalledWith({ id: "u1" });
    expect(setTag).toHaveBeenCalledWith("school_id", "s1");
  });

  it("never throws into the calling action", async () => {
    const { client } = fakeClient({ session: null, getSessionThrows: true });
    await expect(tagSentryRequestContext(client)).resolves.toBeUndefined();
  });
});
