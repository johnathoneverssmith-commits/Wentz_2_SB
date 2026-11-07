const { chromium } = require('playwright');
const fs = require('fs');
const UI = 'http://localhost:4173', API = 'http://127.0.0.1:8788';
const STAMP = Date.now() % 1000000; console.log('STAMP', STAMP);
const MAXMIN = +(process.env.MAXMIN || 20);
const log = (...a) => { const l = a.join(' '); console.log(l); fs.appendFileSync('/tmp/claude-0/pw/mp.log', l + '\n'); };
const prim = [/^Turn It Down/, /^Pass this turn/, /^Simulate (Preseason|Regular Season)/, /^Simulate week/, /^Play /, /^I'm ready/, /^Ready/i, /^Advance/, /^Continue/, /^Skip/i, /^Start the draft/i];
async function gm(b, name) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } }); const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message.slice(0, 120)));
  page.on('dialog', async d => { errs.push('DIALOG ' + d.message().slice(0, 80)); await d.accept(); });
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 120)); });
  await page.goto(`${UI}/#/online`);
  await page.getByRole('button', { name: 'Create an account' }).click();
  await page.getByLabel('Name').fill(`${name}${STAMP}`); await page.getByLabel('Password').fill('password123');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByText(`Signed in as ${name}${STAMP}`).waitFor({ timeout: 20000 });
  return { name, ctx, page, errs, last: '', stuck: 0 };
}
async function stage(g) { return g.page.evaluate(() => { const e = [...document.querySelectorAll('*')].find(x => x.children.length === 0 && /CURRENT STAGE/i.test(x.textContent || '')); return (document.querySelector('[aria-current="page"], .nav-current')?.innerText || '').replace(/\s+/g, ' ').slice(0, 50); }); }
async function step(g) {
  const p = g.page;
  const info = await p.evaluate(() => ({ hash: location.hash, btns: [...document.querySelectorAll('button:not([disabled])')].filter(e => e.offsetParent).map(e => (e.innerText || '').trim().replace(/\s+/g, ' ')).filter(Boolean), banner: (document.querySelector('.notice, [role=status]')?.innerText || '').replace(/\s+/g, ' ').slice(0, 90), head: document.querySelector('h1')?.innerText.replace(/\s+/g, ' ').slice(0, 40) }));
  const key = `${info.hash}|${info.head}`;
  if (key !== g.last) { log(`[${g.name}] ${info.hash} | ${info.head} | ${info.banner}`); g.last = key; g.stuck = 0; } else g.stuck++;
  await p.evaluate(() => document.querySelectorAll('.fs-overlay').forEach(e => e.click()));
  const B = info.btns; let t;
  if (/training-camp/.test(info.hash) && B.some(x=>/players ·/.test(x)) && !g.camp) { const cards = p.locator('button', { hasText: /players ·/ }); const n = await cards.count(); await cards.nth(0).click().catch(()=>{}); await p.waitForTimeout(300); if (n > 4) await cards.nth(4).click().catch(()=>{}); await p.waitForTimeout(600); g.camp = true; log(`[${g.name}] camp focus chosen; buttons now: ` + (await p.evaluate(() => [...document.querySelectorAll('button:not([disabled])')].filter(e=>e.offsetParent).map(e=>e.innerText.trim().replace(/\s+/g,' ')).filter(x=>x && x.length<60 && !/players ·/.test(x)).slice(7).join(' ¦ ')))); return { info, acted: true }; }
  if (!/training-camp/.test(info.hash)) g.camp = false;
  t = B.find(x => /^(Confirm|Submit|Lock in|Save focus)/i.test(x)) || B.find(x => /^Got it$/.test(x)) || (/coaching-draft/.test(info.hash) && B.find(x => /^(Draft|Hire) /.test(x))) || B.find(x => /^Let my staff fix the roster/.test(x)) || B.find(x => /^Draft [A-Z]/.test(x)) || (/free-agency|coaching/.test(info.hash) && B.find(x => /^Pass this round/.test(x)) && !B.find(x => /^(Continue|Advance|Ready)/.test(x)) && B.find(x => /^Pass this round/.test(x))) || B.find(x => prim.some(re => re.test(x)));
  if (!t && g.stuck === 6) log(`[${g.name}] STUCK-BTNS ${info.hash}: ` + B.filter(x=>x.length<70).slice(7,45).join(' ¦ '));
  if (!t) return { info, acted: false };
  await p.getByRole('button', { name: t }).first().click({ timeout: 3000 }).catch(() => {});
  return { info, acted: true, t };
}
(async () => {
  fs.writeFileSync('/tmp/claude-0/pw/mp.log', '');
  const b = await chromium.launch();
  const A = await gm(b, 'alice'), B = await gm(b, 'bob');
  log('registered two GMs in independent browser contexts');
  await A.page.getByText('Start a League').first().click();
  await A.page.getByLabel('League name').fill(`QA4 ${STAMP}`);
  await A.page.getByLabel('League format').selectOption('humansOnly');
  await A.page.getByLabel('Human GMs2345678').selectOption('2');
  await A.page.getByRole('button', { name: 'Create league' }).click();
  await A.page.getByText(/Invite code:/).waitFor({ timeout: 20000 });
  const code = (await A.page.getByText(/Invite code:/).innerText()).match(/Invite code:\s*([A-Z0-9]+)/)[1];
  log('league created, invite', code);
  await A.page.getByRole('button', { name: /^(Claim a team in|Open) QA4/ }).first().click();
  await A.page.getByRole('button', { name: 'Claim Green Bay', exact: true }).click();
  await B.page.getByText('Join a League').first().click();
  await B.page.getByPlaceholder('ABC12345').fill(code);
  await B.page.getByRole('button', { name: 'Look it up' }).click();
  await B.page.getByRole('button', { name: 'Claim Kansas City', exact: true }).click();
  await A.page.waitForTimeout(1500);
  const end = Date.now() + MAXMIN * 60000; let it = 0;
  while (Date.now() < end) {
    const [ra, rb] = await Promise.all([step(A), step(B)]);
    await A.page.waitForTimeout(900);
    it++;
    if (it % 40 === 0) log(`-- it ${it} A stuck=${A.stuck} B stuck=${B.stuck}`);
    if (A.stuck > 400 && B.stuck > 400) {
      try { const ls = await (await A.page.request.get(`${API}/leagues`)).json(); const lg = (Array.isArray(ls) ? ls : (ls.leagues || ls.items || [])).find(l => l.name === `QA4 ${STAMP}`); const body = await (await A.page.request.get(`${API}/leagues/${lg.id}`)).json(); const st = body.state; log('API top keys', Object.keys(body).join(','), '| stage', st.stage, 'week', st.week, '| keys', Object.keys(st).filter(k => /block|job|reveal|sim|pause|ready/i.test(k)).join(','), '| reveal', JSON.stringify(st.reveal).slice(0, 300), '| games', st.games.length, '| pause', JSON.stringify(st.pause)); } catch (e) { log('API probe failed', e.message.slice(0,100)); } log('BOTH STUCK', A.last, '|', B.last, '| btnsA:', (await step(A)).info.btns.slice(0, 12).join(' ¦ ')); await A.page.screenshot({ path: '/tmp/claude-0/pw/mp-stuckA.png' }); await B.page.screenshot({ path: '/tmp/claude-0/pw/mp-stuckB.png' }); break; }
  }
  log('ERRS A', [...new Set(A.errs)].join(' | ')); log('ERRS B', [...new Set(B.errs)].join(' | '));
  await b.close();
})().catch(e => { log('FATAL', e.message.slice(0, 300)); process.exit(1); });
