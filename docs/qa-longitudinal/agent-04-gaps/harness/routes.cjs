const { chromium } = require('playwright'); const fs=require('fs');
(async()=>{
 const b=await chromium.launch();
 const raw=fs.readFileSync('/tmp/claude-0/size10/snaps/2028_preseason.json','utf8');
 for (const r of ['/foo','/box/nope','/watch/nope','/draft','/trade-deadline','/free-agency-board','/gallery','/results/REG/1/3','/results/round/XX','/online','/game-day','/bracket','/hot-seat']) {
  const ctx=await b.newContext({viewport:{width:1280,height:800}});
  await ctx.addInitScript(({raw})=>{ if(!sessionStorage.getItem('s')){localStorage.setItem('nfl-sim-ui.league',raw);sessionStorage.setItem('s','1');}},{raw});
  const p=await ctx.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message.slice(0,100)));
  await p.goto('http://localhost:4173/'); await p.waitForTimeout(2000);
  await p.evaluate(h=>{location.hash='#'+h},r); await p.waitForTimeout(1800);
  const t=await p.evaluate(()=>({hash:location.hash,h1:(document.querySelector('h1')||{}).innerText,body:document.body.innerText.replace(/\s+/g,' ').slice(0,0)}));
  const sel = await p.evaluate(()=>{const m=document.querySelector('main'); return m? m.innerText.replace(/\s+/g,' ').slice(0,110):''});
  console.log(r.padEnd(26),'->',t.hash.padEnd(22),(t.h1||'').replace(/\s+/g,' ').slice(0,40).padEnd(40),'|',sel,errs.join(';'));
  await ctx.close();
 }
 await b.close();})();
