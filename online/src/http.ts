/**
 * The smallest router that does the job, on `node:http`.
 *
 * The existing dev adapter (`server/index.ts`) is dependency-free by
 * deliberate choice, and this follows it: no framework, no middleware stack,
 * no body parser. What this one adds over that one is the three things a
 * multiplayer server can't do without — cookies, a caller identity, and
 * errors that come back as JSON a client can show a person.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

import { readSession, userById, type User } from "./auth.js";
import { ActionError } from "./db.js";

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  body: unknown;
  /** Null when nobody is signed in; `requireUser` is how handlers insist. */
  user: User | null;
}

export type Handler = (ctx: Ctx) => Promise<unknown>;

interface Route {
  method: string;
  /** `/leagues/:id/actions/trade` — `:name` segments become `params`. */
  pattern: string[];
  handler: Handler;
}

const routes: Route[] = [];

export function route(method: string, path: string, handler: Handler): void {
  routes.push({ method, pattern: path.split("/").filter(Boolean), handler });
}

export const get = (p: string, h: Handler) => route("GET", p, h);
export const post = (p: string, h: Handler) => route("POST", p, h);

function match(method: string, path: string): { route: Route; params: Record<string, string> } | null {
  const segs = path.split("/").filter(Boolean);
  for (const r of routes) {
    if (r.method !== method || r.pattern.length !== segs.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < segs.length; i++) {
      const p = r.pattern[i]!;
      if (p.startsWith(":")) params[p.slice(1)] = decodeURIComponent(segs[i]!);
      else if (p !== segs[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return { route: r, params };
  }
  return null;
}

function cookies(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/**
 * `SameSite=Lax` in dev, `SameSite=None; Secure` in production — and this
 * isn't a style choice, it's the difference between the cookie working and
 * silently not being sent.
 *
 * Locally the UI (`localhost:5173`) and the API (`localhost:8788`) are
 * different ports but the same *site* ("localhost"), so `Lax` covers them.
 * Deployed, they're two different subdomains of a host-provider domain
 * (`onrender.com`), which is on the public suffix list — so each subdomain
 * is its own site, and a cross-site `fetch(..., {credentials:'include'})`
 * is exactly the request `Lax` exists to hold back. `None` is what a cookie
 * needs to survive a real cross-origin API call, and browsers require
 * `Secure` alongside it — which Render's HTTPS gives for free.
 */
const cookieAttrs = (): string =>
  process.env.NODE_ENV === "production" ? "SameSite=None; Secure" : "SameSite=Lax";

export function setSessionCookie(res: ServerResponse, token: string): void {
  // HttpOnly so a script can't read it either way.
  res.setHeader(
    "Set-Cookie",
    `sid=${token}; Path=/; HttpOnly; ${cookieAttrs()}; Max-Age=${30 * 86_400}`,
  );
}

export function clearSessionCookie(res: ServerResponse): void {
  res.setHeader("Set-Cookie", `sid=; Path=/; HttpOnly; ${cookieAttrs()}; Max-Age=0`);
}

export function requireUser(ctx: Ctx): User {
  if (!ctx.user) throw new ActionError("Sign in first.", 401);
  return ctx.user;
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    // a franchise action is a few hundred bytes; anything near a megabyte is
    // either a bug or someone poking at us
    if (size > 1_000_000) throw new ActionError("Request too large.", 413);
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ActionError("Body wasn't valid JSON.", 400);
  }
}

export async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const origin = process.env.CLIENT_ORIGIN;
  if (origin) {
    // credentials mean we can't use `*`; the client origin is configured
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Headers", "content-type");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  }
  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }

  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const found = match(req.method ?? "GET", url.pathname);
  if (!found) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: `No route for ${req.method} ${url.pathname}` }));
    return;
  }

  try {
    const userId = readSession(cookies(req).sid);
    const ctx: Ctx = {
      req,
      res,
      url,
      params: found.params,
      body: await readBody(req),
      user: userId ? await userById(userId) : null,
    };
    const out = await found.route.handler(ctx);
    if (res.headersSent) return;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(out ?? { ok: true }));
  } catch (err) {
    const status = err instanceof ActionError ? err.status : 500;
    if (status === 500) {
      // eslint-disable-next-line no-console
      console.error(`${req.method} ${url.pathname}`, err);
    }
    if (res.headersSent) return;
    res.writeHead(status, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        error:
          status === 500
            ? "Something went wrong on our side."
            : (err as Error).message,
      }),
    );
  }
}
