const { chromium } = require('/home/user/Wentz_2_SB/node_modules/playwright'); const fs=require('fs'); const OUT=__dirname+'/shots/gc';
(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
const c=await b.newContext({viewport:{width:1440,height:900},storageState:__dirname+'/real_state_copy.json'}); const p=await c.newPage();
await p.goto('http://localhost:4173/#/watch/2028-PRE-1-CIN-BAL'); await p.waitForTimeout(3000);
const ctr=()=>p.evaluate(()=>(document.querySelector('main').innerText.match(/(\d+) \/ (\d+)/)||[])[1]);
await p.getByRole('button',{name:/^play$/i}).click(); const t0=Date.now(); const samples=[];
for(let i=0;i<14;i++){await p.waitForTimeout(700); samples.push([Date.now()-t0,await ctr()]); if(i%3==0) await p.screenshot({path:`${OUT}/play_${i}.png`});}
console.log('1x counter samples',JSON.stringify(samples));
await p.getByRole('button',{name:/^2×$|^2x$/}).click().catch(e=>console.log('no 2x btn')); const s2=[];const t1=Date.now(); for(let i=0;i<6;i++){await p.waitForTimeout(700); s2.push([Date.now()-t1,await ctr()]);} console.log('2x',JSON.stringify(s2));
await p.screenshot({path:`${OUT}/play_scoring.png`});
// pause & step
await p.getByRole('button',{name:/pause/i}).click().catch(()=>{}); 
for(let i=0;i<30;i++){await p.getByRole('button',{name:/next step/i}).click({timeout:1500}).catch(()=>{});} await p.waitForTimeout(500); await p.screenshot({path:`${OUT}/step30.png`});
console.log('after 30 steps',await ctr());
await p.getByRole('button',{name:/Show full transcript/}).click().catch(e=>console.log('no transcript')); await p.waitForTimeout(800); await p.screenshot({path:`${OUT}/transcript.png`,fullPage:false});
// mobile
await p.setViewportSize({width:390,height:800}); await p.waitForTimeout(800); await p.screenshot({path:`${OUT}/mobile.png`});
console.log('reduced-motion anim count',await p.evaluate(()=>document.getAnimations().length));
await b.close()})()
