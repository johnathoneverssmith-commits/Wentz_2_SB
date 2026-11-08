const { chromium } = require('playwright'); const fs = require('fs');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const raw = fs.readFileSync('/tmp/claude-0/qa8/snaps/2027_regularSeason_w1.json', 'utf8');
  await ctx.addInitScript(({ raw }) => { if (!sessionStorage.getItem('s')) { localStorage.setItem('nfl-sim-ui.league', raw); sessionStorage.setItem('s', '1'); } }, { raw });
  const p = await ctx.newPage(); p.on('dialog', d => d.accept());
  let blocked = false; const hits = { ok: 0, blocked: 0 };
  await p.route(/localhost:8787/, route => { if (blocked) { hits.blocked++; return route.abort('connectionrefused'); } hits.ok++; return route.continue(); });
  await p.goto('http://localhost:4173/'); await p.waitForTimeout(3000);
  const wk = async () => p.evaluate(() => { const s = JSON.parse(localStorage.getItem('nfl-sim-ui.league')).state; const my = s.gms.find(g => g.id === s.viewerGmId).teamCode; const g = s.games.filter(x => x.played && x.phase === 'REG'); const byWeek = {}; for (const x of g) { (byWeek[x.week] ??= { n: 0, withBroadcast: 0, withLines: 0, oddScores: 0, plans: 0 }); byWeek[x.week].n++; if (x.broadcast) byWeek[x.week].withBroadcast++; if (x.playerLines) byWeek[x.week].withLines++; if ([1].includes(x.homeScore) || [1].includes(x.awayScore)) byWeek[x.week].oddScores++; if (x.plans) byWeek[x.week].plans++; } return byWeek; });
  const click = async (re) => { await p.getByRole('button', { name: re }).first().click({ timeout: 4000 }).catch(e => console.log('noclick', re)); await p.waitForTimeout(2500); };
  for (let w = 1; w <= 8; w++) {
    if (w === 3) { blocked = true; console.log('--- adapter blocked from here (simulates a transient/ unreachable adapter) ---'); }
    await click(/^(Ready for Game Day|Simulate week)/); const txt = await p.evaluate(() => document.body.innerText.replace(/\s+/g, ' ')); console.log(`after sim #${w}: hash`, await p.evaluate(() => location.hash), '| indicator words:', /offline|approximate|fallback|standalone|mock/i.test(txt) ? txt.match(/.{30}(offline|approximate|fallback|standalone|mock).{40}/i)?.[0] : 'none'); await click(/^Continue/);
  }
  console.log(JSON.stringify(await wk())); console.log('route hits', JSON.stringify(hits));
  await p.screenshot({ path: '/tmp/claude-0/pw/fallback-mid.png' });
  await b.close();
})();
