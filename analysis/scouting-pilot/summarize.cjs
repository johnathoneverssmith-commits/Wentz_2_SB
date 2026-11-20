// Summarise a scouting-budget.test.ts output: paired by seed (each seed's 11 scripted-human teams and 21 CPU teams
// averaged first, so the unit is a league), against the same seed's control draft.
// usage: node analysis/scouting-pilot/summarize.cjs <out.json> [summary.json]
const fs = require("fs");
const d = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const by = {};
for (const x of d) (by[x.seed] ??= {})[x.arm] = x;
const seeds = Object.keys(by).filter((s) => by[s].control).map(Number);
const T975 = { 23: 2.069, 47: 2.012 }; // two-sided 95% t for df = n-1 (n = 24, 48); otherwise ~1.96 + 2.4/df
const tcrit = (n) => T975[n - 1] ?? 1.96 + 2.4 / (n - 1);
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const stat = (a) => {
  const m = mean(a), sd = Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)), se = sd / Math.sqrt(a.length);
  return { mean: +m.toFixed(4), se: +se.toFixed(4), ci95: [+(m - tcrit(a.length) * se).toFixed(4), +(m + tcrit(a.length) * se).toFixed(4)], n: a.length };
};
const arms = [...new Set(d.map((x) => x.arm))].filter((a) => a !== "control");
const out = { seeds: [Math.min(...seeds), Math.max(...seeds)], nSeeds: seeds.length, arms: {} };
for (const a of arms) {
  const hum = [], cpu = [], edge = [], ms = [], cov = [];
  const q = { human: [], cpu: [] };
  for (const sd of seeds) {
    const C = by[sd].control, M = by[sd][a];
    const h = mean(M.humans.map((t) => M.rating[t] - C.rating[t])), c = mean(M.cpu.map((t) => M.rating[t] - C.rating[t]));
    hum.push(h); cpu.push(c); edge.push(h - c); ms.push(M.cpuScoutMs); cov.push(M.covered);
    for (const r of M.q) (r[0] ? q.human : q.cpu).push(r);
  }
  const rep = (rows) => rows.length ? {
    n: rows.length,
    rmsePublic: +Math.sqrt(mean(rows.map((z) => (z[1] - z[3]) ** 2))).toFixed(2),
    rmseReport: +Math.sqrt(mean(rows.map((z) => (z[2] - z[3]) ** 2))).toFixed(2),
    coverage80: +(rows.filter((z) => z[3] >= z[4] && z[3] <= z[5]).length / rows.length).toFixed(3),
  } : null;
  out.arms[a] = { humanVsControl: stat(hum), cpuVsControl: stat(cpu), humanMinusCpu: stat(edge), cpuScoutMsPerLeague: +mean(ms).toFixed(1), cpuScoutMsMax: +Math.max(...ms).toFixed(1), cpuProspectsScouted: +mean(cov).toFixed(1), humanReports: rep(q.human), cpuReports: rep(q.cpu) };
}
out.controlDraftMs = +mean(seeds.map((s) => by[s].control.draftMs)).toFixed(1);
if (process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify(out, null, 2));
