const { chromium } = require('/home/user/Wentz_2_SB/node_modules/playwright'); const fs=require('fs'); const OUT=__dirname+'/shots/mp';
const ST=fs.readFileSync(OUT+'/log.txt','utf8').match(/alice(\d+)/)[1]; const API='http://localhost:8788';
const log=s=>{console.log(s);fs.appendFileSync(OUT+'/log.txt',s+'\n')};
(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
const gms={};
for(const n of ['alice','bob','cara']){const c=await b.newContext({viewport:{width:1440,height:900}});const p=await c.newPage();p.on('dialog',d=>d.accept());
 await p.goto('http://localhost:4173/#/online');await p.waitForTimeout(1800);await p.getByLabel('Name').fill(n+ST);await p.getByLabel('Password').fill('password123');await p.getByRole('button',{name:'Sign in'}).click();await p.waitForTimeout(2200);gms[n]={c,p};}
const post=(n,path,body)=>gms[n].p.evaluate(async([path,body])=>{const l=await (await fetch('http://localhost:8788/leagues',{credentials:'include'})).json();const id=(l.leagues||l)[0].id;const r=await fetch('http://localhost:8788/leagues/'+id+path,{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify(body||{})});let j=null;try{j=await r.json()}catch{}return {s:r.status,j:j&&(j.error||j.message||null)}},[path,body]);
const state=n=>gms[n].p.evaluate(async()=>{const l=await (await fetch('http://localhost:8788/leagues',{credentials:'include'})).json();const id=(l.leagues||l)[0].id;const r=await (await fetch('http://localhost:8788/leagues/'+id,{credentials:'include'})).json();return {stage:r.state.stage,v:r.version,paused:!!r.state.pause}});
log('resume '+JSON.stringify(await post('alice','/admin/resume')));
let s0=await state('alice'); log('state '+JSON.stringify(s0));
log('alice ready '+JSON.stringify(await post('alice','/actions/ready',{ready:true,stage:s0.stage})));
for(const n of ['alice','bob','cara']){await gms[n].p.goto('http://localhost:4173/#/online');await gms[n].p.waitForTimeout(1500);}
await gms.alice.p.getByRole('button',{name:'Open'}).first().click().catch(e=>log('no open'));await gms.alice.p.waitForTimeout(2500);await gms.alice.p.screenshot({path:OUT+'/30_alice_ready_waiting_for_others.png',fullPage:true});
log('alice view: '+(await gms.alice.p.evaluate(()=>document.querySelector('main').innerText)).slice(-500).replace(/\n/g,' | '));
for(const n of ['bob','cara']) log(n+' ready '+JSON.stringify(await post(n,'/actions/ready',{ready:true,stage:s0.stage})));
let s1=await state('alice'); log('state after all ready '+JSON.stringify(s1));
for(const n of ['alice','bob']){await gms[n].p.goto('http://localhost:4173/#/online');await gms[n].p.waitForTimeout(1500);await gms[n].p.getByRole('button',{name:/^(Open|Play|Take)/}).first().click().catch(e=>log('no open '+n));await gms[n].p.waitForTimeout(3500);await gms[n].p.screenshot({path:OUT+`/31_${n}_draft_stage.png`,fullPage:false});
 log(n+' h1/stage: '+await gms[n].p.evaluate(()=>location.hash+' '+(document.querySelector('main h1')?.innerText||'').replace(/\n/g,' ')));
 log(n+' buttons: '+(await gms[n].p.evaluate(()=>[...document.querySelectorAll('main button')].filter(e=>e.offsetParent).slice(0,14).map(e=>e.innerText.trim().replace(/\s+/g,' ').slice(0,40)).join(' | '))));}
await b.close()})()
