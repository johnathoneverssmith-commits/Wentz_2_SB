import { launch, readSave, UI } from "./lib.mjs"; import { writeFileSync } from "node:fs";
const { browser, page } = await launch(); await page.goto(UI + "/"); await page.waitForTimeout(3000);
const s = await readSave(page, process.argv[3] ?? "nfl-sim-ui.league"); writeFileSync(process.argv[2], JSON.stringify(s.doc)); console.log("dumped", s.len);
const keys = await page.evaluate(async () => { const db = await new Promise((r) => { const q = indexedDB.open("nfl-sim-ui-saves", 1); q.onsuccess = () => r(q.result); }); return new Promise((r) => { const q = db.transaction("saves").objectStore("saves").getAllKeys(); q.onsuccess = () => r(q.result); }); });
console.log("idb keys", keys); await browser.close();
