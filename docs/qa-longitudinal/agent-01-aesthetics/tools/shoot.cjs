const L=require('./lib.cjs'); const fs=require('fs');
const S=__dirname; const [,, width, outname, ...jobs]=process.argv; // jobs: fixture:route[:label]
const out=`${S}/shots/${outname}`; fs.mkdirSync(out,{recursive:true});
(async()=>{
 const b=(await L.open(1,1)).b;
 for(const j of jobs){
  const [fx,route,label]=j.split('@'); const save=JSON.parse(fs.readFileSync(`${S}/fx/${fx}.json`)).save;
  const c=await b.newContext({viewport:{width:+width,height:+width>=1000?900:(+width>=700?1024:800)},deviceScaleFactor:1});
  await c.addInitScript(s=>{try{if(!localStorage.getItem('__seeded')){localStorage.setItem('nfl-sim-ui.league',s);localStorage.setItem('__seeded','1');}}catch{}},save);
  const p=await c.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto('http://127.0.0.1:4173/#'+route); await p.waitForTimeout(2200);
  if(await p.getByText(/Tap or click anywhere/i).count()){await p.mouse.click(Math.min(500,+width/2),300);await p.waitForTimeout(1200);}
  const name=(label||`${fx}_${route.replace(/[^a-z0-9]+/gi,'_')}`)+`_${width}`;
  const ov=await p.evaluate(()=>({sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth,h:document.documentElement.scrollHeight,url:location.hash,h1:(document.querySelector('h1')?.innerText||'').slice(0,50).replace(/\n/g,' ')}));
  await p.screenshot({path:`${out}/${name}.png`}); 
  if(ov.h>1000 && +width>=1000) await p.screenshot({path:`${out}/${name}_full.png`,fullPage:true});
  console.log(name, JSON.stringify(ov), errs.length?('ERR '+errs[0].slice(0,100)):'');
  await c.close();
 }
 await b.close();})();
