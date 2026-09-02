"use client";

// OS-10 (GTM Readiness Protocol): on-device encryption for the two generic
// IndexedDB stores in db.ts. `pending_mutations`.payload and
// `cached_reads`.value are the two fields that actually carry PII while a
// device is offline -- student/guardian identity details, health records,
// biometric roster entries, admissions data -- everything else in those
// records (id, module, type, queued_at, status, the cache key) is routing
// metadata, left as plaintext on purpose so it stays queryable (e.g. the
// `by_module` index).
//
// Key management: a single AES-GCM 256 key, generated once per device,
// generated non-extractable (Web Crypto's `extractable: false`) so the raw
// key bytes can never be read out of the browser via JS -- only usable
// in-place by crypto.subtle.encrypt/decrypt. Stored as a CryptoKey object
// directly in its own IndexedDB store (`device_key`); browsers
// structured-clone CryptoKey objects fine regardless of extractability --
// only exportKey() is blocked, which is exactly the property that matters
// here (nothing, including this app's own code, can get the raw bytes back
// out).
//
// Deliberately NOT cleared on logout, unlike the rest of clearOfflineCaches
// (see clear-on-logout.ts): `pending_mutations` is deliberately preserved
// across a sign-out so a queued-but-not-yet-synced offline write still
// syncs correctly the next time anyone with the right permissions signs in
// -- destroying the key on logout would make that data permanently
// undecryptable instead, silently losing real queued work (e.g. attendance
// marked offline, not yet synced). The actual threat this protects against
// -- someone extracting the raw browser storage files off the device --
// is covered either way, since the key is non-extractable and only ever
// usable from inside this browser profile.

import { idbGet as idbGetRaw, idbGetAll as idbGetAllRaw, idbGetAllByIndex as idbGetAllByIndexRaw, idbPut as idbPutRaw } from "./db";

const KEY_STORE = "device_key";
const KEY_RECORD_ID = "device-aes-key";

let cachedKey: Promise<CryptoKey> | null = null;

async function getDeviceKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  cachedKey = (async () => {
    const existing = await idbGetRaw<{ id: string; key: CryptoKey }>(KEY_STORE, KEY_RECORD_ID);
    if (existing?.key) return existing.key;
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    await idbPutRaw(KEY_STORE, { id: KEY_RECORD_ID, key });
    return key;
  })();
  return cachedKey;
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunkSize = 0x8000; // avoid a call-stack blowup from spreading a huge array into String.fromCharCode
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

interface EncryptedField {
  __enc: true;
  iv: string;
  ct: string;
}

function isEncryptedField(value: unknown): value is EncryptedField {
  return typeof value === "object" && value !== null && (value as { __enc?: unknown }).__enc === true;
}

async function encryptValue(value: unknown): Promise<EncryptedField> {
  const key = await getDeviceKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  return { __enc: true, iv: toBase64(iv.buffer), ct: toBase64(ciphertext) };
}

/** Returns undefined (never throws) on failure, so one corrupted/undecryptable record can't take
 * down reading the rest of a batch -- callers below already handle a missing field gracefully
 * (e.g. syncPendingMutations skips a mutation with no registered handler either way). */
async function decryptValue<T>(enc: EncryptedField): Promise<T | undefined> {
  try {
    const key = await getDeviceKey();
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(enc.iv) }, key, fromBase64(enc.ct));
    return JSON.parse(new TextDecoder().decode(plaintext)) as T;
  } catch {
    return undefined;
  }
}

async function decryptRecordField<T extends Record<string, unknown>>(record: T, field: keyof T): Promise<T> {
  const current = record[field];
  // Not the {__enc:true,...} shape -> either already plaintext (a mutation queued by a version of
  // the app that predates this change) or a field genuinely absent. Either way, nothing to do --
  // return as-is rather than guessing, same backward-compatibility stance as OS-09's base snapshot.
  if (!isEncryptedField(current)) return record;
  const decrypted = await decryptValue(current);
  return { ...record, [field]: decrypted };
}

/** Like idbPut, but encrypts `field` on the record first. */
export async function putEncrypted<T extends Record<string, unknown>>(store: string, record: T, field: keyof T): Promise<void> {
  const encryptedField = await encryptValue(record[field]);
  await idbPutRaw(store, { ...record, [field]: encryptedField });
}

/** Like idbGet, but decrypts `field` on the way out. */
export async function getEncrypted<T extends Record<string, unknown>>(store: string, key: IDBValidKey, field: keyof T): Promise<T | undefined> {
  const record = await idbGetRaw<T>(store, key);
  if (!record) return record;
  return decryptRecordField(record, field);
}

/** Like idbGetAll, but decrypts `field` on every record. */
export async function getAllEncrypted<T extends Record<string, unknown>>(store: string, field: keyof T): Promise<T[]> {
  const records = await idbGetAllRaw<T>(store);
  return Promise.all(records.map((r) => decryptRecordField(r, field)));
}

/** Like idbGetAllByIndex, but decrypts `field` on every record. */
export async function getAllByIndexEncrypted<T extends Record<string, unknown>>(
  store: string,
  indexName: string,
  value: IDBValidKey,
  field: keyof T,
): Promise<T[]> {
  const records = await idbGetAllByIndexRaw<T>(store, indexName, value);
  return Promise.all(records.map((r) => decryptRecordField(r, field)));
}
