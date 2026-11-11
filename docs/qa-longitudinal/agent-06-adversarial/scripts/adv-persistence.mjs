// Persistence attacks on an isolated COPY of a franchise profile. Usage: node adv-persistence.mjs <src-profile> <label>
import { cpSync, rmSync, readFileSync } from "node:fs";
import { launch, readSave, UI, SAVE_KEY } from "./lib.mjs";
const src = process.argv[2], P = "/tmp/pw-profile-adv-" + process.argv[3];
rmSync(P, { recursive: true, force: true }); cpSync(src, P, { recursive: true });
const R = []; const rep = (n, v) => { R.push([n, v]); console.log(`[${n}]`, JSON.stringify(v).slice(0, 600)); };
async function open(extra = {}) { process.env.PROFILE = P; const h = await launch(); await h.page.goto(UI + "/"); await h.page.waitForTimeout(3500); return h; }
const idb = (page, fn, arg) => page.evaluate(async ([src, arg]) => { const db = await new Promise((r) => { const q = indexedDB.open("nfl-sim-ui-saves", 1); q.onsuccess = () => r(q.result); }); const f = eval(src); const out = await f(db, arg); db.close(); return out; }, [fn.toString(), arg]);
const banner = (page) => page.evaluate(() => [...document.querySelectorAll("[role=alert],[role=status],.notice,.banner")].map((e) => e.innerText.trim().replace(/\s+/g, " ")).filter(Boolean).slice(0, 5));

// baseline
let h = await open(); const base = await readSave(h.page); rep("baseline", { season: base.doc.state.season, stage: base.doc.state.stage, len: base.len });
const stageBefore = base.doc.state.stage, seasonBefore = base.doc.state.season;

// A1: corrupt the newest record (data altered, checksum stale)
await idb(h.page, (db) => new Promise((res) => { const tx = db.transaction("saves", "readwrite"); const st = tx.objectStore("saves"); const g = st.get("nfl-sim-ui.league"); g.onsuccess = () => { const r = g.result; if (typeof r.data === "string") r.data = r.data.slice(0, 5000) + "X" + r.data.slice(5001); else { const u = new Uint8Array(r.data); u[Math.floor(u.length / 2)] ^= 0xff; } st.put(r, "nfl-sim-ui.league"); tx.oncomplete = () => res(r.enc); }; }));
await h.browser.close(); h = await open();
let after = await readSave(h.page).catch((e) => ({ err: e.message }));
rep("A1 corrupt-newest -> reload", { loaded: after.doc ? `${after.doc.state.season}/${after.doc.state.stage}` : after.err, banner: await banner(h.page), keys: await idb(h.page, (db) => new Promise((r) => { const q = db.transaction("saves").objectStore("saves").getAllKeys(); q.onsuccess = () => r(q.result); })) });
await h.page.screenshot({ path: "/tmp/adv-A1.png" });

// A2: corrupt BOTH
await idb(h.page, (db) => new Promise((res) => { const tx = db.transaction("saves", "readwrite"); const st = tx.objectStore("saves"); for (const k of ["nfl-sim-ui.league", "nfl-sim-ui.league#prev"]) { const g = st.get(k); g.onsuccess = () => { const r = g.result; if (!r) return; if (typeof r.data === "string") r.data = "garbage" + r.data.slice(7); else { const u = new Uint8Array(r.data); u[10] ^= 0xff; u[u.length - 20] ^= 0xff; } st.put(r, k); }; } tx.oncomplete = () => res(1); }));
await h.browser.close(); h = await open();
const txt = await h.page.evaluate(() => document.body.innerText.slice(0, 400).replace(/\s+/g, " "));
const keys2 = await idb(h.page, (db) => new Promise((r) => { const q = db.transaction("saves").objectStore("saves").getAllKeys(); q.onsuccess = () => r(q.result); }));
rep("A2 corrupt-both -> reload", { page: txt, banner: await banner(h.page), keys: keys2, url: h.page.url() });
await h.page.screenshot({ path: "/tmp/adv-A2.png" });
// A2b: after a loud failure, does the app let the player start a new dynasty and does that overwrite the raw damaged record?
const raw = await idb(h.page, (db) => new Promise((r) => { const q = db.transaction("saves").objectStore("saves").get("nfl-sim-ui.league#damaged"); q.onsuccess = () => r(!!q.result); }));
rep("A2b damaged copy retained", raw);
await h.browser.close();
