const { chromium } = require('playwright');
const fs = require('fs');
const dir = '/tmp/claude-0/qa8/snaps/';
const only = (process.env.ONLY || '').split(',').filter(Boolean);
const files = fs.readdirSync(dir).filter(f => !only.length || only.some(o => f.includes(o)));
(async () => {
  const b = await chromium.launch();
  for (const f of files) for (const vp of [{n:'d',w:1280,h:800},{n:'m',w:390,h:844}]) {
    const raw = fs.readFileSync(dir+f,'utf8');
    const ctx = await b.newContext({ viewport: { width: vp.w, height: vp.h } });
    await ctx.addInitScript(({raw}) => { try { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('nfl-sim-ui.league', raw); sessionStorage.setItem('seeded','1'); } } catch(e) { window.__seedErr = String(e); } }, { raw });
    const p = await ctx.newPage(); const errs = [];
    p.on('console', m => { if (m.type()==='error') errs.push(m.text().slice(0,160)); });
    p.on('pageerror', e => errs.push('PAGEERROR '+e.message.slice(0,160)));
    p.on('dialog', async d => { errs.push('DIALOG '+d.message().slice(0,100)); await d.dismiss(); });
    await p.goto('http://localhost:4173/'); await p.waitForTimeout(3500);
    const info = await p.evaluate(() => ({ hash: location.hash, sw: document.documentElement.scrollWidth, iw: innerWidth, seedErr: window.__seedErr, h1: (document.querySelector('h1')||{}).innerText, body: document.body.innerText.replace(/\s+/g,' ').slice(0,140), saveFail: /save.*(fail|full|quota)|couldn.t save/i.test(document.body.innerText) }));
    console.log(`${f.replace('.json','')} [${vp.n}] ${info.hash} sw=${info.sw}/${info.iw}${info.sw>info.iw+2?' OVERFLOW':''}${info.saveFail?' SAVEFAIL':''} h1=${(info.h1||'').replace(/\s+/g,' ').slice(0,40)} errs=${[...new Set(errs)].join(' | ')} ${info.seedErr||''}`);
    await p.screenshot({ path: `snap-${vp.n}-${f.replace('.json','')}.png` });
    await ctx.close();
  }
  await b.close();
})();
