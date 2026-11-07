const { chromium } = require('/home/user/Wentz_2_SB/node_modules/playwright'); const fs=require('fs'); const OUT=__dirname+'/shots/anim';
const save=n=>JSON.parse(fs.readFileSync(__dirname+`/fx/${n}.json`)).save;
const probe=`(()=>{window.__an=window.__an||new Map();const t0=performance.now();window.__t0=t0;const tick=()=>{document.getAnimations().forEach(a=>{const tg=a.effect&&a.effect.target;const k=(a.animationName||a.transitionProperty||'?')+'|'+(tg?(tg.tagName+'.'+String(tg.className).split(' ')[0].slice(0,24)):'');const tm=a.effect.getTiming();if(!window.__an.has(k))window.__an.set(k,{first:Math.round(performance.now()-window.__t0),dur:tm.duration,delay:tm.delay,iter:tm.iterations,type:a.constructor.name});});requestAnimationFrame(tick)};tick();})()`;
async function run(name,fx,route,steps,{reduced=false}={}){
 const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
 const c=await b.newContext({viewport:{width:1440,height:900},reducedMotion:reduced?'reduce':'no-preference'});await c.addInitScript(s=>localStorage.setItem('nfl-sim-ui.league',s),save(fx));const p=await c.newPage();
 await p.goto('http://localhost:4173/#'+route);await p.waitForTimeout(2500);
 if(await p.getByText(/Tap or click anywhere/i).count()){await p.mouse.click(700,450);await p.waitForTimeout(1000);}
 await p.evaluate(probe); let i=0;
 for(const st of steps){ await st(p); for(let f=0;f<5;f++){await p.waitForTimeout(120);await p.screenshot({path:`${OUT}/${name}${reduced?'_rm':''}_s${i}_f${f}.png`});} i++; }
 const res=await p.evaluate(()=>[...window.__an.entries()].map(([k,v])=>k+' first@'+v.first+'ms dur='+v.dur+'ms delay='+v.delay+' iter='+v.iter));
 console.log('== '+name+(reduced?' (reduced-motion)':''));console.log(res.join('\n'));await b.close();}
(async()=>{
 const fa=[async p=>{await p.getByRole('button',{name:/^Offer /}).first().click();await p.waitForTimeout(500);console.log('after Offer click buttons:',await p.evaluate(()=>[...document.querySelectorAll('button')].filter(e=>e.offsetParent&&/offer|sign|pass|submit|make/i.test(e.innerText)).map(e=>e.innerText.trim().replace(/\s+/g,' ').slice(0,40))));},async p=>{await p.getByRole('button',{name:/Make the offer|Submit offer|Offer \$|Send offer/i}).first().click({timeout:3000}).catch(e=>console.log('no submit'));}];
 await run('fa','midseason-fa','/free-agency-board',fa);
})()
