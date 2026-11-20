import { afterEach, describe, expect, it, vi } from "vitest";

import { EngineLoadError } from "./errors.ts";
import { browserName, browserSupport, isVerifiedBrowser } from "./support.ts";
import { adapterFallbackAllowed, browserEngineEnabled, currentEngineVersion, engineTransport } from "./transport.ts";

const UA = {
  chrome: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36",
  edge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36 Edg/153.0.0.0",
  firefox: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0",
  safari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  iphoneChrome: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/153.0.0.0 Mobile/15E148 Safari/604.1",
  androidChrome: "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36",
};

afterEach(() => vi.unstubAllGlobals());

describe("which browsers the alpha is checked on", () => {
  it("names the browser from its user agent", () => {
    expect(browserName(UA.chrome)).toBe("Chrome");
    expect(browserName(UA.edge)).toBe("Edge");
    expect(browserName(UA.firefox)).toBe("Firefox");
    expect(browserName(UA.safari)).toBe("Safari");
    expect(browserName(UA.iphoneChrome)).toBe("Safari"); // Chrome on iOS is WebKit underneath
    expect(browserName("")).toBe("this browser");
  });
  it("only Chrome and Edge (V8) count as checked, phones included except on iOS", () => {
    expect(isVerifiedBrowser(UA.chrome)).toBe(true);
    expect(isVerifiedBrowser(UA.edge)).toBe(true);
    expect(isVerifiedBrowser(UA.androidChrome)).toBe(true);
    expect(isVerifiedBrowser(UA.firefox)).toBe(false);
    expect(isVerifiedBrowser(UA.safari)).toBe(false);
    expect(isVerifiedBrowser(UA.iphoneChrome)).toBe(false);
  });
  it("lists what a browser lacks, in words a player can use", () => {
    const none = browserSupport({} as never);
    expect(none.missing.join(" ")).toMatch(/Web Workers/);
    expect(none.missing.join(" ")).toMatch(/Cache Storage/);
    expect(none.missing.join(" ")).toMatch(/checksum/);
    const all = browserSupport({ Worker: class {}, Blob, URL, caches: {}, crypto: { subtle: {} } } as never);
    expect(all.missing).toEqual([]);
  });
});

describe("whether new play uses the browser engine", () => {
  const page = (search: string, stored: string | null = null, hostname = "example.com") => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("document", {});
    vi.stubGlobal("location", { search, hostname });
    vi.stubGlobal("localStorage", { getItem: () => stored });
  };
  it("is the default wherever there is a page", () => {
    page("");
    expect(browserEngineEnabled()).toBe(true);
  });
  it("is not used with no page (the unit tests, headless tools): the adapter path stands", () => {
    expect(browserEngineEnabled()).toBe(false);
  });
  it("can be chosen either way with the address or the stored choice, the address first", () => {
    page("?engine=adapter");
    expect(browserEngineEnabled()).toBe(false);
    page("", "0");
    expect(browserEngineEnabled()).toBe(false);
    page("?engine=browser", "0");
    expect(browserEngineEnabled()).toBe(true);
    page("?engine=adapter", "1");
    expect(browserEngineEnabled()).toBe(false);
  });
  it("blocked storage falls to the default", () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("document", {});
    vi.stubGlobal("location", { search: "" });
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); } });
    expect(browserEngineEnabled()).toBe(true);
  });
});

describe("the local adapter is only ever looked for on a developer's own machine", () => {
  const loadError = new EngineLoadError("manifest", "The game engine couldn't be found.", true);
  const failing = { call: () => Promise.reject(loadError) } as never;

  it("on a deployed page a failure to start is the answer; the adapter is never tried", async () => {
    vi.stubGlobal("location", { hostname: "wentz.example.com" });
    const adapter = vi.fn(() => Promise.resolve({ ok: true }));
    expect(adapterFallbackAllowed()).toBe(false);
    await expect(engineTransport(failing, adapter)("/x", {})).rejects.toBe(loadError);
    expect(adapter).not.toHaveBeenCalled();
  });
  it("on localhost the adapter answers when the engine files are not there", async () => {
    vi.stubGlobal("location", { hostname: "localhost" });
    const adapter = vi.fn(() => Promise.resolve({ from: "adapter" }));
    await expect(engineTransport(failing, adapter)("/x", {})).resolves.toEqual({ from: "adapter" });
  });
  it("on localhost with no adapter either, the browser engine's own error is the one shown", async () => {
    vi.stubGlobal("location", { hostname: "127.0.0.1" });
    const adapter = vi.fn(() => Promise.reject(new Error("connection refused")));
    await expect(engineTransport(failing, adapter)("/x", {})).rejects.toBe(loadError);
  });
  it("an engine that ran and refused a request is not a reason to ask the adapter", async () => {
    vi.stubGlobal("location", { hostname: "localhost" });
    const refusal = new Error("route failed");
    const adapter = vi.fn();
    await expect(engineTransport({ call: () => Promise.reject(refusal) } as never, adapter)("/x", {})).rejects.toBe(refusal);
    expect(adapter).not.toHaveBeenCalled();
  });
  it("the version to record is the browser engine's; none when only the adapter answered; an error when nothing did", async () => {
    vi.stubGlobal("location", { hostname: "wentz.example.com" });
    await expect(currentEngineVersion({ ensureReady: () => Promise.resolve({ engineVersion: "abc" }) } as never)).resolves.toBe("abc");
    await expect(currentEngineVersion({ ensureReady: () => Promise.reject(loadError) } as never)).rejects.toBe(loadError);
  });
});
