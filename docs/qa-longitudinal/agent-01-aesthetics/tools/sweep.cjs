const L=require('./lib.cjs'); const fs=require('fs'); const S=__dirname;
const jobs=[['fantasy-draft','/draft'],['coaching-draft','/coaching-draft'],['training-camp','/training-camp'],['season-week-9','/hub'],['season-week-9','/roster'],['season-week-9','/coaching'],['season-week-9','/free-agency'],['season-week-9','/trade'],['season-week-9','/game-plan'],['season-week-9','/schedule'],['season-week-9','/league-stats'],['season-week-9','/player-stats'],['trade-deadline','/trade-deadline'],['midseason-fa','/free-agency-board'],['playoffs-wild-card','/bracket'],['end-of-season','/end-of-season'],['end-of-season','/season-complete'],['end-of-season','/history'],['offseason-fa-skip-carried','/retirement'],['offseason-fa-skip-carried','/rookie-draft-summary'],['offseason-fa-skip-carried','/rookie-signings'],['season-week-9','/online'],['season-week-9','/league-rosters']];
(async()=>{const b=(await L.open(1,1)).b; const rows=[];
for(const w of [1024,768,390,320]) for(const [fx,r] of jobs){
 const save=JSON.parse(fs.readFileSync(`${S}/fx/${fx}.json`)).save;
 const c=await b.newContext({viewport:{width:w,height:800},hasTouch:w<800});
 await c.addInitScript(s=>{try{localStorage.setItem('nfl-sim-ui.league',s)}catch{}},save);
 const p=await c.newPage(); await p.goto('http://127.0.0.1:4173/#'+r); await p.waitForTimeout(1800);
 if(await p.getByText(/Tap or click anywhere/i).count()){await p.mouse.click(w/2,300);await p.waitForTimeout(900);}
 const m=await p.evaluate(()=>{const vis=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden'};
  const t=[...document.querySelectorAll('button,a[href],input,select,[role=tab],[role=button]')].filter(vis).filter(e=>{const r=e.getBoundingClientRect();return r.height<44||r.width<44});
  const small=[...document.querySelectorAll('body *')].filter(e=>e.childNodes.length&&[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())&&vis(e)&&parseFloat(getComputedStyle(e).fontSize)<11).length;
  const wide=[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1&&vis(e)).slice(0,3).map(e=>e.tagName+'.'+String(e.className).slice(0,40));
  return {sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth,small44:t.length,sample:t.slice(0,2).map(e=>(e.innerText||e.getAttribute('aria-label')||e.tagName).trim().slice(0,20)),tiny:small,wide,h1:document.querySelector('h1')?.innerText.slice(0,25).replace(/\n/g,' ')}});
 rows.push({w,r,...m}); if(m.sw>m.cw+1 && (w==390||w==320)) await p.screenshot({path:`${S}/shots/sweep_${w}_${r.replace(/\W+/g,'_')}.png`});
 if(w==390 && ['/hub','/roster','/draft','/bracket','/end-of-season','/free-agency-board'].includes(r)) await p.screenshot({path:`${S}/shots/m390_${r.replace(/\W+/g,'_')}.png`,fullPage:false});
 await c.close();}
fs.writeFileSync(S+'/sweep.json',JSON.stringify(rows,null,1));
for(const x of rows) console.log(x.w,x.r,'ovf',x.sw-x.cw,'t<44:',x.small44,'tiny:',x.tiny,x.wide.join(','));
await b.close();})();
