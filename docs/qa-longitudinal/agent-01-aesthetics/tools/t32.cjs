const { chromium } = require('/home/user/Wentz_2_SB/node_modules/playwright'); const fs=require('fs'); const OUT=__dirname+'/shots/t32';
const T='ARI ATL BAL BUF CAR CHI CIN CLE DAL DEN DET GB HOU IND JAX KC LV LAC LAR MIA MIN NE NO NYG NYJ PHI PIT SF SEA TB TEN WAS'.split(' ');
(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
const doc=JSON.parse(JSON.parse(fs.readFileSync(__dirname+'/fx/season-week-9.json')).save); const res={};
for(const t of T){ const d=JSON.parse(JSON.stringify(doc)); const gm=d.state.gms.find(g=>g.id===d.state.viewerGmId); const old=d.state.gms.find(g=>g.teamCode===t&&g!==gm); if(old)old.teamCode=gm.teamCode; gm.teamCode=t;
 const c=await b.newContext({viewport:{width:1440,height:600}}); await c.addInitScript(s=>localStorage.setItem('nfl-sim-ui.league',s),JSON.stringify(d)); const p=await c.newPage();
 await p.goto('http://localhost:4173/#/roster'); await p.waitForTimeout(1800);
 const info=await p.evaluate(()=>{const im=[...document.querySelectorAll('img')].find(i=>/stadiums\//.test(i.src)); return {img:!!im, loaded:im?(im.complete&&im.naturalWidth>0):false, nw:im?.naturalWidth||0, svg:!!document.querySelector('main svg[class*=scene], main [class*=stadium] svg, main [class*=masthead] svg'), credit:(document.querySelector('[class*=credit]')?.innerText||'').slice(0,90), h1:(document.querySelector('main h1')?.innerText||'').replace(/\n/g,' ')}});
 res[t]=info; await p.screenshot({path:`${OUT}/${t}.png`,clip:{x:224,y:0,width:1216,height:380}}); await c.close();}
fs.writeFileSync(OUT+'/res.json',JSON.stringify(res,null,1));
for(const t of T) console.log(t,res[t].h1.slice(0,26).padEnd(26),res[t].img?(res[t].loaded?'PHOTO ok '+res[t].nw:'PHOTO FAILED'):'no-img(skyline)',res[t].credit.replace(/\n/g,' ').slice(0,60));
await b.close()})()
