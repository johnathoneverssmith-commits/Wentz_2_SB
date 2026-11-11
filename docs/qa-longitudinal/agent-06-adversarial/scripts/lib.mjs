// Shared helpers: real Chromium against the dev UI (:5173) with the REAL engine adapter (:8787) reachable.
import { chromium } from "playwright";
export const UI = process.env.UI_URL ?? "http://localhost:5173";
export const SAVE_KEY = "nfl-sim-ui.league";
export async function launch() {
  const exe = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium";
  const ctx = await chromium.launchPersistentContext(process.env.PROFILE ?? "/tmp/pw-profile-default", { executablePath: exe, viewport: { width: 1440, height: 1000 } });
  const browser = ctx; // ctx.close() closes the browser; profile (IndexedDB) persists for RESUME
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  page.setDefaultTimeout(20000);
  const errors = [], adapter = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text().slice(0, 300)); });
  page.on("request", (r) => { if (r.url().includes(":8787")) adapter.push(r.url().replace(/^.*:8787/, "")); });
  page.on("dialog", (d) => d.accept());
  return { browser, ctx, page, errors, adapter };
}
export async function readSave(page, key = SAVE_KEY) {
  return page.evaluate(async (k) => {
    await window.__nflSimFlushSave?.();
    const db = await new Promise((res, rej) => { const r = indexedDB.open("nfl-sim-ui-saves", 1); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const rec = await new Promise((res, rej) => { const q = db.transaction("saves").objectStore("saves").get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
    db.close();
    if (!rec) return null;
    const txt = rec.enc === "plain" ? rec.data : await new Response(new Blob([rec.data]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
    return { len: txt.length, doc: JSON.parse(txt) };
  }, key);
}
export async function visibleButtons(page) {
  return page.evaluate(() => [...document.querySelectorAll("button, a[role=button]")].filter((b) => b.offsetParent && !b.disabled).map((b) => (b.innerText || b.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ")).filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).slice(0, 80));
}
export async function headings(page) {
  return page.evaluate(() => [...document.querySelectorAll("h1,h2")].filter((h) => h.offsetParent).map((h) => h.innerText.trim()).slice(0, 4));
}
