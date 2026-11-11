const { chromium } = require('/home/user/Wentz_2_SB/node_modules/playwright'); const fs=require('fs'); const OUT=__dirname+'/shots/rc'; fs.mkdirSync(OUT,{recursive:true});
(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
const save=JSON.parse(fs.readFileSync(__dirname+'/fx/midseason-fa.json')).save;
const c=await b.newContext({viewport:{width:1440,height:620}});await c.addInitScript(s=>localStorage.setItem('nfl-sim-ui.league',s),save);const p=await c.newPage();
await p.goto('http://localhost:4173/#/free-agency-board');await p.waitForTimeout(2200);
const info=await p.evaluate(()=>{const t=document.querySelector('.ticker');const cs=getComputedStyle(t);const v=t.querySelector('.stat div:last-child, .stat .value, .stat strong')||t.querySelector('.stat');const lab=t.querySelector('.stat');return {bg:cs.backgroundImage.slice(0,60),border:cs.border,cls:t.className,parent:t.closest('[class*=decision-workspace]')?.className, valColor:getComputedStyle(v).color, valBg:getComputedStyle(t).backgroundColor, html:t.innerHTML.slice(0,200)}});
console.log(JSON.stringify(info,null,1));
await p.screenshot({path:OUT+'/ticker_before.png',clip:{x:224,y:380,width:1216,height:120}});
await p.addStyleTag({content:'.decision-workspace .ticker{background:var(--gd-card)!important;border:2px solid var(--gd-rule)!important;border-radius:0!important} .decision-workspace .ticker .stat{color:var(--gd-ink,#0b1a2b)}'});
await p.waitForTimeout(400);await p.screenshot({path:OUT+'/ticker_after_concept.png',clip:{x:224,y:380,width:1216,height:120}});
// contrast of value text on strip
const cr=await p.evaluate(()=>{const t=document.querySelector('.ticker .stat');return getComputedStyle(t).color});console.log('after color',cr);
await b.close()})()
