const { chromium } = require('/home/user/Wentz_2_SB/node_modules/playwright'); const fs=require('fs'); const S=__dirname;
const fn=`(()=>{const parse=c=>{const m=c.match(/rgba?\\(([^)]+)\\)/);if(!m)return null;const v=m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number);return {r:v[0],g:v[1],b:v[2],a:v[3]===undefined?1:v[3]}};
const lum=({r,g,b})=>{const f=x=>{x/=255;return x<=0.03928?x/12.92:Math.pow((x+0.055)/1.055,2.4)};return .2126*f(r)+.7152*f(g)+.0722*f(b)};
const blend=(f,b)=>({r:f.r*f.a+b.r*(1-f.a),g:f.g*f.a+b.g*(1-f.a),b:f.b*f.a+b.b*(1-f.a),a:1});
const bgOf=e=>{let layers=[];let n=e;while(n&&n!==document.documentElement){const cs=getComputedStyle(n);if(cs.backgroundImage!=='none'&&!/^linear-gradient\\(/.test(cs.backgroundImage)&&!/^radial/.test(cs.backgroundImage))return null;const c=parse(cs.backgroundColor);if(c&&c.a>0){layers.push(c);if(c.a>=1)break;}if(/gradient/.test(cs.backgroundImage)){/*approx: use first stop*/const m=cs.backgroundImage.match(/rgba?\\([^)]+\\)/);if(m){const g=parse(m[0]);if(g&&g.a>0){layers.push(g);if(g.a>=1)break;}}}n=n.parentElement}
 let base={r:255,g:255,b:255,a:1};for(let i=layers.length-1;i>=0;i--)base=blend(layers[i],base);return base};
const out=[];const seen=new Set();
for(const e of document.querySelectorAll('main *, nav.rail *')){ if(!e.offsetParent&&getComputedStyle(e).position!=='fixed')continue; const t=[...e.childNodes].filter(n=>n.nodeType===3&&n.textContent.trim()).map(n=>n.textContent.trim()).join(' '); if(!t)continue; const cs=getComputedStyle(e); if(cs.visibility==='hidden'||parseFloat(cs.opacity)===0)continue;
 const fg=parse(cs.color); const bg=bgOf(e); if(!fg||!bg){out.push({t:t.slice(0,30),ind:1});continue;} const op=parseFloat(cs.opacity); const f=blend({...fg,a:fg.a*op},bg); const l1=lum(f),l2=lum(bg); const ratio=(Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05); const px=parseFloat(cs.fontSize); const bold=parseInt(cs.fontWeight)>=700; const large=px>=24||(px>=18.66&&bold); const min=large?3:4.5; out.push({t:t.slice(0,32),ratio:+ratio.toFixed(2),px,min,fail:ratio<min,cls:String(e.className).split(' ')[0].slice(0,26)});}
return out})()`;
(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
const jobs=[]; for(const t of ['BAL','PIT','CIN','CHI','LV']){const d=t==='BAL'?'fx':'fx_'+t; for(const [fx,r] of [['season-week-9','/hub'],['season-week-9','/roster'],['fantasy-draft','/draft'],['end-of-season','/end-of-season']]) jobs.push([t,d,fx,r]);}
for(const [t,d,fx,r] of jobs){ const c=await b.newContext({viewport:{width:1440,height:900}});await c.addInitScript(s=>localStorage.setItem('nfl-sim-ui.league',s),JSON.parse(fs.readFileSync(`${S}/${d}/${fx}.json`)).save);const p=await c.newPage();
 await p.goto('http://localhost:4173/#'+r);await p.waitForTimeout(2000); if(await p.getByText(/Tap or click anywhere/i).count()){await p.mouse.click(700,450);await p.waitForTimeout(900);}
 const res=await p.evaluate(fn); const m=res.filter(x=>x.ratio!==undefined); const fails=m.filter(x=>x.fail); const ind=res.filter(x=>x.ind).length;
 const worst=fails.sort((a,b)=>a.ratio-b.ratio).slice(0,4).map(x=>`"${x.t}" ${x.ratio}:1 @${x.px}px .${x.cls}`);
 console.log(t.padEnd(4),r.padEnd(14),`measured ${m.length}`,`fail ${fails.length}`,`indet ${ind}`,'|',worst.join(' ; '));
 await c.close();}
await b.close()})()
