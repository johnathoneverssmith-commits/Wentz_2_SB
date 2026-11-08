// Box-score / stat internal-consistency checks over every game in a saved league document.
import { readFileSync } from "node:fs";
const s = JSON.parse(readFileSync(process.argv[2], "utf8")); const st = s.state ?? s;
const out = {}; const ex = {}; const note = (k, g, d = "") => { out[k] = (out[k] ?? 0) + 1; (ex[k] ??= []).length < 3 && ex[k].push(`${g.id} ${g.awayTeam} ${g.awayScore}@${g.homeTeam} ${g.homeScore} ${d}`); };
let n = 0, withLines = 0;
for (const g of [...st.games, ...(st.gameArchive ?? [])]) {
  if (!g.played || !g.totals) continue; n++;
  for (const side of ["home", "away"]) {
    const t = g.totals[side], sc = side === "home" ? g.homeScore : g.awayScore;
    if (t.points !== sc) note("T-POINTS!=SCORE", g, `${side} ${t.points}`);
    if (t.byQuarter?.length && t.byQuarter.reduce((a, b) => a + b, 0) !== sc) note("T-QTR-SUM", g, `${side} ${t.byQuarter}`);
    if (t.passYards + t.rushYards !== t.totalYards) note("T-YARDS-SUM", g, `${side} ${t.passYards}+${t.rushYards}!=${t.totalYards}`);
    if (t.passComp > t.passAtt) note("T-CMP>ATT", g);
    if (t.thirdDownMade > t.thirdDownAtt) note("T-3D", g);
    if (t.turnovers !== (t.intThrown ?? 0) + (t.fumblesLost ?? 0) && t.intThrown != null) note("T-TO-SUM", g, `${t.turnovers} vs ${t.intThrown}+${t.fumblesLost}`);
    if (t.plays < 20 || t.plays > 140) note("T-PLAYS-RANGE", g, `${t.plays}`);
    if (t.totalYards < -20 || t.totalYards > 800) note("T-YARDS-RANGE", g, `${t.totalYards}`);
    if (t.penalties < 0 || t.penaltyYards < 0 || t.penaltyYards > t.penalties * 30) note("T-PEN", g, `${t.penalties}/${t.penaltyYards}`);
    if (t.topSeconds < 600 || t.topSeconds > 3000) note("T-TOP-RANGE", g, `${t.topSeconds}`);
  }
  const top = g.totals.home.topSeconds + g.totals.away.topSeconds; if (g.phase !== "PRE" && (top < 3400 || top > 4400)) note("T-TOP-SUM", g, `${top}`);
  if (g.scoringPlays?.length) { const last = g.scoringPlays.at(-1); if (last.homeScore !== g.homeScore || last.awayScore !== g.awayScore) note("SP-LAST!=FINAL", g, `${last.homeScore}-${last.awayScore}`); }
  if (g.playerLines) {
    withLines++;
    for (const side of ["home", "away"]) {
      const L = g.playerLines[side], t = g.totals[side]; const sum = (k) => L.reduce((a, p) => a + (p[k] ?? 0), 0);
      if (sum("passYds") !== t.passYards && Math.abs(sum("passYds") - t.passYards) > 0) note("PL-PASSYDS", g, `${side} lines ${sum("passYds")} vs team ${t.passYards}`);
      if (sum("rushYds") !== t.rushYards) note("PL-RUSHYDS", g, `${side} lines ${sum("rushYds")} vs team ${t.rushYards}`);
      if (sum("passCmp") !== t.passComp) note("PL-CMP", g, `${side} ${sum("passCmp")} vs ${t.passComp}`);
      if (sum("rec") !== sum("passCmp")) note("PL-REC!=CMP", g, `${side} rec ${sum("rec")} cmp ${sum("passCmp")}`);
      if (sum("recYds") !== sum("passYds")) note("PL-RECYDS!=PASSYDS", g, `${side} ${sum("recYds")} vs ${sum("passYds")}`);
      if (sum("passTd") !== sum("recTd") + 0 && Math.abs(sum("passTd") - sum("recTd")) > 0) note("PL-PASSTD!=RECTD", g, `${side} ${sum("passTd")} vs ${sum("recTd")}`);
      for (const p of L) { if ((p.passCmp ?? 0) > (p.passAtt ?? 0)) note("PL-P-CMP>ATT", g, p.name); if ((p.fgm ?? 0) > (p.fga ?? 0) || (p.xpm ?? 0) > (p.xpa ?? 0)) note("PL-K-MADE>ATT", g, p.name); for (const k of Object.keys(p)) if (typeof p[k] === "number" && p[k] < 0 && !["recYds", "rushYds", "passYds"].includes(k)) note("PL-NEG", g, `${p.name} ${k}=${p[k]}`); }
    }
  }
}
console.log(JSON.stringify({ gamesChecked: n, withPlayerLines: withLines, anomalies: out }, null, 1)); for (const [k, v] of Object.entries(ex)) console.log(k, v);
