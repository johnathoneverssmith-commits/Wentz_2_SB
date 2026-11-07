const { chromium } = require('playwright'); const fs = require('fs');
const API = 'http://127.0.0.1:8788', STAMP = process.env.STAMP; const out = [];
const L = (...a) => { const s = a.join(' '); console.log(s); out.push(s); };
(async () => {
  const b = await chromium.launch(); const ctxs = {};
  for (const n of ['alice', 'bob']) { ctxs[n] = await b.newContext(); await ctxs[n].request.post(`${API}/auth/login`, { data: { name: `${n}${STAMP}`, password: 'password123' } }); }
  const cc = await b.newContext(); const reg = await cc.request.post(`${API}/auth/register`, { data: { name: `cara${STAMP}`, password: 'password123' } }); L('register outsider cara', reg.status());
  const ls = await (await ctxs.alice.request.get(`${API}/leagues`)).json(); const arr = Array.isArray(ls) ? ls : (ls.leagues || ls.items || []); const lg = arr.find(l => l.name.startsWith('QA4')); const id = lg.id;
  const call = async (who, method, path, data) => { const r = await (who === 'cara' ? cc : ctxs[who]).request.fetch(`${API}${path}`, { method, data }); let j = null; try { j = await r.json(); } catch {} return { s: r.status(), j }; };
  const st = (await call('alice', 'GET', `/leagues/${id}`)).j.state.stage;
  L('league stage', st);
  L('outsider GET league ->', (await call('cara', 'GET', `/leagues/${id}`)).s);
  L('outsider GET league feed ->', (await call('cara', 'GET', `/leagues/${id}/feed`)).s);
  L('outsider POST ready ->', (await call('cara', 'POST', `/leagues/${id}/actions/ready`, { ready: true, stage: st })).s);
  L('non-commissioner (bob) pause ->', (await call('bob', 'POST', `/leagues/${id}/admin/pause`, {})).s);
  L('non-commissioner (bob) advance ->', (await call('bob', 'POST', `/leagues/${id}/admin/advance`, { stage: st })).s);
  L('non-commissioner (bob) transfer commissioner to self ->', (await call('bob', 'POST', `/leagues/${id}/admin/commissioner`, { gmId: 'x' })).s);
  L('commissioner (alice) pause ->', (await call('alice', 'POST', `/leagues/${id}/admin/pause`, {})).s);
  L('paused: bob ready ->', (await call('bob', 'POST', `/leagues/${id}/actions/ready`, { ready: true, stage: st })).s);
  L('commissioner resume ->', (await call('alice', 'POST', `/leagues/${id}/admin/resume`, {})).s);
  L('bob (member) sees invite code in league body? ->', JSON.stringify(Object.keys((await call('bob', 'GET', `/leagues/${id}`)).j)).slice(0, 200));
  fs.writeFileSync('/tmp/claude-0/pw/perm.txt', out.join('\n'));
  await b.close();
})();
