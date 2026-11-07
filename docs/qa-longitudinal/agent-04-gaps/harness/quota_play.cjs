const { chromium } = require('playwright');
const fs = require('fs');
const SNAP = process.argv[2]; const MAX = +(process.argv[3]||40); const OUTSTATE = process.argv[4];
const prim = [/^Simulate the /, /^Turn It Down/, /^Pass this turn/, /^Simulate (Preseason|Regular Season)/, /^Simulate week/, /^Play /, /^I'm ready to begin/, /^Advance/, /^Continue/, /^Ready/i, /^Skip/i, /^Next/i, /^Sign all|^Sign /i, /Finish|Done$/i];
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, storageState: (process.argv[2]==='RESUME') ? (process.env.RESFILE||'/tmp/claude-0/pw/qp-state.json') : undefined });
  const RES = SNAP === 'RESUME'; const raw = RES ? '' : fs.readFileSync(SNAP, 'utf8');
  await ctx.addInitScript(({ raw }) => { if (raw && !sessionStorage.getItem('seeded')) { localStorage.setItem('nfl-sim-ui.league', raw); sessionStorage.setItem('seeded', '1'); } }, { raw });
  const p = await ctx.newPage(); const errs = [];
  p.on('console', m => { if (m.type()==='error') errs.push(m.text().slice(0,150)); });
  p.on('pageerror', e => errs.push('PAGEERROR '+e.message.slice(0,150)));
  p.on('dialog', async d => { errs.push('DIALOG '+d.message().slice(0,80)); await d.accept(); });
  await p.goto('http://localhost:4173/'); await p.waitForTimeout(3000);
  const probe = () => p.evaluate(() => { const v = localStorage.getItem('nfl-sim-ui.league'); let st=null,season=null; try { const s = JSON.parse(v).state; st = s.stage; season = s.season; } catch {} return { hash: location.hash, len: v ? v.length : 0, stage: st, season, banner: /isn't being saved/.test(document.body.innerText), btns: [...document.querySelectorAll('button:not([disabled])')].filter(e=>e.offsetParent).map(e=>(e.innerText||'').trim().replace(/\s+/g,' ')).filter(Boolean) }; });
  let lastKey = '';
  for (let i = 0; i < MAX; i++) {
    const ov = p.locator('.fs-overlay'); if (await ov.count()) { await ov.first().click({position:{x:300,y:300}}).catch(()=>{}); await p.waitForTimeout(500); }
    const s = await probe();
    if (OUTSTATE && i % 15 === 0) await ctx.storageState({ path: OUTSTATE });
    if (`${s.stage}|${s.season}` !== lastKey || i % 10 === 0) console.log(`${i} ${s.hash} stored(stage=${s.stage},season=${s.season},len=${s.len}) BANNER=${s.banner}`);
    lastKey = `${s.stage}|${s.season}`;
    let t;
    if (/training-camp/.test(s.hash) && s.btns.some(x=>/players ·/.test(x)) && !global.camp) { const cards = p.locator('button', { hasText: /players ·/ }); const n = await cards.count(); await cards.nth(0).click().catch(()=>{}); await p.waitForTimeout(300); if (n > 4) await cards.nth(4).click().catch(()=>{}); await p.waitForTimeout(600); global.camp = true; console.log('  camp focus chosen'); continue; }
    if (!/training-camp/.test(s.hash)) global.camp = false;
    const conf = s.btns.find(x => /^(Confirm|Submit|Lock in|Save focus)/i.test(x)); if (conf) { console.log('  confirm:', conf); await p.getByRole('button',{name:conf}).first().click({timeout:3000}).catch(()=>{}); await p.waitForTimeout(700); continue; }
    const pass = /free-agency/.test(s.hash) && s.btns.find(x => /^Pass this round/.test(x)); if (pass && !s.btns.find(x=>/^(Continue|Advance|Ready)/.test(x))) { await p.getByRole('button',{name:pass}).first().click().catch(()=>{}); await p.waitForTimeout(900); continue; }
    const doFix = s.btns.find(x => /^Fix the roster$/.test(x)); if (doFix) { console.log('  fix the roster (confirm)'); await p.getByRole('button',{name:doFix,exact:true}).first().click().catch(()=>{}); await p.waitForTimeout(1500); continue; }
    const fix = s.btns.find(x => /^Let my staff fix the roster/.test(x)); if (fix) { console.log('  staff fix'); await p.getByRole('button',{name:fix}).first().click().catch(()=>{}); await p.waitForTimeout(1500); continue; }
    const d = s.btns.find(x => /^Draft [A-Z]/.test(x));
    if (d) t = d; else t = s.btns.find(x => prim.some(re => re.test(x)));
    if (!t) { console.log('  no primary button; buttons:', s.btns.filter(x=>x.length<60).slice(0,25).join(' ¦ ')); await p.screenshot({ path: `qp-stuck-${i}.png` }); break; }
    if (d) { await p.locator('.fs-overlay').first().waitFor({timeout:1500}).catch(()=>{}); for (let k=0;k<3;k++){ const n = await p.evaluate(() => { const o=document.querySelectorAll('.fs-overlay'); o.forEach(e=>e.click()); return o.length; }); if(!n) break; await p.waitForTimeout(500);} }
    await p.getByRole('button', { name: t }).first().click({ timeout: 4000 }).catch(async e => { console.log('  click fail', t, e.message.split('\n').slice(0,10).join(' / ')); await p.screenshot({path:'qp-failclick.png'}); });
    await p.waitForTimeout(d ? 600 : 1800);
    if (s.banner) { await p.screenshot({ path: `qp-banner-${i}.png` }); }
  }
  if (OUTSTATE) await ctx.storageState({ path: OUTSTATE });
  console.log('ERRS', [...new Set(errs)].join(' | '));
  await b.close();
})();
