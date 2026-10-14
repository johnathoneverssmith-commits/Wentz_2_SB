/**
 * Default-deny networking for the test browser.
 *
 * Every request the page makes is aborted unless its origin is exactly the temporary UI server this run started.
 * That is stricter than "no deployed hosts": another loopback port, a dev server, the engine adapter on
 * localhost:8787 (which the solo UI calls and falls back from, a source of nondeterminism) and the league API
 * default of localhost:8788 are all blocked, and so are WebSockets. Blocked requests are recorded so a test can
 * say what the app tried to reach.
 */
import type { BrowserContext } from "@playwright/test";

export interface Blocked {
  url: string;
  method: string;
  type: string;
  /** Why it was blocked, for the report. */
  reason: "engine-adapter" | "league-api" | "outside-origin";
}

/** What a healthy page load is known to try and fail to reach. Anything else blocked is a surprise. */
export const EXPECTED_BLOCKED_HOSTS = new Set([
  "fonts.googleapis.com", // the stylesheet link in index.html
  "fonts.gstatic.com",
  "127.0.0.1:9", // the league API address baked into this run's build
  "localhost:8787", // the engine adapter
  "127.0.0.1:8787",
  "localhost:8788", // the league API default
  "127.0.0.1:8788",
]);

const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

export const isAllowed = (url: string, origin: string): boolean => {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false; // a URL that cannot be parsed is not this origin
  }
};

const ADAPTER = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):8787(?:\/|$)/;
const LEAGUE_API = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):(?:8788|9)(?:\/|$)/;

/** Blocked requests that were not on the expected list: fetches the app was not known to make. */
export const unexpected = (blocked: Blocked[]): Blocked[] => blocked.filter((b) => !EXPECTED_BLOCKED_HOSTS.has(hostOf(b.url)));

export async function guardContext(context: BrowserContext, origin: string): Promise<Blocked[]> {
  const blocked: Blocked[] = [];
  const record = (url: string, method: string, type: string): void => {
    blocked.push({ url, method, type, reason: ADAPTER.test(url) ? "engine-adapter" : LEAGUE_API.test(url) ? "league-api" : "outside-origin" });
  };
  await context.route("**/*", (route) => {
    const request = route.request();
    if (isAllowed(request.url(), origin)) return route.continue();
    record(request.url(), request.method(), request.resourceType());
    return route.abort("blockedbyclient");
  });
  // an explicit rule for the engine adapter, registered last so it is consulted first: it can never be let through
  await context.route(ADAPTER, (route) => {
    const request = route.request();
    record(request.url(), request.method(), request.resourceType());
    return route.abort("blockedbyclient");
  });
  await context.routeWebSocket(/.*/, (ws) => {
    if (isAllowed(ws.url().replace(/^ws/, "http"), origin)) {
      ws.connectToServer();
      return;
    }
    record(ws.url(), "GET", "websocket");
    void ws.close({ code: 1008, reason: "blocked by the test guard" });
  });
  return blocked;
}
