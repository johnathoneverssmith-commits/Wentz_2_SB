/**
 * Fonts. The browser guard aborts every request outside the run's own origin, Google Fonts included, so by default a
 * page renders on its fallbacks ("blocked"). For a baseline on the real families ("real"), exactly two hosts are let
 * through, fetched once by this process and cached on disk: fonts.googleapis.com (the stylesheet) and
 * fonts.gstatic.com (the files). Nothing else is reachable, and nothing is ever sent to them but the font request.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { BrowserContext } from "@playwright/test";

const CHROME_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const HOSTS = /^https:\/\/fonts\.(googleapis|gstatic)\.com\//;
const CACHE = process.env.AUDIT_FONT_CACHE ?? join(tmpdir(), "wentz-audit-font-cache");

function fetchCached(url: string): { body: Buffer; type: string } {
  mkdirSync(CACHE, { recursive: true });
  const key = createHash("sha1").update(url).digest("hex");
  const bodyFile = join(CACHE, `${key}.bin`);
  const typeFile = join(CACHE, `${key}.type`);
  if (existsSync(bodyFile) && existsSync(typeFile)) return { body: readFileSync(bodyFile), type: readFileSync(typeFile, "utf8") };
  // curl, because it honours the sandbox proxy settings that Node's fetch does not
  const out = execFileSync("curl", ["-sS", "--fail", "-A", CHROME_UA, "-D", "-", "-o", bodyFile, url], { timeout: 30_000 }).toString();
  const type = /content-type:\s*([^\r\n;]+)/i.exec(out)?.[1] ?? "application/octet-stream";
  writeFileSync(typeFile, type);
  return { body: readFileSync(bodyFile), type };
}

/** Lets the two font hosts through the guard, from the disk cache. Returns how many font requests were served. */
export async function allowRealFonts(context: BrowserContext): Promise<{ served: () => number; failed: () => string[] }> {
  let served = 0;
  const failed: string[] = [];
  // registered after the guard, so consulted before it
  await context.route(HOSTS, (route) => {
    const url = route.request().url();
    try {
      const { body, type } = fetchCached(url);
      served++;
      return route.fulfill({ status: 200, body, contentType: type, headers: { "access-control-allow-origin": "*" } });
    } catch (e) {
      failed.push(`${url}: ${(e as Error).message.slice(0, 80)}`);
      return route.abort("blockedbyclient");
    }
  });
  return { served: () => served, failed: () => failed };
}

/** CSS that forces one fallback face over the whole page: a wide one (Verdana-like) or a monospace (Courier New-like). */
export const FALLBACK_CSS: Record<"wide" | "mono", string> = {
  wide: `*,*::before,*::after{font-family:Verdana,"DejaVu Sans",sans-serif !important}`,
  mono: `*,*::before,*::after{font-family:"Courier New","Liberation Mono","DejaVu Sans Mono",monospace !important}`,
};
