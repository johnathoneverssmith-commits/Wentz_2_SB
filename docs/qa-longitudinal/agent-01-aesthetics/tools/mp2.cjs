const { chromium } = require('/home/user/Wentz_2_SB/node_modules/playwright'); const fs=require('fs'); const OUT=__dirname+'/shots/mp';
const ST=fs.readFileSync(OUT+'/log.txt','utf8').match(/alice(\d+)/)[1];
const log=s=>{console.log(s);fs.appendFileSync(OUT+'/log.txt',s+'\n')};
(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
const c=await b.newContext({viewport:{width:1440,height:900}});const p=await c.newPage();p.on('dialog',d=>{log('NATIVE '+d.type()+': '+d.message().slice(0,120));d.dismiss()});
await p.goto('http://localhost:4173/#/online');await p.waitForTimeout(2000);
await p.getByLabel('Name').fill('alice'+ST);await p.getByLabel('Password').fill('password123');await p.getByRole('button',{name:'Sign in'}).click();await p.waitForTimeout(2500);
await p.screenshot({path:OUT+'/20_signedin_with_league.png',fullPage:true});
log('lobby: '+(await p.evaluate(()=>document.querySelector('main').innerText)).slice(0,400).replace(/\n/g,' | '));
const open=p.getByRole('button',{name:/^(Open|Claim a team in|Play)/}).first(); if(await open.count()){log('open btn: '+await open.innerText());}
await p.getByRole('button',{name:'Manage GMs'}).click().catch(e=>log('no manage'));await p.waitForTimeout(1200);await p.screenshot({path:OUT+'/21_manage_gms.png',fullPage:true});
log('manage: '+(await p.evaluate(()=>document.querySelector('main').innerText)).slice(0,900).replace(/\n/g,' | '));
log('buttons: '+(await p.evaluate(()=>[...document.querySelectorAll('main button')].filter(e=>e.offsetParent).map(e=>e.innerText.trim().replace(/\s+/g,' ')).join(' | '))));
await p.setViewportSize({width:390,height:800});await p.waitForTimeout(600);await p.screenshot({path:OUT+'/22_manage_gms_390.png',fullPage:true});
await b.close()})()
