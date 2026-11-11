// PR #100 re-test at the UI layer: do /bracket, /history and the box score pages show what the saved state holds?
import { cpSync, rmSync } from "node:fs"; import { launch, readSave, UI } from "./lib.mjs";
const P = "/tmp/pw-profile-uivs"; rmSync(P, { recursive: true, force: true }); cpSync(process.argv[2], P, { recursive: true }); process.env.PROFILE = P;
const { browser, page } = await launch(); await page.goto(UI + "/"); await page.waitForTimeout(3500); const s = (await readSave(page)).doc.state;
const txt = async (r, w = 1500) => { await page.goto(UI + "/#" + r); await page.waitForTimeout(w); return page.evaluate(() => document.body.innerText.replace(/\s+/g, " ")); };
const name = (c) => s.teams[c]?.name ?? c; const b = s.bracket;
const bt = await txt("/bracket"); console.log("bracket page mentions champion", b.champion, "| code:", bt.includes(b.champion), "| name:", [s.teams[b.champion].city, s.teams[b.champion].nickname, s.teams[b.champion].name].filter(Boolean).some((n) => bt.includes(n)));
const ht = await txt("/history"); console.log("history page length", ht.length); for (const h of s.history) console.log(h.season, h.teamCode, `${h.regularSeasonRecord.wins}-${h.regularSeasonRecord.losses}`, h.furthestRound, "-> page has season:", ht.includes(String(h.season)), "record:", ht.includes(`${h.regularSeasonRecord.wins}-${h.regularSeasonRecord.losses}`));
// box scores: open every playoff game; compare displayed scores
let ok = 0, bad = [];
for (const g of s.games.filter((g) => ["WC", "DIV", "CONF", "SB"].includes(g.phase))) { const t = await txt(`/box/${g.id}`, 700); const hasScores = t.includes(String(g.homeScore)) && t.includes(String(g.awayScore)); hasScores ? ok++ : bad.push(g.id); }
console.log(`box scores showing both final scores: ${ok}/${ok + bad.length}`, bad);
await browser.close();
