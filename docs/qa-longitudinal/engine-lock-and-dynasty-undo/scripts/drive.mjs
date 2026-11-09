// Real-UI season driver. Usage: node drive.mjs <seed> <team> <seasons> [fantasy=off|on]
import { launch, readSave, visibleButtons, headings, UI } from "./lib.mjs";
import { writeFileSync, appendFileSync } from "node:fs";
const [seed = "8724", team = "BAL", seasons = "5", fantasy = "off"] = process.argv.slice(2);
const OUT = process.env.OUT ?? `/tmp/drive-${seed}`;
const log = (...a) => { const l = a.map((x) => typeof x === "string" ? x : JSON.stringify(x)).join(" "); console.log(l); appendFileSync(OUT + ".log", l + "\n"); };
writeFileSync(OUT + ".log", "");
const { browser, page, errors, adapter } = await launch();
page.setDefaultTimeout(30000);
await page.goto(UI + (process.env.RESUME ? "/" : "/#/setup")); await page.waitForTimeout(2500);
if (!process.env.RESUME) {
await page.getByRole("tab", { name: "League Settings", exact: true }).click();
await page.getByRole("textbox", { name: "Seed", exact: true }).fill(seed);
await page.getByRole("button", { name: "Create league with this universe", exact: true }).click();
await page.waitForTimeout(1500);
if (fantasy === "off") { try { await page.getByRole("group", { name: "Fantasy draft", exact: true }).getByRole("combobox").selectOption("off"); } catch (e) { log("fantasy select failed", e.message.slice(0, 80)); } }
await page.getByRole("tab", { name: "Lobby", exact: true }).click(); await page.waitForTimeout(1000); if (process.env.DBG) { console.log(await headings(page), (await visibleButtons(page)).slice(0,14)); await page.screenshot({path:"/tmp/dbg2.png"}); }
await page.locator("button", { hasText: new RegExp(`^\\s*${team}[A-Z]`) }).first().click();
await page.getByRole("button", { name: "I'm ready to begin", exact: true }).click();
}

const PRIORITY = [/^Decline/, /^Ready for /, /^Ready to /, /^Let my staff/, /^Yes, /, /^Delegate Remaining/, /^Auto/, /^Autopick/, /^Sim to/, /^Hire /, /^Sign /, /^Done/, /^Submit/, /^Acknowledge/, /^Dismiss/, /^Close/, /^Advance to /, /^Continue/, /^Start /, /^Simulate/, /^Play /, /^Begin /, /^Next/, /^See /, /^Finish/, /^Skip/, /^Proceed/, /^Confirm/];
const snapped = new Set(); const seen = new Map(); let seasonsDone = 0, lastKey = "", stuck = 0, steps = 0, t0 = Date.now();
const history = [];
while (seasonsDone < +seasons && steps++ < 6000) {
  const s = await readSave(page); const st = s?.doc.state;
  const fa = st?.freeAgencyEvent, td = st?.tradeDeadline; const key = `${st?.season}|${st?.stage}|${st?.week}|${fa ? JSON.stringify([fa.round, fa.currentTurn, fa.turnIndex, fa.done]) : ''}|${td ? JSON.stringify([td.round, td.currentTurn]) : ''}`;
  if (key === lastKey) stuck++; else { stuck = 0; lastKey = key; log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] season=${st?.season} stage=${st?.stage} week=${st?.week} save=${(s.len/1e6).toFixed(2)}MB`); }
  { const tag = `${st.season}-${st.stage}`; const want = ["preseason", "endOfSeasonAnnounce", "offseasonDraftSummary", "offseasonDepthChart", "tradeDeadline", "playoffs"].includes(st.stage); if (want && st.week <= 1 && !snapped.has(tag)) { snapped.add(tag); writeFileSync(`${OUT}-snap-${tag}.json`, JSON.stringify(s.doc)); } }
  if (st?.stage === "endOfSeasonWin" || st?.stage === "endOfSeasonConsolation") { if (!history.includes(st.season)) { history.push(st.season); seasonsDone++; } }
  if (process.env.STOP_AT && st?.stage === process.env.STOP_AT) { log("STOP_AT reached", key); break; }
  if (stuck > 60) { log("STUCK at", key, "url", page.url(), await headings(page), (await visibleButtons(page)).filter((b) => b.length < 70)); break; }
  const btns = await visibleButtons(page);
  let clicked = false;
  // stage-specific
  if (st.stage === "fantasyDraft") { await page.evaluate(() => 0); }
  if (st.stage === "trainingCamp" && !st.trainingCamp?.plans?.[team]?.submitted) {
    const q = btns.find((x) => /^QUARTERBACKS/i.test(x)), d = btns.find((x) => /^DEFENSIVE LINE/i.test(x));
    if (q && d) { await page.getByRole("button", { name: /^Quarterbacks/ }).click(); await page.getByRole("button", { name: /^Defensive line/ }).click(); log("  camp focus picked"); }
  }
  if (st.stage === "offseasonDraftSummary" || st.stage === "fantasyDraftSummary") { const d = page.getByRole("dialog").filter({ hasText: /Every pick is in/ }); if (await d.count()) { await d.first().click(); clicked = true; log("  closed pick-in dialog"); } }
  if (st.stage === "offseasonDraft" || st.stage === "fantasyDraft") {
    try {
      const dlg = page.getByRole("dialog").filter({ hasText: /on the clock|Every pick is in/ });
      if (await dlg.count()) { await dlg.first().click({ timeout: 2000 }); log("  dialog dismissed"); }
      const row = page.locator(".draft-avail tbody tr").first();
      const b = row.getByRole("button", { name: /^Draft /i });
      if (await b.count() && await b.first().isEnabled()) { await b.first().click({ timeout: 3000 }); await page.getByRole("dialog").getByRole("button", { name: "Confirm pick", exact: true }).click({ timeout: 3000 }); clicked = true; log("  drafted"); }
    } catch (e) { log("  draft step:", e.message.slice(0, 80)); }
  }
  const ni = btns.indexOf("No thanks");
  if (!clicked && ni > 0) { const y = btns[ni - 1]; try { await page.getByRole("button", { name: y, exact: true }).first().click({ timeout: 5000 }); clicked = true; log("  confirm staff plan:", y); } catch (e) {} }
  if (!clicked) for (const re of PRIORITY) { const b = btns.find((x) => re.test(x) && !/^Auto-reorder/.test(x) && !(/re-sign/.test(x) && seen.get(key + x) >= 1)); if (b) { try { await page.getByRole("button", { name: b, exact: true }).first().click({ timeout: 5000 }); clicked = true; seen.set(key + b, (seen.get(key + b) ?? 0) + 1); log("  click:", b); break; } catch (e) { log("  click failed:", b, e.message.slice(0, 60)); } } }
  if (!clicked) { log("  no priority button; buttons:", btns); await page.waitForTimeout(1000); }
  await page.waitForTimeout(400);
}
log("DONE seasonsDone", seasonsDone, "errors", errors.slice(0, 10), "adapter calls", adapter.length, [...new Set(adapter.map((u) => u.split("?")[0]))]);
await browser.close();
