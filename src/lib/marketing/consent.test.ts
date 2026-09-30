import vm from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CONSENT_STORAGE_KEY,
  clearGoogleCookies,
  consentDefaultsScript,
  consentStateFor,
  getConsentSnapshot,
  pushConsentUpdate,
  readConsentChoice,
  subscribeToConsent,
  writeConsentChoice,
} from "./consent";

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

// Runs the inline script exactly as a browser would, in an isolated context.
function runDefaultsScript(localStorage: unknown) {
  const sandbox: Record<string, unknown> = { localStorage };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(consentDefaultsScript(), sandbox);
  return sandbox.dataLayer as unknown[] | undefined;
}

const isArgumentsObject = (v: unknown) => Object.prototype.toString.call(v) === "[object Arguments]";

afterEach(() => vi.unstubAllGlobals());

describe("consentDefaultsScript (runs before GTM)", () => {
  it("queues consent default=denied as a gtag Arguments object for a returning decliner", () => {
    const layer = runDefaultsScript(fakeStorage({ [CONSENT_STORAGE_KEY]: "declined" }));
    expect(layer).toHaveLength(1);
    expect(isArgumentsObject(layer![0])).toBe(true);
    const [command, action, state] = Array.from(layer![0] as ArrayLike<unknown>);
    expect(command).toBe("consent");
    expect(action).toBe("default");
    expect(state).toEqual({
      ad_storage: "denied",
      analytics_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
    });
  });

  it("does nothing for a visitor who accepted or has not chosen, so tracking is unchanged", () => {
    expect(runDefaultsScript(fakeStorage({ [CONSENT_STORAGE_KEY]: "accepted" }))).toBeUndefined();
    expect(runDefaultsScript(fakeStorage())).toBeUndefined();
  });

  it("never throws if storage is unavailable", () => {
    const blocked = {
      getItem() {
        throw new Error("blocked");
      },
    };
    expect(() => runDefaultsScript(blocked)).not.toThrow();
  });

  it("is a fixed constant: no request, URL or user-supplied data is interpolated", () => {
    expect(consentDefaultsScript()).toBe(
      '(function(){try{if(window.localStorage.getItem("educore_cookie_choice")!=="declined")return;' +
        "window.dataLayer=window.dataLayer||[];" +
        'window.dataLayer.push((function(){return arguments})("consent","default",' +
        '{"ad_storage":"denied","analytics_storage":"denied","ad_user_data":"denied","ad_personalization":"denied"}));' +
        "}catch(e){}})();",
    );
  });
});

describe("choice storage", () => {
  it("round-trips accepted/declined and ignores unknown values", () => {
    vi.stubGlobal("window", { localStorage: fakeStorage() });
    expect(readConsentChoice()).toBeNull();
    writeConsentChoice("declined");
    expect(readConsentChoice()).toBe("declined");
    writeConsentChoice("accepted");
    expect(readConsentChoice()).toBe("accepted");
    vi.stubGlobal("window", { localStorage: fakeStorage({ [CONSENT_STORAGE_KEY]: "maybe" }) });
    expect(readConsentChoice()).toBeNull();
  });

  it("notifies subscribers when the choice changes and reports 'unset' before a choice", () => {
    vi.stubGlobal("window", { localStorage: fakeStorage() });
    const listener = vi.fn();
    const unsubscribe = subscribeToConsent(listener);
    expect(getConsentSnapshot()).toBe("unset");
    writeConsentChoice("declined");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getConsentSnapshot()).toBe("declined");
    unsubscribe();
    writeConsentChoice("accepted");
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("pushConsentUpdate", () => {
  it("pushes a gtag-style consent update for each choice", () => {
    const win: { dataLayer?: unknown[] } = {};
    vi.stubGlobal("window", win);
    pushConsentUpdate("declined");
    pushConsentUpdate("accepted");
    expect(win.dataLayer).toHaveLength(2);
    const [declined, accepted] = win.dataLayer!.map((e) => Array.from(e as ArrayLike<unknown>));
    expect(win.dataLayer!.every(isArgumentsObject)).toBe(true);
    expect(declined).toEqual(["consent", "update", consentStateFor("declined")]);
    expect(accepted).toEqual(["consent", "update", consentStateFor("accepted")]);
  });
});

describe("clearGoogleCookies", () => {
  it("expires only Google's cookies, on the host and its parent domains", () => {
    const writes: string[] = [];
    vi.stubGlobal("window", { location: { hostname: "www.educoreafrica.com" } });
    vi.stubGlobal("document", {
      get cookie() {
        return "_ga=GA1.1.1; _ga_ABC123=GS1; _gcl_au=1.1; session=keep; theme=dark";
      },
      set cookie(value: string) {
        writes.push(value);
      },
    });
    clearGoogleCookies();
    const names = new Set(writes.map((w) => w.split("=")[0]));
    expect(names).toEqual(new Set(["_ga", "_ga_ABC123", "_gcl_au"]));
    expect(writes.some((w) => w.includes("domain=.educoreafrica.com"))).toBe(true);
    expect(writes.every((w) => w.includes("expires=Thu, 01 Jan 1970"))).toBe(true);
  });

  it("does nothing when there are no Google cookies", () => {
    const writes: string[] = [];
    vi.stubGlobal("window", { location: { hostname: "educoreafrica.com" } });
    vi.stubGlobal("document", {
      get cookie() {
        return "session=keep";
      },
      set cookie(value: string) {
        writes.push(value);
      },
    });
    clearGoogleCookies();
    expect(writes).toEqual([]);
  });
});
