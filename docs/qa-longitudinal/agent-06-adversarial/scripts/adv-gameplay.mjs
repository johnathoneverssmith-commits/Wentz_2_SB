// Adversarial gameplay on an isolated profile seeded through the LEGACY localStorage path (migration test).
// Usage: node adv-gameplay.mjs <snapshot.json>   (a {state,version} document at a preseason stage)
import { readFileSync, rmSync } from "node:fs";
import { launch, readSave, UI, SAVE_KEY } from "./lib.mjs";
const snapPath = process.argv[2]; const raw = readFileSync(snapPath, "utf8"); const P = "/tmp/pw-profile-adv-play"; rmSync(P, { recursive: true, force: true });
process.env.PROFILE = P; const R = {}; const rep = (n, v) => { R[n] = v; console.log(`[${n}]`, JSON.stringify(v).slice(0, 900)); };
let { browser, ctx, page, errors } = await launch();
// --- legacy migration: seed the OLD single-string localStorage form BEFORE the app's first load (as a real pre-#101 user has), once only
await ctx.addInitScript(([k, v]) => { try { if (!sessionStorage.getItem("seeded") && localStorage.getItem(k) == null) { localStorage.setItem(k, v); } sessionStorage.setItem("seeded", "1"); } catch {} }, [SAVE_KEY, raw]);
const seeded = JSON.parse(raw).state; await page.goto(UI + "/"); await page.waitForTimeout(5000);
const lsLeft = await page.evaluate((k) => localStorage.getItem(k) != null, SAVE_KEY);
let sv = await readSave(page); const eq = JSON.stringify(sv.doc.state.teams) === JSON.stringify(seeded.teams) && Object.keys(sv.doc.state.players).length === Object.keys(seeded.players).length;
rep("M1 legacy-localStorage migration", { stage: sv.doc.state.stage, season: sv.doc.state.season, teamsPlayersEqualSeed: eq, localStorageStillHolds: lsLeft, idbLen: sv.len });
const S = async () => (await readSave(page)).doc.state;
const gameIds = (s) => s.games.filter((g) => g.played).map((g) => g.id);
// --- odd URLs: must not mutate stage/week
const before = await S(); const routes = ["/bracket", "/draft", "/trade-deadline", "/free-agency-board", "/box/not-a-game", "/watch/nope", "/results/REG/1/99", "/results/round/ZZ", "/hot-seat", "/retirement", "/rookie-signings", "/season-complete", "/end-of-season", "/hooded-figure", "/league-developments", "/does-not-exist", "/history", "/games", "/hub", "/game-plan", "/schedule", "/player-stats", "/league-stats", "/coaching", "/trade-summary", "/free-agency"];
const odd = []; for (const r of routes) { errors.length = 0; await page.goto(UI + "/#" + r); await page.waitForTimeout(500); const h = await page.evaluate(() => ({ h: [...document.querySelectorAll("h1,h2")].filter((e) => e.offsetParent).map((e) => e.innerText.trim().replace(/\s+/g, " ")).slice(0, 2), crash: /something went wrong|error boundary|cannot read|undefined/i.test(document.body.innerText) })); odd.push({ r, url: page.url().replace(UI, ""), ...h, errs: errors.filter((e) => e.startsWith("pageerror")).length }); }
const after = await S(); rep("U1 odd-urls", { stageUnchanged: before.stage === after.stage && before.week === after.week && before.season === after.season, crashes: odd.filter((o) => o.crash || o.errs).map((o) => o.r), table: odd.map((o) => `${o.r} -> ${o.url} | ${o.h.join(" / ")}`) });
// --- rapid repeated clicks on the simulate button
await page.goto(UI + "/"); await page.waitForTimeout(1000);
const gate = page.getByRole("button", { name: /^Ready for Game Day/ }); if (await gate.count()) { await gate.first().click(); await page.waitForTimeout(800); }
const b0 = await S(); const btn = page.getByRole("button", { name: /^Simulate Preseason/ }).first();
rep("C0 pre-click", { stage: b0.stage, week: b0.week, played: gameIds(b0).length });
for (let i = 0; i < 6; i++) btn.click({ timeout: 800, noWaitAfter: true, force: true }).catch(() => {});
for (let i = 0; i < 40; i++) { await page.waitForTimeout(3000); const x = await S(); if (x.week !== b0.week || x.stage !== b0.stage) break; } await page.waitForTimeout(8000); const b1 = await S(); const ids = gameIds(b1);
rep("C1 six rapid Simulate Preseason clicks", { stage: b1.stage, week: b1.week, played: ids.length, uniqueIds: new Set(ids).size, preGamesPerWeek: [1, 2, 3].map((w) => b1.games.filter((g) => g.phase === "PRE" && g.week === w && g.played).length) });
// --- reload mid-simulation
await page.goto(UI + "/"); await page.waitForTimeout(1000);
const g2 = page.getByRole("button", { name: /^Ready for Game Day/ }); if (await g2.count()) { await g2.first().click(); await page.waitForTimeout(800); }
const m0 = await S(); const sim = page.getByRole("button", { name: /^(Simulate|Continue)/ }).first(); const label = await sim.innerText().catch(() => "?");
sim.click({ noWaitAfter: true }).catch(() => {}); await page.waitForTimeout(150); await page.reload(); await page.waitForTimeout(25000);
const m1 = await S(); const m1ids = gameIds(m1);
const wk = {}; for (const g of m1.games.filter((g) => g.played)) { const k = g.phase + g.week; wk[k] = (wk[k] ?? 0) + 1; }
rep("D1 reload 150ms after click", { clicked: label, before: `${m0.stage} w${m0.week}`, after: `${m1.stage} w${m1.week}`, gamesPlayedPerSlate: wk, uniqueIds: new Set(m1ids).size === m1ids.length });
const sv2 = await readSave(page); rep("D2 integrity after interrupted sim", { len: sv2.len });
await browser.close();
