import { readFileSync } from "node:fs";
for (const f of process.argv.slice(2)) {
  const s = JSON.parse(readFileSync(f, "utf8")).state; const rows = []; let over = 0, mism = 0, worst = 0, neg = 0;
  for (const [c, t] of Object.entries(s.teams)) {
    const sum = Object.values(s.players).filter((p) => p.nfl_team === c && !p.retired).reduce((a, p) => a + (p.contract?.cap_hit_by_year?.[0] ?? 0), 0);
    const used = t.cap.used, d = used - (sum + t.cap.dead); if (t.cap.used > t.cap.total + 0.05) over++; if (Math.abs(d) > 0.5) { mism++; worst = Math.max(worst, Math.abs(d)); }
    if (t.cap.used < 0 || t.cap.dead < 0) neg++;
    rows.push({ c, used, sum: +sum.toFixed(1), dead: t.cap.dead, total: t.cap.total });
  }
  console.log(f.split("/").pop(), `stage=${s.stage}`, `teams over cap: ${over}`, `used≠Σcap_hit(0): ${mism} (worst ${worst.toFixed(1)}M)`, `negative: ${neg}`, mism ? JSON.stringify(rows.filter((r) => Math.abs(r.used - r.sum) > 0.5).slice(0, 2)) : "");
}
