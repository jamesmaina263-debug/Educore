import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";

async function freshModules() {
  vi.resetModules();
  const dbMod = await import("./db");
  const downloadsMod = await import("./downloads");
  return { dbMod, downloadsMod };
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  vi.restoreAllMocks();
});

describe("OS-03 offline attachment downloads", () => {
  it("saves a fetched file and reopens it later as a usable object URL", async () => {
    const { downloadsMod } = await freshModules();
    const fileBytes = new TextEncoder().encode("worksheet contents");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () => fileBytes.buffer,
      }),
    );

    const saveRes = await downloadsMod.saveFileForOffline(
      "school1/assign1/task/worksheet.pdf",
      "worksheet.pdf",
      "application/pdf",
      "https://signed.example/worksheet.pdf",
    );
    expect(saveRes).toEqual({ success: true });

    const objectUrl = await downloadsMod.openOfflineFile("school1/assign1/task/worksheet.pdf");
    expect(objectUrl).toMatch(/^blob:/);
  });

  it("returns undefined for a file that was never downloaded", async () => {
    const { downloadsMod } = await freshModules();
    const objectUrl = await downloadsMod.openOfflineFile("never/saved.pdf");
    expect(objectUrl).toBeUndefined();
  });

  it("stores the file bytes encrypted, not as plaintext base64, in IndexedDB", async () => {
    const { dbMod, downloadsMod } = await freshModules();
    const fileBytes = new TextEncoder().encode("a guardian should not see this as plaintext on disk");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => fileBytes.buffer }),
    );
    await downloadsMod.saveFileForOffline("school1/private.pdf", "private.pdf", "application/pdf", "https://signed.example/private.pdf");

    const raw = await dbMod.idbGet<{ data: unknown }>(dbMod.STORES.offlineFiles, "school1/private.pdf");
    // Encrypted shape is {__enc: true, iv, ct} -- never the plaintext base64 string itself.
    expect(typeof raw?.data).not.toBe("string");
    expect(JSON.stringify(raw)).not.toContain("guardian should not see this");
  });

  it("lists downloaded files without needing to decrypt their contents", async () => {
    const { downloadsMod } = await freshModules();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new TextEncoder().encode("x").buffer }),
    );
    await downloadsMod.saveFileForOffline("a.pdf", "A.pdf", "application/pdf", "https://x/a.pdf");
    await downloadsMod.saveFileForOffline("b.pdf", "B.pdf", "application/pdf", "https://x/b.pdf");

    const files = await downloadsMod.listOfflineFiles();
    expect(files.map((f) => f.file_name).sort()).toEqual(["A.pdf", "B.pdf"]);
  });

  it("removes a downloaded file", async () => {
    const { downloadsMod } = await freshModules();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new TextEncoder().encode("x").buffer }),
    );
    await downloadsMod.saveFileForOffline("a.pdf", "A.pdf", "application/pdf", "https://x/a.pdf");
    await downloadsMod.removeOfflineFile("a.pdf");
    expect(await downloadsMod.openOfflineFile("a.pdf")).toBeUndefined();
  });

  it("surfaces a network failure instead of silently storing nothing", async () => {
    const { downloadsMod } = await freshModules();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    const res = await downloadsMod.saveFileForOffline("missing.pdf", "missing.pdf", null, "https://x/missing.pdf");
    expect(res).toEqual({ error: "Download failed (404)." });
  });
});
