// Caches a paired kiosk's roster in the SAME `cached_reads` IndexedDB store
// every other module's read side already uses (see db.ts) -- "last-known-
// good server data, saved opportunistically while online, so a module's
// read side can still render something useful while offline instead of an
// empty/error state." This is the first real use of that store; nothing
// about it needed to change.
//
// Scoped per device (not per school/user, since a kiosk has no Supabase
// Auth session to scope by) so pairing a second device on the same
// physical machine -- unlikely, but not impossible during setup -- can't
// show one device's roster under another's key.

import { STORES } from "@/lib/offline/db";
import { getEncrypted, putEncrypted } from "@/lib/offline/crypto";
import type { RosterEntry } from "./kiosk-client";

interface CachedRoster {
  deviceName: string;
  roster: RosterEntry[];
  cached_at: string;
}

function cacheKey(deviceKeyPrefix: string): string {
  return `biometric-kiosk:roster:${deviceKeyPrefix}`;
}

/** deviceKeyPrefix is the "bio_xxxxxxxx" portion only (before the dot) -- never the secret half, in case this cache is ever inspected. */
export function devicePrefixOf(deviceKey: string): string {
  return deviceKey.split(".")[0] ?? deviceKey;
}

export async function cacheRoster(deviceKey: string, deviceName: string, roster: RosterEntry[]): Promise<void> {
  const value: CachedRoster = { deviceName, roster, cached_at: new Date().toISOString() };
  // OS-10: `value` is encrypted at rest -- exactly the sensitive data (student names tied to a
  // paired kiosk device) that motivated encrypting cached_reads in the first place.
  await putEncrypted(STORES.cachedReads, { key: cacheKey(devicePrefixOf(deviceKey)), value: JSON.stringify(value) }, "value");
}

export async function getCachedRoster(deviceKey: string): Promise<CachedRoster | null> {
  try {
    const row = await getEncrypted<{ key: string; value: string }>(STORES.cachedReads, cacheKey(devicePrefixOf(deviceKey)), "value");
    if (!row?.value) return null;
    return JSON.parse(row.value) as CachedRoster;
  } catch {
    return null;
  }
}
