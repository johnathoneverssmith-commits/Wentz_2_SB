const { chromium } = require('/home/user/Wentz_2_SB/node_modules/playwright'); const OUT=__dirname+'/shots/hf';
(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
const c=await b.newContext({viewport:{width:1440,height:900},storageState:OUT+'/state.json'});const p=await c.newPage();p.on('dialog',d=>{console.log('NATIVE',d.type(),d.message());d.accept()});
await p.goto('http://localhost:4173/#/hooded-figure');await p.waitForTimeout(2000);
for(let i=0;i<6;i++) await p.locator('main button',{hasText:/^\+$/}).first().click();
await p.locator('main button',{hasText:/^Pay /}).click();await p.waitForTimeout(2500);await p.screenshot({path:OUT+'/hf2_result.png',fullPage:true});
console.log((await p.evaluate(()=>document.querySelector('main').innerText)).slice(0,800).replace(/\n/g,' | '));
console.log(await p.evaluate(()=>[...document.querySelectorAll('main button')].filter(e=>e.offsetParent).map(e=>e.innerText.trim())));
await c.storageState({path:OUT+'/state.json'});await b.close()})()
