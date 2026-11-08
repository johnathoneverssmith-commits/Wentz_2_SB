// Reload at various delays after clicking "Simulate the <round>"; then finish the playoffs and run invariants.
import { readFileSync, rmSync, writeFileSync } from "node:fs"; import { execFileSync } from "node:child_process"; import { launch, readSave, UI, SAVE_KEY } from "./lib.mjs";
const raw = readFileSync(process.argv[2], "utf8"); const delays = (process.argv[3] ?? "100,600,2500").split(",").map(Number);
for (const delay of delays) {
  const P = `/tmp/pw-profile-po-${delay}`; rmSync(P, { recursive: true, force: true }); process.env.PROFILE = P;
  const { ctx, browser, page } = await launch(); await ctx.addInitScript(([k, v]) => { try { if (!sessionStorage.getItem("seeded") && localStorage.getItem(k) == null) localStorage.setItem(k, v); sessionStorage.setItem("seeded", "1"); } catch {} }, [SAVE_KEY, raw]);
  await page.goto(UI + "/#/bracket"); await page.waitForTimeout(4500);
  const S = async () => (await readSave(page)).doc.state; const s0 = await S(); const roundOf = (s) => s.bracket?.currentRound;
  const btn = page.getByRole("button", { name: /^Simulate the / }).first(); const label = await btn.innerText();
  btn.click({ noWaitAfter: true }).catch(() => {}); await page.waitForTimeout(delay); await page.reload(); await page.waitForTimeout(6000);
  const s1 = await S(); const played1 = s1.games.filter((g) => ["WC", "DIV", "CONF", "SB"].includes(g.phase) && g.played).length;
  const decided1 = s1.bracket.matchups.filter((m) => m.winner && m.highSeed && m.lowSeed).length;
  // finish the playoffs through the UI
  for (let i = 0; i < 8; i++) { const b = page.getByRole("button", { name: /^Simulate the / }); if (!(await b.count())) break; await b.first().click().catch(() => {}); for (let j = 0; j < 40; j++) { await page.waitForTimeout(1500); const t = await S(); if (t.stage !== "playoffs" || t.bracket.matchups.filter((m) => m.winner).length !== (i + 1 > 0 ? -1 : 0)) { if (!(await page.getByRole("button", { name: /^Simulate the / }).count()) || j > 6) break; } } }
  await page.waitForTimeout(3000); const s2 = await S(); writeFileSync(`/tmp/po-int-${delay}.json`, JSON.stringify({ state: s2 }));
  console.log(`delay ${delay}ms clicked="${label}": after-reload stage=${s1.stage} round=${roundOf(s1)} playoffGames=${played1} decidedMatchups=${decided1}; final stage=${s2.stage} champion=${s2.bracket?.champion}`);
  try { console.log(execFileSync("node", ["check-state.mjs", `/tmp/po-int-${delay}.json`], { encoding: "utf8" }).trim().split("\n").slice(0, 6).join("\n")); } catch (e) { console.log(e.stdout.toString().split("\n").slice(0, 8).join("\n")); }
  await browser.close();
}
