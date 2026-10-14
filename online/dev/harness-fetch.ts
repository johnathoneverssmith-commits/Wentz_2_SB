/**
 * The only way the HTTP harness (`e2e-http.ts`) sends a request.
 *
 * `LEAGUE_API` is validated to be a loopback origin before the first request, but `fetch` follows redirects by
 * default, and a 307 or 308 re-sends the request body (a password, a league's actions) and a followed redirect can
 * carry the session cookie with it. A server on the validated address that answers with a redirect would therefore
 * move the harness's traffic to any address, and the origin check would never see it. So no redirect is ever
 * followed: any 3xx answer, on any request (registration, login, an ordinary API call), stops the harness.
 */

export class RedirectRefused extends Error {
  constructor(
    readonly status: number,
    readonly method: string,
    readonly where: string,
    readonly to: string,
  ) {
    super(`refused a ${status} redirect from ${method} ${where} to ${to}`);
    this.name = "RedirectRefused";
  }
}

/** Where a redirect points, reduced to its origin: a Location can carry a token in its path or query, so it is never printed whole. */
function originOf(location: string | null, base: string): string {
  if (!location) return "(no Location header)";
  try {
    return new URL(location, base).origin;
  } catch {
    return "(an unreadable Location)";
  }
}

/**
 * `fetch` that does not follow redirects and refuses to carry on if it is answered with one.
 * Every 3xx counts, including a 304 (the harness sends no conditional requests, so none is expected).
 */
export async function harnessFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, { ...init, redirect: "manual" });
  if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400)) {
    const path = new URL(url).pathname;
    throw new RedirectRefused(res.status || 302, String(init.method ?? "GET").toUpperCase(), path, originOf(res.headers.get("location"), url));
  }
  return res;
}
