const { chromium } = require('/home/user/Wentz_2_SB/node_modules/playwright'); const fs=require('fs');
const OUT=__dirname+'/shots/mp'; const BASE='http://localhost:4173'; const stamp=Date.now()%1000000;
const log=s=>{console.log(s);fs.appendFileSync(OUT+'/log.txt',s+'\n')};
(async()=>{
 const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
 const shot=async(p,n,full)=>{await p.waitForTimeout(700);await p.screenshot({path:`${OUT}/${n}.png`,fullPage:!!full});};
 async function gm(name,w=1440,h=900){const c=await b.newContext({viewport:{width:w,height:h}});const p=await c.newPage();p.errs=[];p.on('pageerror',e=>p.errs.push(e.message));
  await p.goto(BASE+'/#/online'); await p.waitForTimeout(2500); return {c,p,name:name+stamp};}
 const a=await gm('alice');
 await shot(a.p,'01_lobby_signedout',true);
 log('signedout text: '+(await a.p.evaluate(()=>document.querySelector('main').innerText)).slice(0,300).replace(/\n/g,' | '));
 try{ await a.p.getByRole('button',{name:'Create an account'}).click(); await shot(a.p,'02_create_account_form');
  await a.p.getByLabel('Name').fill(a.name); await a.p.getByLabel('Password').fill('password123');
  // refused sign-in state: wrong password first on a bogus account via sign-in form
  await a.p.getByRole('button',{name:'Create account'}).click(); await a.p.getByText('Signed in as '+a.name).waitFor({timeout:8000}); await shot(a.p,'03_lobby_signedin_empty',true);
 }catch(e){log('ERR signup '+e.message.slice(0,150))}
 try{ await a.p.getByText('Start a League').first().click(); await shot(a.p,'04_start_league_form',true);
  await a.p.getByLabel('League name').fill('Visual Test '+stamp); await a.p.getByLabel('League format').selectOption('humansOnly'); await a.p.getByLabel('Human GMs2345678').selectOption('3');
  await a.p.getByRole('button',{name:'Create league'}).click(); await a.p.getByText(/Invite code:/).waitFor({timeout:10000}); await shot(a.p,'05_league_created_invite',true);
 }catch(e){log('ERR create '+e.message.slice(0,150))}
 let code=''; try{code=(await a.p.getByText(/Invite code:/).innerText()).match(/Invite code:\s*([A-Z0-9]+)/)[1]; log('code '+code);}catch{}
 try{ await a.p.getByRole('button',{name:/^(Claim a team in|Open) Visual/}).first().click(); await shot(a.p,'06_commissioner_claim_team',true); await a.p.getByRole('button',{name:'Claim Green Bay',exact:true}).click(); await shot(a.p,'07_commissioner_after_claim',true);}catch(e){log('ERR claim '+e.message.slice(0,150))}
 const others=[];
 for(const [n,team] of [['bob','Kansas City'],['cara','Dallas']]){ try{ const g=await gm(n); await g.p.getByRole('button',{name:'Create an account'}).click(); await g.p.getByLabel('Name').fill(g.name); await g.p.getByLabel('Password').fill('password123'); await g.p.getByRole('button',{name:'Create account'}).click(); await g.p.getByText('Signed in as '+g.name).waitFor({timeout:8000});
   await g.p.getByText('Join a League').first().click(); await g.p.getByPlaceholder('ABC12345').fill(code); await g.p.getByRole('button',{name:'Look it up'}).click(); await shot(g.p,`08_join_${n}_lookup`,true); await g.p.getByRole('button',{name:`Claim ${team}`,exact:true}).click(); await shot(g.p,`09_${n}_claimed_waiting`,true); others.push(g);}catch(e){log('ERR '+n+' '+e.message.slice(0,150))}}
 // lobby/waiting for the commissioner after joins
 await a.p.reload(); await a.p.waitForTimeout(2000); await shot(a.p,'10_commissioner_league_waiting',true);
 log('commissioner text: '+(await a.p.evaluate(()=>document.querySelector('main').innerText)).slice(0,700).replace(/\n/g,' | '));
 log('buttons: '+(await a.p.evaluate(()=>[...document.querySelectorAll('main button')].filter(e=>e.offsetParent).map(e=>e.innerText.trim().replace(/\s+/g,' ')).filter(Boolean).join(' | '))));
 // mobile views
 await a.p.setViewportSize({width:390,height:800}); await a.p.waitForTimeout(800); await shot(a.p,'11_commissioner_390',true);
 await a.p.setViewportSize({width:1440,height:900});
 // commissioner admin controls via API: pause -> banner
 try{ const lid=await a.p.evaluate(async()=>{const r=await fetch('http://localhost:8788/leagues',{credentials:'include'});const j=await r.json();const l=(j.leagues||j)[0];return l&&l.id}); log('league id '+lid);
  const r=await a.p.evaluate(async(id)=>{const r=await fetch('http://localhost:8788/leagues/'+id+'/admin/pause',{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:'{}'});return r.status},lid); log('pause status '+r);
  for(const g of [a,...others]){await g.p.reload();await g.p.waitForTimeout(2500);} await shot(a.p,'12_paused_banner_commissioner',false); if(others[0]) await shot(others[0].p,'13_paused_banner_member',false);
 }catch(e){log('ERR pause '+e.message.slice(0,150))}
 for(const g of [a,...others]) log(g.name+' pageerrors: '+g.p.errs.slice(0,3).join(' // '));
 await b.close(); })();
