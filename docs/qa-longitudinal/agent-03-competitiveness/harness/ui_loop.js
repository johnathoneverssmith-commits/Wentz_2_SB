const { chromium } = require('/home/user/Wentz_2_SB/node_modules/playwright');
const S='/tmp/claude-0/-home-user-Wentz-2-SB/48f7f3e6-cb76-53cd-9dca-00b907312e24/scratchpad';
const TEAM = process.env.TEAM || 'Baltimore Ravens', STEPS = Number(process.env.STEPS || 150);
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] }); const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const reqs = {}; p.on('request', r => { const u = new URL(r.url()); if (u.port === '8787') reqs[u.pathname] = (reqs[u.pathname]||0)+1; });
  p.on('dialog', d => d.accept());
  await p.goto('http://127.0.0.1:5199/', { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: 'New solo dynasty' }).click(); await p.waitForTimeout(1000);
  await p.locator('button', { hasText: TEAM }).first().click(); await p.waitForTimeout(500);
  const ONCE = [/^Quarterbacks/, /^Defensive line/];
  const seen = new Set();
  const PREF = [/let my staff/i, /turn it down/i, /delegate/i, /^confirm/i, /^draft /i, /^sign /i, /^(make|place|submit|send)/i, /start (the )?(league|dynasty|season)/i, /confirm/i, /auto.?(pick|draft|fill|sign|reorder)/i, /sim/i, /^ready/i, /advance/i, /continue/i, /next/i, /start/i, /begin/i, /finish/i, /done/i];
  let last = ''; let stuck = 0;
  for (let i = 0; i < STEPS; i++) {
    const labels = (await p.locator('button:visible:not([disabled])').allTextContents()).map(t => t.trim()).filter(Boolean);
    const hash = await p.evaluate(() => location.hash);
    let clicked = null;
    for (const re of ONCE) { const l = labels.find(x => re.test(x)); if (l && !seen.has(hash + l)) { seen.add(hash + l); clicked = l; break; } }
    if (!clicked) for (const re of PREF) { const l = labels.find(t => re.test(t) && !/skip to content|sound|download|restore|lobby|settings|new solo/i.test(t)); if (l) { clicked = l; break; } }
    if (!clicked && (global.noact = (global.noact||0)+1) <= 40) { await p.mouse.click(640, 450); await p.waitForTimeout(700); continue; }
    if (!clicked) { console.log(i, hash, 'NO ACTION. buttons:', labels.filter(l=>!/^Draft/.test(l)).slice(8, 40).join(' | ')); console.log((await p.locator('main').first().innerText()).replace(/\n+/g,' / ').slice(0,700)); await p.screenshot({ path: S + '/ui_noaction.png' }); break; }
    await p.locator('button:visible', { hasText: clicked.slice(0, 40) }).first().click({ timeout: 5000, force: true }).catch(e => console.log('clickfail', clicked));
    await p.waitForTimeout(600); global.noact = 0;
    const sig = hash + clicked + (await p.locator('body').innerText()).length; stuck = sig === last ? stuck + 1 : 0; last = sig;
    if (hash !== (global.lh||'') || i % 40 === 0 || stuck === 3) { global.lh = hash; } if (hash !== global.lh2 || i % 40 === 0) { global.lh2 = hash; const chip = (await p.locator('aside').first().innerText().catch(()=>'')).replace(/\n+/g,' ').slice(0,90); console.log('   chip:', chip); console.log(i, hash, '->', clicked, 'adapter', JSON.stringify(reqs)); }
    if (stuck > 5) { console.log('STUCK at', hash, 'on', clicked, '| buttons:', labels.slice(0, 14).join(' | ')); break; }
  }
  await p.screenshot({ path: S + '/ui_end.png' }); console.log('final', await p.evaluate(() => location.hash), JSON.stringify(reqs)); await b.close();
})();
