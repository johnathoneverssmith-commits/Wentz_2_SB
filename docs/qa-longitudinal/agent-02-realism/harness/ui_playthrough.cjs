/**
 * Agent 02 interactive playthrough driver. Drives the REAL built UI (ui-source/dist) in Chromium through Playwright, with the
 * engine adapter (server/index.ts, :8787) answering week/playoff simulation. It only clicks buttons the player can click and
 * reads the app's own localStorage save (nfl-sim-ui.league) to know the stage and to capture season data.
 *
 *   NODE_PATH=$(npm root -g) node ui_playthrough.cjs <team name> <seasons> <outdir> [seed-note]
 */
const { chromium } = require('playwright');
const fs = require('fs');
const KEY = 'nfl-sim-ui.league';
const TEAM = process.argv[2] || 'Cincinnati Bengals';
const SEASONS = Number(process.argv[3] || 5);
const OUT = process.argv[4] || '/tmp/a02/ui';
fs.mkdirSync(OUT, { recursive: true });
const LOG = fs.createWriteStream(`${OUT}/actions.jsonl`, { flags: 'a' });
const SEASON_OUT = `${OUT}/seasons.jsonl`;
const log = (o) => LOG.write(JSON.stringify({ t: Date.now(), ...o }) + '\n');

const TOT = ["points", "totalYards", "passYards", "rushYards", "plays", "thirdDownMade", "thirdDownAtt", "topSeconds", "penalties", "penaltyYards", "turnovers", "passAtt", "passComp", "sacksAllowed", "qbHits", "intThrown", "fumblesLost", "krTd", "prTd", "kickPoints"];

(async () => {
  const browser = await chromium.launch(process.env.PW_EXEC ? { executablePath: process.env.PW_EXEC } : {});
  const stateFile = `${OUT}/storage.json`;
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce', serviceWorkers: 'block',
    ...(fs.existsSync(stateFile) && process.env.RESUME ? { storageState: stateFile } : {}) });
  const page = await ctx.newPage();
  page.on('dialog', (d) => { log({ dialog: d.message().slice(0, 120) }); d.accept(); });
  page.on('pageerror', (e) => log({ pageerror: e.message }));
  page.on('console', (m) => { if (m.type() === 'error') log({ consoleError: m.text().slice(0, 300) }); });
  const failedReq = [];
  page.on('requestfailed', (r) => failedReq.push(r.url()));
  await page.goto('http://127.0.0.1:4173/');
  await page.waitForTimeout(800);

  const st = () => page.evaluate((k) => { const r = localStorage.getItem(k); if (!r) return null; const s = JSON.parse(r).state; return { stage: s.stage, season: s.season, week: s.week, champ: s.bracket && s.bracket.champion || null, draftIdx: s.draft ? s.draft.currentPickIndex : null, draftLen: s.draft ? s.draft.pickOrder.length : null }; }, KEY);
  const btns = () => page.$$eval('button:not([disabled]), a[role="button"]', (bs) => bs.filter((b) => b.offsetParent).map((b) => b.innerText.trim().replace(/\s+/g, ' ')).filter(Boolean));

  const capture = async (tag) => {
    const data = await page.evaluate(({ k, TOT }) => {
      const s = JSON.parse(localStorage.getItem(k)).state;
      const games = (s.games || []).filter((g) => g.played).map((g) => [g.phase, g.week, g.homeTeam, g.awayTeam, g.homeScore, g.awayScore, g.weather || '', (g.injuries || []).length,
        g.totals ? TOT.map((x) => g.totals.home[x] ?? null) : null, g.totals ? TOT.map((x) => g.totals.away[x] ?? null) : null, g.totals ? g.totals.home.byQuarter : null, g.totals ? g.totals.away.byQuarter : null]);
      const inj = []; for (const g of s.games || []) for (const e of g.injuries || []) inj.push([g.phase, g.week, e.team, e.playerId, e.position, e.severity, e.projectedWeeks, e.bodyPart]);
      const stats = []; const rows = [];
      for (const p of Object.values(s.players)) {
        if (p.season_stats && p.season_stats.gamesPlayed) stats.push([p.id, p.position, p.age, p.overall, p.nfl_team, p.season_stats]);
        rows.push([p.id, p.position, p.age, p.overall, p.nfl_team, p.retired ? 1 : 0, p.free_agent ? 1 : 0, p.potential ?? null, p.contract ? p.contract.salary : null]);
      }
      return { season: s.season, games, inj, stats, bracket: s.bracket, champion: s.bracket && s.bracket.champion, rows, me: (s.gms.find((g) => g.id === s.viewerGmId) || {}).teamCode, config: s.config };
    }, { k: KEY, TOT });
    fs.appendFileSync(SEASON_OUT, JSON.stringify({ kind: tag, ...data, cols: TOT }) + '\n');
  };

  const click = async (re) => {
    const loc = page.getByRole('button', { name: re }).filter({ hasNot: page.locator('[disabled]') });
    const n = await loc.count();
    for (let i = 0; i < n; i++) { const b = loc.nth(i); if (await b.isVisible() && await b.isEnabled()) { const label = (await b.innerText()).trim().replace(/\s+/g, ' '); await b.click({ timeout: 5000 }); log({ click: label }); return label; } }
    return null;
  };

  // setup
  if (!(await st())) {
    await page.getByRole('button', { name: new RegExp(TEAM) }).click();
    log({ chose: TEAM });
    await click(/I'm ready to begin/);
  }
  let last = '', stuck = 0, captured = new Set(), done = 0, startSeason = null, iter = 0;
  const T0 = Date.now();
  while (iter++ < 6000) {
    const s = await st();
    if (!s) { await page.waitForTimeout(500); continue; }
    if (startSeason === null) startSeason = s.season;
    const key = JSON.stringify(s) + page.url();
    const busy = await page.getByText(/Simulating…|Simulating\.\.\.|Loading|Running camp|Working/).first().isVisible().catch(() => false);
    if (key === last && !busy) stuck++; else { stuck = 0; last = key; log({ state: s }); if (!(s.stage === 'fantasyDraft' || s.stage === 'offseasonDraft')) await ctx.storageState({ path: stateFile }); }
    // season capture when champion is decided (post-playoffs), once per season
    if (s.champ && !captured.has(s.season) && /endOfSeason/.test(s.stage)) { await capture('season'); captured.add(s.season); done++; log({ captured: s.season, done }); await ctx.storageState({ path: stateFile }); }
    if (done >= SEASONS && /offseason|endOfSeason/.test(s.stage) === true && s.stage === 'offseasonHotSeat') break;
    if (stuck > 30) { log({ STUCK: s, buttons: await btns(), text: (await page.evaluate(() => document.body.innerText)).slice(0, 1500) }); await page.screenshot({ path: `${OUT}/stuck_${s.stage}.png` }); console.log('STUCK at', JSON.stringify(s)); console.log(await btns()); break; }
    const order = [
      /^Draft [A-Z]/, /^Confirm pick/, /^Hire [A-Z]/, /^I'm ready to begin/, /^Ready for Game Day/, /^Play (the )?(next )?round/i, /^Simulate/i,
      /^Let my staff fix the roster/i, /^Fix the roster/i, /^Make the offer/i, /^Pass$/i, /^Go ahead/i, /^Let my staff (handle|take)/i, /^Pass this round/i, /^Skip (free agency|this|the)/i, /^Continue/i, /^Advance/i, /^Ready (to|for)/i, /^Next/i, /^Begin/i, /^Start/i, /^Proceed/i,
      /^Done/i, /^Finish/i, /^Confirm/i, /^Accept/i, /^Close/i, /^OK$/i, /^Sign/i,
    ];
    let did = null;
    if (s.stage === 'trainingCamp') {
      const OFF = ['OFFENSIVE LINE', 'QUARTERBACKS', 'RECEIVERS AND TIGHT ENDS', 'RUNNING BACKS']; const DEF = ['DEFENSIVE LINE AND EDGE', 'DEFENSIVE BACKS', 'LINEBACKERS'];
      const yr = (s.season - startSeason);
      const pick = async (list) => { for (let k = 0; k < list.length; k++) { const name = list[(yr + k) % list.length]; const b = page.getByRole('button', { name: new RegExp('^' + name, 'i') }).first(); if (await b.isVisible().catch(() => false)) { const pressed = await b.getAttribute('aria-pressed'); if (pressed !== 'true') { await b.click(); log({ click: 'focus ' + name }); } return true; } } return false; };
      await pick(OFF); await pick(DEF);
    }
    if (stuck % 3 === 0 && await page.getByText(/Tap or click anywhere/).first().isVisible().catch(() => false)) { await page.mouse.click(700, 300); log({ click: '(overlay: tap anywhere)' }); await page.waitForTimeout(300); continue; }
    for (const re of order) { try { did = await click(re); } catch (e) { log({ clickErr: String(e).slice(0, 200) }); } if (did) break; }
    if (!did) { await page.waitForTimeout(400); if (stuck > 8) log({ nobutton: s.stage, buttons: await btns() }); }
    await page.waitForTimeout(150);
    if (iter % 50 === 0) await ctx.storageState({ path: stateFile });
  }
  await capture('final');
  await ctx.storageState({ path: stateFile });
  console.log('finished', JSON.stringify(await st()), 'seasons captured', done, 'minutes', ((Date.now() - T0) / 60000).toFixed(1), 'failed requests', failedReq.length);
  await browser.close();
})();
