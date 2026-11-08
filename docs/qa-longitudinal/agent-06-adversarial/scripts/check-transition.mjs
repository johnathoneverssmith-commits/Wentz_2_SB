// Year-over-year integrity between two snapshots (e.g. preseason N -> preseason N+1).
import { readFileSync } from "node:fs";
const A = JSON.parse(readFileSync(process.argv[2], "utf8")).state, B = JSON.parse(readFileSync(process.argv[3], "utf8")).state;
const ap = A.players, bp = B.players; const out = [];
const gone = Object.keys(ap).filter((id) => !bp[id]); const added = Object.keys(bp).filter((id) => !ap[id]);
out.push(`players ${Object.keys(ap).length} -> ${Object.keys(bp).length}; removed-from-state ${gone.length}; added ${added.length}`);
const ageBad = [], dOvr = [], big = [], retNoFlag = [], contractBad = [], teamNote = {};
for (const [id, p] of Object.entries(ap)) { const q = bp[id]; if (!q) continue;
  if (!p.retired && !q.retired && q.age !== p.age + 1) ageBad.push(`${p.name} ${p.age}->${q.age}`);
  if (!q.retired && !p.retired) { const d = q.overall - p.overall; dOvr.push([p.age, d, p.position]); if (Math.abs(d) >= 15) big.push(`${p.name} ${p.position} age ${p.age} ${p.overall}->${q.overall}`); }
  if (p.retired && !q.retired) retNoFlag.push(`${p.name} un-retired`);
  if (p.contract && q.contract && !q.retired && q.contract.team_id === p.contract.team_id && q.contract.years_remaining > p.contract.years_remaining) contractBad.push(`${p.name} yrs ${p.contract.years_remaining}->${q.contract.years_remaining} (extension?)`);
}
const byAge = {}; for (const [age, d] of dOvr) { const k = age <= 24 ? "<=24" : age <= 28 ? "25-28" : age <= 31 ? "29-31" : "32+"; (byAge[k] ??= []).push(d); }
const mean = (a) => (a.reduce((x, y) => x + y, 0) / a.length).toFixed(2);
out.push("mean Δovr by age(prior year): " + Object.entries(byAge).map(([k, v]) => `${k}: ${mean(v)} (n=${v.length}, min ${Math.min(...v)}, max ${Math.max(...v)})`).join(" | "));
out.push(`age != +1: ${ageBad.length} ${ageBad.slice(0, 3)}; |Δovr|>=15: ${big.length} ${big.slice(0, 4)}; un-retired: ${retNoFlag.length}; contract years increased w/o team change: ${contractBad.length}`);
const names = {}; for (const p of Object.values(bp)) if (!p.retired) (names[p.name] ??= []).push(p.id); const dupN = Object.entries(names).filter(([, v]) => v.length > 1); out.push(`duplicate active names in B: ${dupN.length} ${dupN.slice(0, 3).map(([n, v]) => n + ":" + v.length)}`);
const retired = Object.values(bp).filter((p) => p.retired && !ap[p.id]?.retired); const ra = retired.map((p) => p.age); out.push(`newly retired ${retired.length}, ages min ${Math.min(...ra)} max ${Math.max(...ra)}, ovr mean ${mean(retired.map((p) => p.overall))}; retired age<30: ${retired.filter((p) => p.age < 30).length}`);
const cap = (S) => Object.fromEntries(Object.entries(S.teams).map(([c, t]) => [c, Object.values(S.players).filter((p) => p.nfl_team === c && !p.retired).reduce((a, p) => a + (p.contract?.cap_hit_by_year?.[0] ?? 0), 0)]));
const cB = cap(B); const capv = B.teams[Object.keys(B.teams)[0]].cap; out.push("cap field sample " + JSON.stringify(capv) + "; payroll range B (M) " + (Math.min(...Object.values(cB)) / 1e6).toFixed(1) + ".." + (Math.max(...Object.values(cB)) / 1e6).toFixed(1));
const rs = {}; for (const c of Object.keys(B.teams)) rs[c] = Object.values(bp).filter((p) => p.nfl_team === c && !p.retired).length; out.push(`roster sizes B: min ${Math.min(...Object.values(rs))} max ${Math.max(...Object.values(rs))}`);
console.log(out.join("\n")); if (gone.length) console.log("removed examples:", gone.slice(0, 5).map((id) => `${ap[id].name}(${ap[id].age},${ap[id].nfl_team},ret=${ap[id].retired})`));
