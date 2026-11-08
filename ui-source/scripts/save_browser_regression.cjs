/**
 * GAP-008 browser regression, in real Chromium against real IndexedDB/localStorage.
 *
 *   npm run dev -- --port 5199 &           # the DEV build exposes window.__store
 *   BASE=http://localhost:5199/ node scripts/save_browser_regression.cjs
 *
 * Playwright is not a dependency of this repo (it is preinstalled in the cloud image); this is a
 * manual/opt-in regression, not part of CI. Exits non-zero on the first failed check.
 */
const { chromium } = require("playwright");
const BASE = process.env.BASE || "http://localhost:5199/";
const KEY = "nfl-sim-ui.league";
let failed = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) failed++; };

const idbHas = (page, key) => page.evaluate((k) => new Promise((res) => {
  const r = indexedDB.open("nfl-sim-ui-saves");
  r.onsuccess = () => { const q = r.result.transaction("saves").objectStore("saves").count(k); q.onsuccess = () => { r.result.close(); res(q.result > 0); }; };
  r.onerror = () => res(false);
}), key);
const ready = async (page) => { await page.waitForFunction(() => !!window.__store && !document.body.innerText.includes("Loading your dynasty"), null, { timeout: 60000 }); };
const flush = (page) => page.evaluate(async () => { for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 150)); } });

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.accept());
  await page.goto(BASE); await ready(page);

  // 1. a new dynasty lands in IndexedDB, not localStorage
  await page.evaluate(() => window.__store.getState().newLeague(21));
  await flush(page);
  ok(await idbHas(page, KEY), "new dynasty is stored in IndexedDB");
  ok(await page.evaluate((k) => localStorage.getItem(k) === null, KEY), "nothing under the localStorage league key");

  // 2. a >5 MiB league saves with no warning, and reloads intact
  await page.evaluate(() => {
    const filler = Array.from({ length: 1300 }, () => ({ blob: Math.random().toString(36).repeat(450) }));
    window.__store.setState({ qaFiller: filler });
  });
  await flush(page);
  const size = await page.evaluate(() => { const o = window.__store.persist.getOptions(); return JSON.stringify(o.partialize(window.__store.getState())).length; });
  ok(size > 5242875, `league JSON is ${size} chars (over the 5,242,875 localStorage limit)`);
  ok(await page.getByText("t being saved").count() === 0, "no save-failed banner");
  await page.reload(); await ready(page);
  ok(await page.evaluate(() => (window.__store.getState().qaFiller || []).length) === 1300, "oversized league survives a reload");

  // 3. migration of a pre-fix localStorage save
  const legacy = await page.evaluate(() => { const o = window.__store.persist.getOptions(); const s = o.partialize(window.__store.getState()); delete s.qaFiller; return { season: s.season, json: JSON.stringify({ state: s, version: o.version }) }; });
  await page.evaluate(() => new Promise((res) => { const r = indexedDB.deleteDatabase("nfl-sim-ui-saves"); r.onsuccess = r.onerror = r.onblocked = () => res(); }));
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [KEY, legacy.json]);
  await page.addInitScript(() => { window.__noWrite = true; });
  await page.reload(); await ready(page);
  ok(await page.evaluate(() => window.__store.getState().season) === legacy.season, "pre-fix localStorage save loads");
  ok(await idbHas(page, KEY), "…and is now in IndexedDB");
  ok(await page.evaluate((k) => localStorage.getItem(k) === null, KEY), "…and the old localStorage copy is removed after verification");

  // 4. storage failure: banner with backup access, nothing rolled back, notice after reload
  const goodSeason = await page.evaluate(() => window.__store.getState().season);
  await page.evaluate(() => { const p = IDBObjectStore.prototype.put; window.__realPut = p; IDBObjectStore.prototype.put = function () { throw new DOMException("quota", "QuotaExceededError"); }; });
  await page.evaluate(() => window.__store.setState({ season: window.__store.getState().season + 1 }));
  await page.waitForSelector("text=t being saved", { timeout: 15000 });
  ok(true, "banner appears when the write fails");
  ok(await page.getByRole("button", { name: "Download backup" }).count() >= 1, "banner offers Download backup");
  ok(await page.getByRole("button", { name: "Restore from backup" }).count() >= 1, "banner offers Restore from backup");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("alert").getByRole("button", { name: "Download backup" }).click()]);
  const path = await dl.path();
  const fs = require("fs"); const backupText = fs.readFileSync(path, "utf8");
  ok(JSON.parse(backupText).league.season === goodSeason + 1, "downloaded backup holds the unsaved state");
  await page.evaluate(() => { IDBObjectStore.prototype.put = window.__realPut; });
  await page.reload(); await ready(page);
  ok(await page.evaluate(() => window.__store.getState().season) === goodSeason, "reload shows the last good save (not a half-written one)");
  await page.waitForSelector("text=Some progress from your last session", { timeout: 15000 });
  ok(true, "reload tells the player progress was not saved");

  // 5. restore the (oversized) backup through the UI file picker, and it is saved
  await page.evaluate(() => { window.__store.setState({ qaFiller: Array.from({ length: 1300 }, () => ({ blob: Math.random().toString(36).repeat(450) })) }); });
  await flush(page);
  const [dl2] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download backup" }).first().click()]);
  const big = fs.readFileSync(await dl2.path(), "utf8");
  ok(big.length > 5242875, `backup file is ${big.length} chars (over the localStorage limit)`);
  await page.evaluate(() => window.__store.setState({ qaFiller: undefined, season: 2099 }));
  await flush(page);
  fs.writeFileSync("/tmp/claude-0/big-backup.json", big);
  await page.locator('input[type=file]').first().setInputFiles("/tmp/claude-0/big-backup.json");
  await page.waitForSelector("text=and saved it", { timeout: 60000 });
  ok(true, "oversized backup restored and reported as saved");
  await page.reload(); await ready(page);
  ok(await page.evaluate(() => (window.__store.getState().qaFiller || []).length) === 1300, "restored league is there after reload");
  ok(await page.evaluate(() => window.__store.getState().season) !== 2099, "restore replaced the in-memory dynasty");

  // 6. a change, then the tab navigates away a moment later
  await page.evaluate(() => window.__store.setState({ season: 2077, qaFiller: undefined }));
  await page.waitForTimeout(250); // measured window to land the write is < 60 ms; a change closed over in the same tick can be lost
  await page.goto("about:blank");
  const page2 = await ctx.newPage(); await page2.goto(BASE); await ready(page2);
  ok(await page2.evaluate(() => window.__store.getState().season) === 2077, "a change made a moment before the tab closed is saved");

  await browser.close();
  console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
