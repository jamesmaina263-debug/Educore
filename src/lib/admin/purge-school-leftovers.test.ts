import { describe, expect, it, vi } from "vitest";
import { isUuid, removeLoginAccounts, removeSchoolFiles, type PurgeClient } from "./purge-school-leftovers";

const SCHOOL = "11111111-1111-4111-8111-111111111111";

type Tree = Record<string, { name: string; id: string | null }[]>;

function fakeClient(tree: Tree, opts: { buckets?: string[]; removeError?: string; deleteUser?: (id: string) => { error: { message: string } | null } } = {}) {
  const removed: string[] = [];
  const client: PurgeClient = {
    storage: {
      listBuckets: async () => ({ data: (opts.buckets ?? ["docs"]).map((n) => ({ id: n, name: n })), error: null }),
      from: (bucket: string) => ({
        list: async (path: string) => ({ data: tree[`${bucket}:${path}`] ?? [], error: null }),
        remove: async (paths: string[]) => {
          if (opts.removeError) return { data: null, error: { message: opts.removeError } };
          removed.push(...paths.map((p) => `${bucket}:${p}`));
          return { data: null, error: null };
        },
      }),
    },
    auth: { admin: { deleteUser: async (id: string) => (opts.deleteUser ? opts.deleteUser(id) : { error: null }) } },
  };
  return { client, removed };
}

describe("isUuid", () => {
  it("accepts uuids and rejects path-like or empty values", () => {
    expect(isUuid(SCHOOL)).toBe(true);
    expect(isUuid("")).toBe(false);
    expect(isUuid("../other")).toBe(false);
    expect(isUuid(`${SCHOOL}/x`)).toBe(false);
    expect(isUuid(null)).toBe(false);
  });
});

describe("removeSchoolFiles", () => {
  it("walks nested folders and removes only files under the school's own prefix", async () => {
    const { client, removed } = fakeClient({
      [`docs:${SCHOOL}`]: [{ name: "logo.png", id: "f1" }, { name: "students", id: null }],
      [`docs:${SCHOOL}/students`]: [{ name: "s1", id: null }],
      [`docs:${SCHOOL}/students/s1`]: [{ name: "birth.pdf", id: "f2" }],
    });
    const res = await removeSchoolFiles(client, SCHOOL);
    expect(res).toEqual({ filesRemoved: 2, bucketsChecked: 1, failures: [] });
    expect(removed.sort()).toEqual([`docs:${SCHOOL}/logo.png`, `docs:${SCHOOL}/students/s1/birth.pdf`].sort());
  });

  it("checks every bucket and reports a failing one without stopping the rest", async () => {
    const { client } = fakeClient({ [`a:${SCHOOL}`]: [{ name: "x", id: "1" }], [`b:${SCHOOL}`]: [] }, { buckets: ["a", "b"], removeError: "boom" });
    const res = await removeSchoolFiles(client, SCHOOL);
    expect(res.bucketsChecked).toBe(2);
    expect(res.filesRemoved).toBe(0);
    expect(res.failures).toEqual(["a: boom"]);
  });

  it("with an allow-list, touches ONLY the listed buckets (trial reset must never empty logos or staff documents)", async () => {
    const { client, removed } = fakeClient(
      {
        [`application-documents:${SCHOOL}`]: [{ name: "a.pdf", id: "1" }],
        [`school-logos:${SCHOOL}`]: [{ name: "logo.png", id: "2" }],
        [`staff-documents:${SCHOOL}`]: [{ name: "cv.pdf", id: "3" }],
      },
      { buckets: ["application-documents", "school-logos", "staff-documents"] },
    );
    const res = await removeSchoolFiles(client, SCHOOL, ["application-documents"]);
    expect(res).toEqual({ filesRemoved: 1, bucketsChecked: 1, failures: [] });
    expect(removed).toEqual([`application-documents:${SCHOOL}/a.pdf`]);
  });

  it("an empty allow-list touches nothing", async () => {
    const { client, removed } = fakeClient({ [`docs:${SCHOOL}`]: [{ name: "x", id: "1" }] });
    const res = await removeSchoolFiles(client, SCHOOL, []);
    expect(res).toEqual({ filesRemoved: 0, bucketsChecked: 0, failures: [] });
    expect(removed).toEqual([]);
  });

  it("refuses a non-uuid id so a bad value can never become a wide prefix", async () => {
    const listBuckets = vi.fn();
    const res = await removeSchoolFiles({ storage: { listBuckets } } as unknown as PurgeClient, "");
    expect(res.failures).toHaveLength(1);
    expect(listBuckets).not.toHaveBeenCalled();
  });
});

describe("removeLoginAccounts", () => {
  const U1 = "22222222-2222-4222-8222-222222222222";
  const U2 = "33333333-3333-4333-8333-333333333333";

  it("deletes each account and reports individual failures", async () => {
    const { client } = fakeClient({}, { deleteUser: (id) => (id === U2 ? { error: { message: "referenced" } } : { error: null }) });
    const res = await removeLoginAccounts(client, [U1, U2]);
    expect(res.removed).toBe(1);
    expect(res.failures).toEqual([`${U2}: referenced`]);
  });

  it("skips anything that is not a uuid and tolerates a non-array", async () => {
    const { client } = fakeClient({});
    expect((await removeLoginAccounts(client, ["nope", U1])).removed).toBe(1);
    expect(await removeLoginAccounts(client, undefined)).toEqual({ removed: 0, failures: [] });
  });
});
