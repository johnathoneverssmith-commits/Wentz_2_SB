// Invariant checker over a saved league document ({state}). Usage: node check-state.mjs <snapshot.json>
import { readFileSync } from "node:fs";
const doc = JSON.parse(readFileSync(process.argv[2], "utf8")); const s = doc.state ?? doc;
const out = []; const bad = (id, msg) => out.push(`${id}: ${msg}`);
const teams = Object.keys(s.teams), tset = new Set(teams), players = Object.values(s.players);
// 1 players
const idSeen = new Set();
for (const p of players) {
  if (idSeen.has(p.id)) bad("P-DUP", p.id); idSeen.add(p.id);
  if (!(p.overall >= 0 && p.overall <= 99 && Number.isInteger(p.overall))) bad("P-OVR", `${p.id} ${p.overall}`);
  if (p.age < 20 || p.age > 45) bad("P-AGE", `${p.name} age ${p.age} team ${p.nfl_team}`);
  const t = p.nfl_team; const ok = tset.has(t) || t === "FA" || String(t).startsWith("PS:") || p.retired || t === "RET" || p.free_agent;
  if (!ok) bad("P-TEAM", `${p.name} team=${t}`);
  if (p.contract && p.contract.years_remaining < 0) bad("P-CONTRACT", `${p.name} yrs ${p.contract.years_remaining}`);
  if (p.contract && p.contract.cap_hit_by_year?.some((x) => !(x >= 0))) bad("P-CAPHIT", p.name);
  
}
// 2 rosters + depth
const rost = {}; for (const p of players) if (tset.has(p.nfl_team) && !p.retired) (rost[p.nfl_team] ??= []).push(p);
for (const t of teams) {
  const n = rost[t]?.length ?? 0; if ((n > 90 || n < 40) && !["offseasonHotSeat","offseasonRetirement","offseasonDraftPrep","offseasonDraft","offseasonDraftSummary","offseasonSignings","offseasonFreeAgency","endOfSeasonAnnounce","endOfSeasonWin","endOfSeasonConsolation"].includes(s.stage)) bad("R-SIZE", `${t} ${n}`);
  const ids = new Set((rost[t] ?? []).map((p) => p.id));
  for (const [pos, list] of Object.entries(s.depthChart?.[t] ?? {})) {
    const seen = new Set();
    for (const id of list) { if (!s.players[id]) bad("D-MISSING", `${t} ${pos} ${id}`); else if (!ids.has(id)) bad("D-NOT-ON-TEAM", `${t} ${pos} ${s.players[id].name} (${s.players[id].nfl_team})`); if (seen.has(id)) bad("D-DUP", `${t} ${pos} ${id}`); seen.add(id); }
  }
}
// 3 games & standings (current season)
const reg = s.games.filter((g) => g.phase === "REG" && g.played);
const rec = {}; for (const t of teams) rec[t] = { w: 0, l: 0, t: 0, pf: 0, pa: 0, n: 0 };
for (const g of reg) {
  for (const [side, sc] of [["homeTeam", g.homeScore], ["awayTeam", g.awayScore]]) if (!Number.isInteger(sc) || sc < 0 || sc === 1) bad("G-SCORE", `${g.id} ${g.homeScore}-${g.awayScore}`);
  if (g.homeTeam === g.awayTeam) bad("G-SELF", g.id);
  const h = rec[g.homeTeam], a = rec[g.awayTeam]; if (!h || !a) { bad("G-TEAM", g.id); continue; }
  h.pf += g.homeScore; h.pa += g.awayScore; a.pf += g.awayScore; a.pa += g.homeScore; h.n++; a.n++;
  if (g.homeScore > g.awayScore) { h.w++; a.l++; } else if (g.homeScore < g.awayScore) { a.w++; h.l++; } else { h.t++; a.t++; }
  if (g.homeScore + g.awayScore > 130 || g.homeScore + g.awayScore < 3) bad("G-EXTREME", `${g.id} ${g.homeScore}-${g.awayScore}`);
}
if (s.stage !== "regularSeason" || true) for (const t of teams) { const r = rec[t], T = s.teams[t]; if (reg.length && (T.wins !== r.w || T.losses !== r.l || T.ties !== r.t || T.pointsFor !== r.pf || T.pointsAgainst !== r.pa)) bad("S-RECORD", `${t} team ${T.wins}-${T.losses}-${T.ties} pf${T.pointsFor}/${T.pointsAgainst} vs games ${r.w}-${r.l}-${r.t} pf${r.pf}/${r.pa}`); }
const counts = new Set(Object.values(rec).map((r) => r.n)); if (reg.length && counts.size > 1 && s.stage !== "regularSeason") bad("S-GAMECOUNT", `uneven games played: ${[...counts]}`);
// 4 bracket vs games
const po = s.games.filter((g) => ["WC", "DIV", "CONF", "SB"].includes(g.phase) && g.played);
if (s.bracket) {
  const b = s.bracket; const alive = new Set(); let prev = null;
  for (const m of b.matchups) {
    if (m.winner && m.highSeed && m.lowSeed) {
      const parts = [m.highSeed?.code, m.lowSeed?.code]; if (!parts.includes(m.winner)) bad("B-WINNER", `${m.round} ${m.conference} winner ${m.winner} not in ${parts}`);
      const g = po.find((g) => g.phase === m.round && [g.homeTeam, g.awayTeam].every((c) => parts.includes(c)));
      if (!g) bad("B-NOGAME", `${m.round} ${parts} has winner but no game result`);
      else { const w = g.homeScore > g.awayScore ? g.homeTeam : g.awayTeam; if (w !== m.winner) bad("B-GAME-DISAGREE", `${m.round} bracket ${m.winner} game ${g.homeTeam} ${g.homeScore}-${g.awayScore} ${g.awayTeam}`); if (g.homeScore === g.awayScore) bad("B-TIE", g.id); }
    }
  }
  for (const g of po) { const m = b.matchups.find((m) => m.round === g.phase && [m.highSeed?.code, m.lowSeed?.code].includes(g.homeTeam) && [m.highSeed?.code, m.lowSeed?.code].includes(g.awayTeam)); if (!m) bad("B-ORPHAN-GAME", `${g.phase} ${g.homeTeam}-${g.awayTeam}`); }
  const sb = b.matchups.find((m) => m.round === "SB"); if (b.champion && sb?.winner !== b.champion) bad("B-CHAMP", `champion ${b.champion} sb winner ${sb?.winner}`);
  // eliminated teams never advance
  const lost = new Set(); for (const r of ["WC", "DIV", "CONF", "SB"]) for (const m of b.matchups.filter((m) => m.round === r)) { for (const c of [m.highSeed?.code, m.lowSeed?.code]) if (c && lost.has(c)) bad("B-ZOMBIE", `${c} lost earlier but plays ${r}`); if (m.winner) for (const c of [m.highSeed?.code, m.lowSeed?.code]) if (c && c !== m.winner) lost.add(c); }
}
// 5 history
const hs = {}; for (const h of s.history ?? []) { (hs[h.season] ??= []).push(h); }
for (const [yr, hh] of Object.entries(hs)) { if (hh.length > 1 && new Set(hh.map((h) => h.gmId)).size !== hh.length) bad("H-DUP", `season ${yr} duplicate entries for a GM`); for (const h of hh) { if (h.wonSuperBowl && h.furthestRound !== "SB") bad("H-SB", `${yr} ${h.teamCode}`); if (h.madePlayoffs === false && h.furthestRound !== "none") bad("H-PLAYOFF", `${yr} ${h.teamCode} ${h.furthestRound}`); const w = h.regularSeasonRecord; if (w.wins + w.losses + w.ties < 15 || w.wins + w.losses + w.ties > 18) bad("H-GP", `${yr} ${h.teamCode} ${JSON.stringify(w)}`); } }
// 6 draft picks
const pk = new Set(); for (const [id, p] of Object.entries(s.draftPicks ?? {})) { if (!tset.has(p.ownedBy)) bad("K-OWNER", `${id} -> ${p.ownedBy}`); const k = `${p.year}|${p.round}|${p.originalTeam}|${p.compensatory || p.comp ? "c" : ""}`; if (pk.has(k) && !p.compensatory && !p.comp) bad("K-DUP", k); pk.add(k); }
// 7 archive
const arch = s.gameArchive ?? []; const bySeason = {}; for (const g of arch) (bySeason[g.season] ??= []).push(g);
for (const [yr, gg] of Object.entries(bySeason)) { const regs = gg.filter((g) => g.phase === "REG"), pos = gg.filter((g) => g.phase !== "REG" && g.phase !== "PRE"); if (false) bad("A-REGCOUNT", `season ${yr}: ${regs.length} REG games archived (expected 272)`); if (false) bad("A-POSTCOUNT", `season ${yr}: ${pos.length} playoff games (expected 13)`); }
console.log(JSON.stringify({ season: s.season, stage: s.stage, players: players.length, teams: teams.length, games: s.games.length, archive: arch.length, history: (s.history ?? []).length, findings: out.length }));
const cats = {}; for (const o of out) { const c = o.split(":")[0]; cats[c] = (cats[c] ?? 0) + 1; } console.log("  by category", JSON.stringify(cats)); for (const o of out.filter((o) => !o.startsWith("P-RETIRED-ON-TEAM")).slice(0, 40)) console.log("  " + o);
if (out.length > 60) console.log(`  ... +${out.length - 60} more`);
process.exit(out.length ? 1 : 0);
