"use client";

// OS-03 (GTM Readiness Protocol): "download assignments and attachments for
// offline access" -- DoD is "user can choose and reopen downloaded files
// offline." Before this, opening any attachment (task file or a student's
// submission) always required a live network round-trip: a Server Action
// to mint a fresh signed Supabase Storage URL, then fetching that URL --
// both of which fail offline, service worker or not (the service worker in
// public/sw.js only caches page navigations, never Storage bucket bytes).
//
// This stores the actual file bytes in IndexedDB, encrypted at rest with
// the same per-device key OS-10 already set up in crypto.ts (an assignment
// or submission attachment can carry the same kind of personally
// identifiable content as any other offline-cached field, so it gets the
// same treatment). Cleared on logout like `cached_reads` -- see
// clear-on-logout.ts -- since a downloaded file belongs to the session that
// chose to save it, not to whoever signs in on this device next.
//
// Deliberately keyed by `storage_path` (already globally unique -- see
// uploadAssignmentAttachmentAction) rather than a separate id, so callers
// never need to look up "is this file downloaded?" through anything but
// the same identifier they already render with.

import { STORES, idbGetAll, idbDelete } from "./db";
import { putEncrypted, getEncrypted } from "./crypto";

export interface OfflineFileMeta {
  storage_path: string;
  file_name: string;
  content_type: string | null;
  file_size: number | null;
  downloaded_at: number;
}

interface OfflineFileRecord extends OfflineFileMeta {
  /** base64-encoded bytes; encrypted at rest via putEncrypted/getEncrypted. */
  data: string;
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Fetches the file from `url` (a live signed URL) and stores it for offline reopening. */
export async function saveFileForOffline(
  storagePath: string,
  fileName: string,
  contentType: string | null,
  url: string,
): Promise<{ error: string } | { success: true }> {
  try {
    const res = await fetch(url);
    if (!res.ok) return { error: `Download failed (${res.status}).` };
    const buf = await res.arrayBuffer();
    const record: OfflineFileRecord = {
      storage_path: storagePath,
      file_name: fileName,
      content_type: contentType,
      file_size: buf.byteLength,
      downloaded_at: Date.now(),
      data: toBase64(buf),
    };
    await putEncrypted(STORES.offlineFiles, record as unknown as Record<string, unknown>, "data");
    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not save this file for offline access." };
  }
}

/** Returns an object URL for a previously-downloaded file, or undefined if it was never saved. */
export async function openOfflineFile(storagePath: string): Promise<string | undefined> {
  const record = await getEncrypted<OfflineFileRecord & Record<string, unknown>>(STORES.offlineFiles, storagePath, "data");
  if (!record?.data) return undefined;
  const bytes = fromBase64(record.data);
  const blob = new Blob([bytes], { type: record.content_type ?? "application/octet-stream" });
  return URL.createObjectURL(blob);
}

/** Metadata only (no decrypt) -- cheap enough to call per-attachment to show a "Saved offline" state. */
export async function listOfflineFiles(): Promise<OfflineFileMeta[]> {
  const records = await idbGetAll<OfflineFileRecord>(STORES.offlineFiles);
  return records.map(({ storage_path, file_name, content_type, file_size, downloaded_at }) => ({
    storage_path,
    file_name,
    content_type,
    file_size,
    downloaded_at,
  }));
}

export async function removeOfflineFile(storagePath: string): Promise<void> {
  await idbDelete(STORES.offlineFiles, storagePath);
}
