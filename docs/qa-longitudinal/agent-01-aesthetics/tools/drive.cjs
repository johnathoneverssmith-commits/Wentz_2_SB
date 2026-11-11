// Real-browser autoplayer. usage: node drive.cjs TEAM OUTDIR MAXSTEPS [targetYear]
const { chromium } = require('/home/user/Wentz_2_SB/node_modules/playwright'); const fs=require('fs');
const [,, TEAM, OUT, MAX, TARGET]=process.argv; fs.mkdirSync(OUT,{recursive:true});
const URL='http://localhost:4173/';
const PRI=[/^(Go ahead|Yes|Okay|OK|Got it)/i,/^skip to final$/i, // [regex, label] first match wins
 /^(I'm ready|Ready (for|to)|Mark ready|Start)/i,
 /Delegate Remaining|Let my staff (take|handle|fix)( this turn| the roster)|Auto-?pick|Auto-?draft/i,
 /^(Simulate|Sim )/i,
 /^(Continue|Advance|Proceed|Next|Finish|Done|Confirm|Close|Enter|Play (week|game|by)|Reveal|Review|Begin|Go to|Back to team hub|Set up camp|Start camp|Open|Skip)/i,
 /^(Sign$|Accept|Hire|Draft )/i,
];
const AVOID=/^next step$|^play$|^pause|Player card|Extend|Restructure|Release|Sound|Motion|backup|New solo|Methodology|Online|League settings|Unit Grades|Trade history|Download|Restore|Skip to content/i;
(async()=>{
 const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
 const RES=process.env.RESUME&&fs.existsSync(OUT+'/state.json'); const c=await b.newContext({viewport:{width:1440,height:900},storageState:RES?OUT+'/state.json':undefined}); const p=await c.newPage();
 const log=[]; const L=(s)=>{log.push(s);fs.appendFileSync(OUT+'/log.txt',s+'\n')}; p.on('dialog',d=>{L('NATIVE '+d.type()+': '+d.message().slice(0,140));d.accept()});p.on('pageerror',e=>L('PAGEERROR '+e.message.slice(0,160)));
 const net=new Set(); p.on('request',r=>{const u=r.url(); if(/:878[78]/.test(u)) net.add(u.replace(/https?:\/\/[^/]+/,'').split('?')[0].split('/').slice(0,3).join('/'));});
 await p.goto(URL); await p.waitForTimeout(1500);
 if(!RES) await p.locator('button.team-tile',{hasText:TEAM}).first().click();
 let shot=+process.env.SHOT||0; const seen={}; let stuck=0, lastKey='', manual=false;
 for(let i=0;i<+MAX;i++){
  await p.waitForTimeout(350);
  const st=await p.evaluate(()=>{const nav=document.querySelector('nav.rail')?.innerText||'';const pill=(nav.split('\n').find(x=>/·\s*20\d\d/.test(x))||'').trim();
    return {hash:location.hash,h1:(document.querySelector('main h1')?.innerText||'').replace(/\n/g,' ').slice(0,40),pill,
      overlay:!!([...document.querySelectorAll('body *')].find(e=>e.children.length<4&&/Tap or click anywhere/i.test(e.textContent||'')&&e.offsetParent!==null)),
      btns:[...document.querySelectorAll('main button, [role=dialog] button, [class*=overlay] button')].filter(e=>e.offsetParent&&!e.disabled&&e.getAttribute('aria-disabled')!=='true').map(e=>(e.innerText||e.getAttribute('aria-label')||'').trim().replace(/\s+/g,' ').slice(0,60)).filter(Boolean)}});
  const key=st.hash+'|'+st.h1+'|'+st.pill; const first=!seen[key]; seen[key]=(seen[key]||0)+1;
  if(first){ await p.waitForTimeout(900); await p.screenshot({path:`${OUT}/${String(shot++).padStart(3,'0')}_${(st.pill||st.hash).replace(/[^a-z0-9]+/gi,'_').slice(0,32)}_${st.hash.replace(/\W+/g,'_').slice(0,24)}.png`}); L(`[${i}] NEW ${key} :: ${st.btns.slice(0,10).join(' | ')}`);}
  const yr=(st.pill.match(/20\d\d/)||[''])[0]; if(TARGET && yr && +yr>=+TARGET && /Fantasy|Draft|Free Agency|Retire|Camp/i.test(st.pill)){L('TARGET REACHED '+key);break;}
  if(key===lastKey) stuck++; else {stuck=0; lastKey=key;}
  if(stuck>40){await p.screenshot({path:OUT+'/STUCK.png'});L('STUCK '+key+' :: '+st.btns.join(' | ')+' TEXT: '+(await p.evaluate(()=>document.querySelector('main').innerText.slice(0,400).replace(/\n/g,' / '))));break;}
  if(/End of season/.test(st.h1) && !global['eosx'+yr]){ global['eosx'+yr]=1; L('EOS experiment '+yr+' hash='+st.hash+' btns='+st.btns.join('|')); await p.mouse.click(700,450); await p.waitForTimeout(1200); await p.screenshot({path:OUT+'/eos_after_tap_'+yr+'.png'}); const b1=await p.evaluate(()=>[location.hash,[...document.querySelectorAll('main button')].filter(e=>e.offsetParent).map(e=>e.innerText.trim())]); L('after tap: '+JSON.stringify(b1)); const cb=p.getByRole('button',{name:'Continue'}); if(await cb.count()){ await cb.first().scrollIntoViewIfNeeded(); await cb.first().click().catch(e=>L('real click failed '+e.message.slice(0,80))); await p.waitForTimeout(2500); L('after real click hash='+await p.evaluate(()=>location.hash)); } continue; }
  if(st.overlay){ await p.mouse.click(700,450); await p.waitForTimeout(500); continue; }
  if(!global.gc1 && st.btns.some(t=>/^next step$/i.test(t))){ global.gc1=true; const clk=async t=>p.evaluate(t=>{const e=[...document.querySelectorAll('main button')].find(x=>x.offsetParent&&(x.innerText||'').trim().toLowerCase()===t);e&&e.click()},t); await p.screenshot({path:OUT+'/gamecast_00_start.png'}); for(let f=1;f<=4;f++){await clk('next step');await p.waitForTimeout(400);} await p.screenshot({path:OUT+'/gamecast_01_after4steps.png'}); await clk('play'); for(let f=2;f<=7;f++){await p.waitForTimeout(1200);await p.screenshot({path:OUT+`/gamecast_0${f}_autoplay.png`});} await p.screenshot({path:OUT+'/gamecast_full.png',fullPage:true}); L('gamecast captured'); continue; }
 // one manual draft pick for animation capture
  if(!manual && /Draft Room/i.test(st.h1)){ const d=p.locator('main button',{hasText:/^Draft /}).first(); if(await d.count()){ manual=true; for(let f=0;f<6;f++){ } await d.click().catch(()=>{}); for(let f=0;f<8;f++){await p.waitForTimeout(250); await p.screenshot({path:`${OUT}/anim_draftpick_${f}.png`});} L('manual draft pick done'); continue; } }
  let pick=null; const ni=st.btns.indexOf('No thanks'); if(ni>0){ const aff=st.btns[ni-1]; if(!global['dlg'+aff]){global['dlg'+aff]=1; await p.screenshot({path:`${OUT}/dialog_${aff.replace(/\W+/g,'_')}_${shot++}.png`}); L('DIALOG affirm="'+aff+'" decline=No thanks (before: '+st.btns.slice(Math.max(0,ni-4),ni).join(' | ')+')');} await p.evaluate(t=>{const e=[...document.querySelectorAll('button')].find(x=>x.offsetParent&&!x.disabled&&(x.innerText||'').trim()===t);e&&e.click()},aff); await p.waitForTimeout(400); continue; }

  for(const re of PRI){ pick=st.btns.find(t=>re.test(t)&&!AVOID.test(t)); if(pick)break; }
  // prefer team tile for BAL etc not needed. 
  if(!pick){ const fo=st.btns.filter(t=>/players ·/.test(t)); if(fo.length){ const t=(seen[key]%2===1)?fo[0]:fo[fo.length-1]; await p.evaluate(t=>{const e=[...document.querySelectorAll('main button')].find(x=>x.offsetParent&&(x.innerText||'').trim().replace(/\s+/g,' ').slice(0,60)===t);e&&e.click()},t); L('   focus '+t.slice(0,30)); continue; }
   L('NOCLICK '+key+' :: '+st.btns.join(' | ')); await p.waitForTimeout(1500); if(stuck>10)break; continue; }
  await p.evaluate(t=>{const e=[...document.querySelectorAll('main button, [role=dialog] button, [class*=overlay] button')].find(x=>x.offsetParent&&!x.disabled&&(x.innerText||x.getAttribute('aria-label')||'').trim().replace(/\s+/g,' ').slice(0,60)===t); e&&e.click();},pick);
  if(seen[key]<=2) L(`   click "${pick}"`);
  if(i%5===0) await c.storageState({path:OUT+'/state.json'});
 }
 L('adapter calls: '+[...net].join(', ')); await c.storageState({path:OUT+'/state.json'}); await b.close();})();
