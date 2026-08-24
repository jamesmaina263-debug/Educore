// Tiny external store for the paired device key, read via
// useSyncExternalStore in the kiosk page. This (not a useEffect +
// setState-on-mount) is the React-recommended way to read a browser-only
// source like localStorage without a hydration-mismatch render: React
// calls getServerSnapshot() during the server/first-client render (always
// null, since there's nothing to read yet) and getSnapshot() after,
// reconciling any difference itself -- no separate "hydrated" boolean or
// extra effect-triggered render needed.
//
// A same-tab localStorage.setItem()/removeItem() call does not fire the
// browser's "storage" event in that same tab (only in *other* tabs), so
// pairing/unpairing goes through setDeviceKey() below, which updates the
// in-memory value and notifies this store's own subscribers directly --
// not through the storage event, which stays only for cross-tab awareness.

const STORAGE_KEY = "educore_biometric_device_key";

let cachedKey: string | null = null;
let initialized = false;
const listeners = new Set<() => void>();

function ensureInitialized() {
  if (initialized || typeof window === "undefined") return;
  cachedKey = window.localStorage.getItem(STORAGE_KEY);
  initialized = true;
}

export function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) {
      cachedKey = e.newValue;
      callback();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(callback);
    window.removeEventListener("storage", onStorage);
  };
}

export function getSnapshot(): string | null {
  ensureInitialized();
  return cachedKey;
}

export function getServerSnapshot(): string | null {
  return null;
}

export function setDeviceKey(key: string | null): void {
  ensureInitialized();
  cachedKey = key;
  if (typeof window !== "undefined") {
    if (key) window.localStorage.setItem(STORAGE_KEY, key);
    else window.localStorage.removeItem(STORAGE_KEY);
  }
  listeners.forEach((cb) => cb());
}
