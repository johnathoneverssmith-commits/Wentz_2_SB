/**
 * Serving a built browser simulation engine from a temporary directory on the run's UI origin, so a spec can swap the
 * version, break a file or cut the connection (issue #74). The files come from `scripts/build-sim-worker.ts`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Page } from "@playwright/test";

/** What the test's "server" does right now. */
export interface Site {
  dir: string;
  requests: string[];
  breakAsset: string | null;
  failManifest: boolean;
  manifestOverride: ((m: Record<string, unknown>) => Record<string, unknown>) | null;
}

/** Routes `/sim-engine/**` on `origin` to `site`. */
export async function serveEngine(page: Page, origin: string, site: Site): Promise<void> {
  await page.route(`${origin}/sim-engine/**`, async (r) => {
    const name = new URL(r.request().url()).pathname.replace("/sim-engine/", "");
    site.requests.push(name);
    if (name === "manifest.json") {
      if (site.failManifest) return r.abort("internetdisconnected");
      const m = JSON.parse(readFileSync(join(site.dir, name), "utf8")) as Record<string, unknown>;
      return r.fulfill({ contentType: "application/json", headers: { "cache-control": "no-cache" }, body: JSON.stringify(site.manifestOverride ? site.manifestOverride(m) : m) });
    }
    if (site.breakAsset && name.startsWith(site.breakAsset)) return r.fulfill({ status: 503, body: "unavailable" });
    try {
      return r.fulfill({ contentType: name.endsWith(".js") ? "text/javascript" : "application/json", headers: { "cache-control": "public, max-age=31536000, immutable" }, body: readFileSync(join(site.dir, name)) });
    } catch {
      return r.fulfill({ status: 404, body: "not found" });
    }
  });
}

export const newSite = (dir: string): Site => ({ dir, requests: [], breakAsset: null, failManifest: false, manifestOverride: null });
/** The requests that were not for the manifest: the downloads. */
export const assets = (s: Site): string[] => s.requests.filter((n) => n !== "manifest.json");
