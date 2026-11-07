const { chromium } = require('/home/user/Wentz_2_SB/node_modules/playwright');
exports.open = async (vw=1440,vh=900,state)=>{
 const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
 const c=await b.newContext({viewport:{width:vw,height:vh},storageState:state});
 const p=await c.newPage(); p.errs=[]; p.on('pageerror',e=>p.errs.push(e.message));
 return {b,c,p};
};
exports.btns = async p=> p.evaluate(()=>[...document.querySelectorAll('button,a[href]')].filter(e=>e.offsetParent).map(e=>(e.tagName[0]+':'+(e.innerText||e.getAttribute('aria-label')||'').trim().replace(/\s+/g,' ').slice(0,50))).filter(x=>x.length>2));
