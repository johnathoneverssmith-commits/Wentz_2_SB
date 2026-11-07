const { chromium } = require('/home/user/Wentz_2_SB/node_modules/playwright');
(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
let c=await b.newContext({storageState:__dirname+'/shots/real1/state.json'});let p=await c.newPage();await p.goto('http://localhost:4173/');await p.waitForTimeout(2500);
console.log('real save length (chars) at 2028 wk15:',await p.evaluate(()=>Object.entries(localStorage).map(([k,v])=>k+':'+v.length)));
await c.close(); c=await b.newContext();p=await c.newPage();await p.goto('http://localhost:4173/');
const lim=await p.evaluate(()=>{let lo=0,hi=40e6;while(hi-lo>10000){const m=(lo+hi)>>1;try{localStorage.setItem('q','x'.repeat(m));lo=m}catch{hi=m}}localStorage.removeItem('q');return lo});
console.log('max single-key localStorage chars in this Chromium:',lim);
await b.close()})()
