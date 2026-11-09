// Real-Chromium verification of the engine lock and the recoverable reset, with the REAL adapter being stopped/started.
// Usage: node verify-lock-and-reset.mjs <scenario> [args]
//   engine-loss                 fresh engine dynasty -> kill adapter -> Simulate -> banner, nothing changes -> restart -> Retry -> plays
//   standalone                  adapter never running -> Mock-backed, labelled, plays, never asks the adapter
//   old-save <snapshot.json>    an engine-played save from BEFORE this change (no simEngine) seeded as a legacy localStorage save
//   reset <profile-copy-src>    a 5-season dynasty (saved by the old build): New solo dynasty -> kept -> restart -> restore
import { spawn, execSync } from "node:child_process";
import { cpSync, readFileSync, rmSync } from "node:fs";
import { launch, readSave, UI, SAVE_KEY } from "./lib.mjs";
const ROOT = new URL("../../../../", import.meta.url).pathname;
const [scenario, arg] = process.argv.slice(2);
const adapterUp = async () => { try { await fetch("http://localhost:8787/scheme-fit-baseline", { method: "POST", body: "{}", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(2000) }); return true; } catch { return false; } };
const stopAdapter = async () => { try { execSync("pkill -f 'server/index.ts'"); } catch {} for (let i = 0; i < 20 && (await adapterUp()); i++) await new Promise((r) => setTimeout(r, 300)); };
const startAdapter = async () => { spawn("npx", ["tsx", "server/index.ts"], { cwd: ROOT, detached: true, stdio: "ignore" }).unref(); for (let i = 0; i < 60 && !(await adapterUp()); i++) await new Promise((r) => setTimeout(r, 500)); };
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"}  ${m}`); if (!c) process.exitCode = 1; };
const S = async (page) => (await readSave(page)).doc.state;
const play = (profile, seed, fantasy = "off") => execSync(`PROFILE=${profile} OUT=/tmp/vlr-${seed} STOP_AT=preseason node drive.mjs ${seed} BAL 1 ${fantasy}`, { cwd: new URL(".", import.meta.url).pathname, stdio: "pipe", timeout: 400000 });
async function simulatePreseason(page) {
  const g = page.getByRole("button", { name: /^Ready for Game Day/ }); if (await g.count()) { await g.first().click(); await page.waitForTimeout(600); }
  await page.getByRole("button", { name: /^Simulate Preseason/ }).first().click();
}

if (scenario === "engine-loss") {
  rmSync("/tmp/pw-vlr-eng", { recursive: true, force: true }); await startAdapter();
  play("/tmp/pw-vlr-eng", 555);
  process.env.PROFILE = "/tmp/pw-vlr-eng"; const { page, browser } = await launch(); await page.goto(UI + "/"); await page.waitForTimeout(3000);
  const s0 = await S(page); ok(s0.simEngine === "engine", `new dynasty built with adapter is engine-backed (simEngine=${s0.simEngine}, stage=${s0.stage})`);
  await stopAdapter(); ok(!(await adapterUp()), "adapter stopped");
  await simulatePreseason(page); await page.waitForTimeout(4000);
  const banner = page.getByTestId("engine-unavailable"); ok(await banner.isVisible(), "engine-unavailable alert is shown"); console.log("   banner:", (await banner.innerText()).replace(/\s+/g, " ").slice(0, 220));
  const s1 = await S(page); ok(s1.games.length === s0.games.length && s1.week === s0.week && !s1.pendingGameDay, `nothing played, week unchanged (games ${s1.games.length}, week ${s1.week})`);
  ok(s1.simEngine === "engine", "still engine-backed (no switch to Mock)");
  await page.reload(); await page.waitForTimeout(3000); const s2 = await S(page); ok(s2.simEngine === "engine" && s2.games.length === 0, "after reload the save is intact and still engine-backed");
  await page.getByRole("button", { name: /^Ready for Game Day/ }).first().click().catch(() => {}); await page.getByRole("button", { name: /^Simulate Preseason/ }).first().click(); await page.waitForTimeout(3000);
  ok(await page.getByTestId("engine-unavailable").isVisible(), "a second press retries for real and is refused the same safe way");
  await startAdapter(); ok(await adapterUp(), "adapter restarted");
  await page.getByRole("button", { name: "Retry", exact: true }).click(); await page.waitForTimeout(1500);
  ok((await page.getByTestId("engine-unavailable").count()) === 0, "Retry clears the notice once the engine answers");
  await page.getByRole("button", { name: /^Simulate Preseason/ }).first().click(); for (let i = 0; i < 40 && (await S(page)).games.length === 0; i++) await page.waitForTimeout(1500);
  const s3 = await S(page); ok(s3.games.length > 0 && s3.games.every((g) => g.weather), `play resumes on the real engine (${s3.games.length} games, all with engine weather)`);
  await browser.close();
}

if (scenario === "standalone") {
  rmSync("/tmp/pw-vlr-mock", { recursive: true, force: true }); await stopAdapter();
  play("/tmp/pw-vlr-mock", 556);
  process.env.PROFILE = "/tmp/pw-vlr-mock"; const { page, browser, adapter } = await launch(); await page.goto(UI + "/#/hub"); await page.waitForTimeout(3000);
  const s0 = await S(page); ok(s0.simEngine === "mock", `no adapter at creation -> Mock-backed (simEngine=${s0.simEngine})`);
  ok(await page.getByTestId("mock-mode").isVisible(), "the hub says plainly that this is the Mock simulation"); console.log("   notice:", (await page.getByTestId("mock-mode").innerText()).replace(/\s+/g, " ").slice(0, 160));
  await startAdapter(); // the adapter appears later: a Mock dynasty must not start using it
  adapter.length = 0; const n0 = (await S(page)).games.length;
  for (let i = 0; i < 40 && (await S(page)).games.length === n0; i++) {
    for (const re of [/^Simulate Preseason/, /^Continue/, /^Ready for Game Day/, /^View Game Day results/]) { const b = page.getByRole("button", { name: re }); if (await b.count()) { await b.first().click().catch(() => {}); break; } }
    await page.waitForTimeout(1200);
  }
  const s1 = await S(page); ok(s1.games.length > 0 && s1.games.every((g) => !g.weather), `plays on the Mock (${s1.games.length} games, none with engine weather)`);
  ok(adapter.filter((u) => u.startsWith("/simulate")).length === 0 && s1.simEngine === "mock", "even with the adapter now running, a Mock dynasty never calls it");
  await browser.close();
}

if (scenario === "old-save") {
  rmSync("/tmp/pw-vlr-old", { recursive: true, force: true }); await startAdapter(); process.env.PROFILE = "/tmp/pw-vlr-old";
  const raw = readFileSync(arg, "utf8"); const { ctx, page, browser } = await launch();
  await ctx.addInitScript(([k, v]) => { try { if (!sessionStorage.getItem("seeded") && localStorage.getItem(k) == null) localStorage.setItem(k, v); sessionStorage.setItem("seeded", "1"); } catch {} }, [SAVE_KEY, raw]);
  await page.goto(UI + "/"); await page.waitForTimeout(5000);
  const s0 = await S(page); ok(s0.simEngine === undefined && s0.stage === "preseason", `loaded a pre-change engine-played save unchanged (simEngine=${s0.simEngine}, ${s0.season}/${s0.stage})`);
  await stopAdapter(); await simulatePreseason(page); await page.waitForTimeout(4000);
  ok(await page.getByTestId("engine-unavailable").isVisible(), "inferred engine-backed (its archived games carry engine weather): adapter loss stops play");
  const s1 = await S(page); ok(s1.games.length === 0 && s1.week === s0.week, "nothing played; save unchanged");
  await startAdapter(); await page.getByRole("button", { name: "Retry", exact: true }).click(); await page.waitForTimeout(1500);
  await page.getByRole("button", { name: /^Simulate Preseason/ }).first().click(); for (let i = 0; i < 40 && (await S(page)).games.length === 0; i++) await page.waitForTimeout(1500);
  const s2 = await S(page); ok(s2.games.length > 0 && s2.games.every((g) => g.weather) && s2.simEngine === "engine", `resumes on the engine and the choice is now recorded (simEngine=${s2.simEngine})`);
  await browser.close();
}

if (scenario === "reset") {
  const P = "/tmp/pw-vlr-reset"; rmSync(P, { recursive: true, force: true }); cpSync(arg, P, { recursive: true }); process.env.PROFILE = P;
  let { page, browser } = await launch(); await page.goto(UI + "/"); await page.waitForTimeout(3500);
  const a = await S(page); ok(a.history.length === 5 && a.simEngine === undefined, `opened a 5-season dynasty saved by the previous build (${a.season}/${a.stage}, simEngine=${a.simEngine})`);
  await page.getByRole("button", { name: "New solo dynasty", exact: true }).click(); await page.waitForTimeout(800);
  const dlg = page.getByRole("alertdialog"); ok(await dlg.isVisible(), "an in-app confirmation (not a native confirm) opens");
  const text = (await dlg.innerText()).replace(/\s+/g, " "); console.log("   dialog:", text.slice(0, 420));
  ok(/5 seasons played/.test(text) && /recovery copy/i.test(text) && /Restore previous dynasty/.test(text) && /download a backup/i.test(text), "it names what is replaced (5 seasons), what is kept, how to restore, and the limit");
  await page.keyboard.press("Escape"); await page.waitForTimeout(300); ok((await page.getByRole("alertdialog").count()) === 0 && (await S(page)).history.length === 5, "Escape/Cancel changes nothing");
  await page.getByRole("button", { name: "New solo dynasty", exact: true }).click(); await page.getByRole("button", { name: "Start new dynasty", exact: true }).click(); await page.waitForTimeout(3000);
  const keys = async () => page.evaluate(async () => { const db = await new Promise((r) => { const q = indexedDB.open("nfl-sim-ui-saves", 1); q.onsuccess = () => r(q.result); }); const k = await new Promise((r) => { const q = db.transaction("saves").objectStore("saves").getAllKeys(); q.onsuccess = () => r(q.result); }); db.close(); return k; });
  const after = await S(page); ok(after.history.length === 0 && after.stage === "setup", `reset happened (${after.season}/${after.stage})`);
  const undo = (await readSave(page, SAVE_KEY + "#undo").catch(() => null)); ok(!!undo && undo.doc.state.history.length === 5 && undo.doc.state.season === 2031, `#undo holds the 5-season dynasty (${undo?.doc.state.season}, ${undo?.doc.state.history.length} seasons)`);
  // normal play on the new league (autosaves) must not touch it
  await page.getByRole("tab", { name: "League Settings", exact: true }).click(); await page.getByRole("textbox", { name: "Seed", exact: true }).fill("4321"); await page.waitForTimeout(500);
  await page.locator("button", { hasText: /^\s*CIN[A-Z]/ }).first().click().catch(() => {}); await page.waitForTimeout(1500);
  const undo2 = await readSave(page, SAVE_KEY + "#undo"); ok(undo2.doc.state.history.length === 5 && undo2.len === undo.len, "after further autosaves the kept dynasty is byte-identical");
  console.log("   idb keys:", await keys());
  await browser.close(); // browser restart
  ({ page, browser } = await launch()); await page.goto(UI + "/"); await page.waitForTimeout(3500);
  const restored = page.getByTestId("restore-previous-dynasty"); ok(await restored.isVisible(), "after a browser restart the Restore previous dynasty control is offered"); console.log("   control:", (await restored.innerText()));
  await restored.click(); await page.waitForTimeout(4000);
  const b = await S(page); ok(b.history.length === 5 && b.season === 2031 && JSON.stringify(b.teams) === JSON.stringify(a.teams) && Object.keys(b.players).length === Object.keys(a.players).length && JSON.stringify(b.draftPicks) === JSON.stringify(a.draftPicks), "restored dynasty equals the original (teams, players, draft picks, history)");
  await browser.close(); ({ page, browser } = await launch()); await page.goto(UI + "/"); await page.waitForTimeout(3500);
  const c = await S(page); ok(c.history.length === 5, "and it is what the next browser restart shows"); await browser.close();
}
