const { chromium } = require('playwright'); const fs = require('fs');
const API = 'http://127.0.0.1:8788'; const STAMP = process.env.STAMP; const OUT = '/tmp/claude-0/pw/probe.jsonl';
(async () => {
  const b = await chromium.launch(); const gms = {};
  for (const n of ['alice', 'bob']) { const ctx = await b.newContext(); const r = ctx.request; const l = await r.post(`${API}/auth/login`, { data: { name: `${n}${STAMP}`, password: 'password123' } }); gms[n] = { r, ok: l.status() }; }
  const ls = await (await gms.alice.r.get(`${API}/leagues`)).json(); const arr = Array.isArray(ls) ? ls : (ls.leagues || ls.items || []); const lg = arr.find(l => l.name.startsWith('QA4')); console.log('league', lg && lg.id, JSON.stringify(gms.alice.ok));
  fs.writeFileSync(OUT, '');
  const end = Date.now() + (+process.env.MIN || 40) * 60000;
  while (Date.now() < end) {
    const row = { t: new Date().toISOString().slice(11, 19) };
    for (const n of ['alice', 'bob']) {
      try { const body = await (await gms[n].r.get(`${API}/leagues/${lg.id}`)).json(); const st = body.state; const reg = st.games.filter(g => g.played && g.phase === 'REG');
        const me = (st.gms || []).find(g => g.id === (body.gmId || body.you?.gmId || st.viewerGmId));
        row[n] = { stage: st.stage, week: st.week, regPlayed: reg.length, maxRegWeek: reg.reduce((m, g) => Math.max(m, g.week), 0), regRevealed: st.reveal?.regularWeek, bracketMatchupsWithScores: (st.bracket?.matchups || []).filter(m => m.homeScore != null && m.winner).length, ver: body.version, keys: undefined }; } catch (e) { row[n] = { err: e.message.slice(0, 60) }; }
    }
    fs.appendFileSync(OUT, JSON.stringify(row) + '\n'); await new Promise(r => setTimeout(r, 4000));
  }
  await b.close();
})();
