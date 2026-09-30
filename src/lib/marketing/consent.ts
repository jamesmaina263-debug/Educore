// Cookie choice for the public marketing site (and /signup), wired to Google
// Consent Mode so that Google Analytics and Google Ads tags loaded through GTM
// respect it.
//
// Model: notice-and-opt-out. Until a visitor declines, tags behave exactly as
// they did before this module existed (analytics and ad measurement on). A
// visitor who declines is remembered in localStorage; on every later page load
// a tiny inline script (consentDefaultsScript, rendered before GTM) sets
// consent to "denied" before any Google tag runs, and clicking Decline sends
// the same "denied" state to tags that are already loaded. That ordering is the
// whole point: a returning decliner must never get a page_view sent with
// consent granted.
//
// This is deliberately NOT an opt-in (deny-by-default) banner. The site is
// aimed at Kenya only, and default-deny would cut conversion measurement for
// every visitor who ignores the banner, which is what Google Ads bidding
// learns from. If the site ever targets the EU/UK, this needs to become
// opt-in.
//
// Scope: marketing pages and /signup only. GTM never loads inside the
// authenticated app or admin console (see src/app/layout.tsx), and neither
// does anything here.

export const CONSENT_STORAGE_KEY = "educore_cookie_choice";

/** Dispatched by the footer's "Cookie settings" button to re-open the notice. */
export const OPEN_COOKIE_SETTINGS_EVENT = "educore:open-cookie-settings";

export type ConsentChoice = "accepted" | "declined";

export type ConsentState = Record<
  "ad_storage" | "analytics_storage" | "ad_user_data" | "ad_personalization",
  "granted" | "denied"
>;

export function consentStateFor(choice: ConsentChoice): ConsentState {
  const value = choice === "accepted" ? "granted" : "denied";
  return {
    ad_storage: value,
    analytics_storage: value,
    ad_user_data: value,
    ad_personalization: value,
  };
}

export function readConsentChoice(): ConsentChoice | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CONSENT_STORAGE_KEY);
    return raw === "accepted" || raw === "declined" ? raw : null;
  } catch {
    // Storage can throw in some privacy modes; treat as "no choice recorded".
    return null;
  }
}

// Tiny external-store wrapper so React components can read the choice with
// useSyncExternalStore (server render: nothing; browser: the stored choice)
// instead of setting state from an effect.
const listeners = new Set<() => void>();

export function subscribeToConsent(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** "unset" = the visitor has not chosen yet. */
export function getConsentSnapshot(): ConsentChoice | "unset" {
  return readConsentChoice() ?? "unset";
}

/** Used during server render / hydration, before localStorage can be read. */
export function getServerConsentSnapshot(): "server" {
  return "server";
}

export function writeConsentChoice(choice: ConsentChoice) {
  try {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, choice);
  } catch {
    // Not persisted: the notice simply shows again next visit.
  }
  listeners.forEach((listener) => listener());
}

type DataLayerWindow = Window & { dataLayer?: unknown[] };

// GTM only treats a dataLayer entry as a gtag-style command (e.g. "consent")
// when it is a real Arguments object, not an array, so build one.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function asArguments(..._args: unknown[]): IArguments {
  // eslint-disable-next-line prefer-rest-params
  return arguments;
}

/**
 * Sends a Consent Mode "update" to any Google tag already loaded, or queues it
 * for GTM to read when it loads.
 */
export function pushConsentUpdate(choice: ConsentChoice) {
  if (typeof window === "undefined") return;
  const w = window as DataLayerWindow;
  w.dataLayer = w.dataLayer || [];
  const state = consentStateFor(choice);
  w.dataLayer.push(asArguments("consent", "update", state));
}

// Cookies Google's tags set on this site. After a decline the tags stop
// reading and writing them, but a cookie set earlier would otherwise sit in
// the browser, so clear the ones we know about (best effort).
const GOOGLE_COOKIE_RE = /^(_ga|_gid|_gcl|_gac|FPLC)/;

export function clearGoogleCookies() {
  if (typeof document === "undefined") return;
  const names = document.cookie
    .split(";")
    .map((c) => c.split("=")[0]?.trim() ?? "")
    .filter((name) => GOOGLE_COOKIE_RE.test(name));
  if (names.length === 0) return;

  // GA sets cookies on the registrable domain, so try every suffix of the host.
  const labels = window.location.hostname.split(".");
  const domains: string[] = [];
  for (let i = 0; i <= labels.length - 2; i++) {
    const d = labels.slice(i).join(".");
    domains.push(d, `.${d}`);
  }

  const expired = "expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
  for (const name of names) {
    document.cookie = `${name}=; ${expired}`;
    for (const domain of domains) {
      document.cookie = `${name}=; ${expired}; domain=${domain}`;
    }
  }
}

/**
 * Inline script rendered BEFORE <GoogleTagManager>. Does nothing unless the
 * visitor previously declined, in which case it queues consent "default:
 * denied" so GTM applies it before any tag fires. Built from the same
 * constants as the rest of this module so the two cannot drift. Contains no
 * user-controlled data.
 */
export function consentDefaultsScript(): string {
  const denied = JSON.stringify(consentStateFor("declined"));
  const key = JSON.stringify(CONSENT_STORAGE_KEY);
  return (
    `(function(){try{` +
    `if(window.localStorage.getItem(${key})!=="declined")return;` +
    `window.dataLayer=window.dataLayer||[];` +
    `window.dataLayer.push((function(){return arguments})("consent","default",${denied}));` +
    `}catch(e){}})();`
  );
}
