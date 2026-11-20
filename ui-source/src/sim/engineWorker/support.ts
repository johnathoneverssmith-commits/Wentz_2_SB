/**
 * What this browser can do for the in-browser simulation engine, and how far we have checked it.
 *
 * The first alpha is checked on Chrome and Edge. Firefox and Safari are not: the engine's maths is
 * implementation-defined in its last bits, and only V8 (Chrome, Edge, Node) has been compared against the
 * Node adapter. They are not blocked, but the player is told.
 */
export interface BrowserSupport {
  /** what the engine needs and this browser lacks; empty = it can run */
  missing: string[];
  /** the browser the first alpha was checked on (Chrome or Edge, i.e. V8) */
  verified: boolean;
  /** "Chrome", "Edge", "Firefox", "Safari" or "this browser" */
  name: string;
}

export function browserName(ua: string = globalThis.navigator?.userAgent ?? ""): string {
  if (/\bEdg(e|A|iOS)?\//.test(ua)) return "Edge";
  if (/\bFirefox\/|\bFxiOS\//.test(ua)) return "Firefox";
  if (/\bCriOS\//.test(ua)) return "Safari"; // Chrome on iOS is WebKit underneath
  if (/\bChrome\//.test(ua) && !/\bOPR\//.test(ua)) return "Chrome";
  if (/\bSafari\//.test(ua)) return "Safari";
  return "this browser";
}

/** Chrome and Edge on a computer or Android run V8; everything on iOS runs WebKit, Chrome and Edge included. */
export function isVerifiedBrowser(ua: string = globalThis.navigator?.userAgent ?? ""): boolean {
  const n = browserName(ua);
  return (n === "Chrome" || n === "Edge") && !/\b(iPhone|iPad|iPod)\b/.test(ua);
}

export function browserSupport(g: Partial<typeof globalThis> = globalThis): BrowserSupport {
  const missing: string[] = [];
  if (typeof g.Worker === "undefined") missing.push("Web Workers");
  if (typeof g.Blob === "undefined" || typeof g.URL?.createObjectURL !== "function") missing.push("worker scripts from memory");
  if (typeof g.caches === "undefined") missing.push("the Cache Storage that keeps the engine for next time (it needs a secure https:// page)");
  if (!(g.crypto as Crypto | undefined)?.subtle) missing.push("the checksum check (it needs a secure https:// page)");
  return { missing, verified: isVerifiedBrowser(), name: browserName() };
}
