const { chromium } = require('playwright'); const fs = require('fs');
const OUT = '/tmp/claude-0/pw/savefail-evidence.txt'; const L = (...a) => { const s = a.join(' '); console.log(s); fs.appendFileSync(OUT, s + '\n'); }; fs.writeFileSync(OUT, '');
const snap = (p) => p.evaluate(() => { const v = localStorage.getItem('nfl-sim-ui.league'); const s = JSON.parse(v).state; const my = s.gms.find(g => g.id === s.viewerGmId).teamCode; const t = s.teams[my]; return { storedLen: v.length, storedStage: s.stage, storedSeason: s.season, storedWeek: s.week, storedRegGamesPlayed: s.games.filter(g => g.played && g.phase === 'REG').length, storedPlayoffGames: s.games.filter(g => g.played && g.phase !== 'REG' && g.phase !== 'PRE').length, record: `${t.wins}-${t.losses}-${t.ties}`, ui: (document.querySelector('h1')?.innerText || '').replace(/\s+/g, ' ').slice(0, 60), hash: location.hash, banner: /isn't being saved/.test(document.body.innerText), chip: (document.querySelector('.stage-chip, header [class*=stage]')?.innerText || '').slice(0,40) }; });
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, storageState: '/tmp/claude-0/pw/qp-state8.json', acceptDownloads: true });
  const p = await ctx.newPage(); p.on('dialog', d => d.accept());
  await p.goto('http://localhost:4173/'); await p.waitForTimeout(3500);
  L('LOAD (stored save from last successful write)', JSON.stringify(await snap(p)));
  const prim = [/^Simulate (Preseason|Regular Season)/, /^Simulate week/, /^Continue/, /^Advance/, /^Ready/i];
  for (let i = 1; i <= 14; i++) {
    const bt = await p.evaluate(() => [...document.querySelectorAll('button:not([disabled])')].filter(e => e.offsetParent).map(e => (e.innerText || '').trim().replace(/\s+/g, ' ')));
    const t = bt.find(x => prim.some(r => r.test(x)));
    if (!t) { L('no primary button at', await p.evaluate(() => location.hash)); break; }
    await p.getByRole('button', { name: t }).first().click().catch(() => {}); await p.waitForTimeout(2200);
    const s = await snap(p); L(`STEP ${i} clicked "${t}" ->`, JSON.stringify(s));
    if (i === 6) await p.screenshot({ path: '/tmp/claude-0/pw/savefail-banner.png' });
  }
  // what the player can still do: download a backup
  const dl = p.waitForEvent('download', { timeout: 10000 }).catch(() => null);
  await p.getByRole('button', { name: 'Download backup' }).click().catch(() => L('Download backup button not clickable'));
  const d = await dl; if (d) { await d.saveAs('/tmp/claude-0/pw/savefail-backup.json'); L('BACKUP downloaded', d.suggestedFilename(), fs.statSync('/tmp/claude-0/pw/savefail-backup.json').size, 'bytes'); } else L('BACKUP: no download');
  // reload: what survives?
  await p.reload(); await p.waitForTimeout(3500);
  L('AFTER RELOAD', JSON.stringify(await snap(p)));
  await p.screenshot({ path: '/tmp/claude-0/pw/savefail-after-reload.png' });
  await b.close();
})();
