import {readFixture} from '../support/fixtures-build.ts';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {expect,test,SAVE_KEY} from '../support/test.ts';
import {controlledLeague} from '../support/controlled-league.ts';
import type {Page} from '@playwright/test';
const saved=(page:Page)=>page.evaluate(k=>JSON.parse(localStorage.getItem(k)!).state,SAVE_KEY);
async function capture(page:Page,name:string){if(process.env.UI5_ARTIFACTS){mkdirSync(process.env.UI5_ARTIFACTS,{recursive:true});await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));await page.screenshot({path:join(process.env.UI5_ARTIFACTS,name),fullPage:page.viewportSize()!.width<700&&(await page.getByRole('dialog').count())===0});}}

test.describe('UI-5 setup orientation',()=>{
 test('solo setup explains the real next step and exposes optional keyboard help',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/#/setup');
  await expect(page.getByRole('heading',{name:'League Setup',exact:true})).toBeVisible();
  const guide=page.getByRole('region',{name:'Franchise guidance'});await expect(guide).toContainText('fantasy draft');
  await page.getByRole('tab',{name:'League Settings',exact:true}).click();
  await page.getByRole('group',{name:'Fantasy draft',exact:true}).getByRole('combobox').selectOption('off');
  await expect(guide).toContainText('coaching draft');
  await expect(page.getByText('Teams keep their starting roster. The coaching draft begins once every GM is ready.',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'How it works',exact:true}).click();
  const help=page.getByRole('dialog',{name:'How it works',exact:true});await expect(help).toContainText('Start here');
  await expect(help.getByRole('button',{name:'Close how it works'})).toBeFocused();
  await page.keyboard.press('Escape');await expect(help).toHaveCount(0);await expect(page.getByRole('button',{name:'How it works',exact:true})).toBeFocused();
  await capture(page,'setup-mobile.png');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 });
});
test.describe('UI-5 truthful camp feedback',()=>{
 test.use({fixtureName:'training-camp'});
 test('a refused results step is visible and retries without submitting camp again',async({page,origin})=>{
  await page.goto('/');const state=await saved(page);const gm=state.gms.find((g:any)=>g.id===state.viewerGmId);let rejectStep=true;
  let transport:Awaited<ReturnType<typeof controlledLeague>>;
  transport=await controlledLeague(page,origin,state,{teamCode:gm.teamCode,gmId:gm.id},async(path)=>{
   if(path.endsWith('/training-camp')){state.trainingCamp.plans[gm.teamCode]={offensiveFocus:'QB',defensiveFocus:'DL',submitted:true};transport.setState(state);return {status:200,body:{ok:true,version:'ui4-version'}};}
   if(path.endsWith('/step')){if(rejectStep)return {status:403,body:{error:'Results step was refused.'}};state.reveal??={preseasonWeek:{},regularWeek:{},playoffRounds:{},step:{}};state.reveal.step[gm.id]='trainingCampResults';transport.setState(state);return {status:200,body:{ok:true,version:'ui4-version'}};}
   return {status:400,body:{error:'Unexpected action'}};
  });await page.reload();await expect(page.getByText('Controlled UI league',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:/^Quarterbacks/}).click();await page.getByRole('button',{name:/^Defensive line/}).click();
  await page.getByRole('button',{name:'Advance to End of Training Camp',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'Results step was refused.'})).toBeVisible();await expect(page).toHaveURL(/#\/training-camp$/);
  rejectStep=false;await page.getByRole('button',{name:'See Your Results',exact:true}).click();await expect(page).toHaveURL(/#\/training-camp-results$/);
  expect(transport.requests.filter(r=>r.path.endsWith('/training-camp'))).toHaveLength(1);expect(transport.requests.filter(r=>r.path.endsWith('/step'))).toHaveLength(2);expect(transport.unexpected).toEqual([]);
 });
});


test.describe('UI-5 first franchise through real controls',()=>{
 test('seeded solo setup completes player and coaching drafts into camp',async({page})=>{
  test.setTimeout(180_000);await page.setViewportSize({width:1440,height:1000});await page.goto('/#/setup');
  await page.getByRole('tab',{name:'League Settings',exact:true}).click();await page.getByText('League seed and replayability',{exact:true}).click();
  await page.getByRole('textbox',{name:'New solo setup seed',exact:true}).fill('8724');
  page.once('dialog',async d=>{expect(d.message()).toContain('Restart this solo setup');await d.accept();});
  await page.getByRole('button',{name:'Restart setup with seed',exact:true}).click();await expect.poll(async()=>(await saved(page)).seed).toBe(8724);
  await page.getByRole('textbox',{name:/^Manual picks each/}).fill('1');
  await page.getByRole('tab',{name:'Lobby',exact:true}).click();await expect(page.getByRole('region',{name:'League profile',exact:true})).toBeVisible();await page.getByRole('button',{name:/^Baltimore Ravens.*available$/}).click();
  await capture(page,'setup-desktop.png');await page.getByRole('button',{name:"I'm ready to begin",exact:true}).click();
  await expect(page).toHaveURL(/#\/draft$/);await page.getByRole('dialog').filter({hasText:'on the clock'}).click();
  const row=page.locator('.draft-avail tbody tr').first();const id=(await row.getAttribute('data-player-id'))!;await row.getByRole('button',{name:/^Draft /}).click();await page.getByRole('dialog').getByRole('button',{name:'Confirm pick',exact:true}).click();
  await expect.poll(async()=>(await saved(page)).stage).toBe('fantasyDraftSummary');
  await page.getByRole('dialog').filter({hasText:'Every pick is in.'}).click();
  await expect(page.getByRole('heading',{name:'Fantasy Draft Summary',exact:true})).toBeVisible();const drafted=await saved(page);expect(drafted.draft.results.some((r:any)=>r.selectedId===id)).toBe(true);expect(drafted.draft.results.length).toBe(Object.keys(drafted.teams).length*53);
  await page.getByRole('button',{name:'Advance to Coaching',exact:true}).click();await expect(page).toHaveURL(/#\/coaching-draft$/);
  for(let guard=0;guard<13&&(await saved(page)).stage==='coachingDraft';guard++){
   const before=(await saved(page)).coachingDraft.currentPickIndex;await page.getByRole('button',{name:/^Hire /}).first().click();await expect.poll(async()=>(await saved(page)).coachingDraft.currentPickIndex).toBeGreaterThan(before);
  }
  await expect.poll(async()=>(await saved(page)).stage).toBe('coachingDraftSummary');
  const back=page.getByRole('region',{name:'Franchise guidance'}).getByRole('link',{name:'Return to Coaching Draft Summary',exact:true});if(await back.isVisible())await back.click();
  await expect(page.getByRole('heading',{name:'Coaching Draft Summary',exact:true})).toBeVisible();
  await expect(page.getByRole('region',{name:'Franchise guidance'})).toContainText('training camp');
  await page.getByRole('button',{name:'Advance to Training Camp',exact:true}).click();await expect(page).toHaveURL(/#\/training-camp$/);
  const state=await saved(page);const me=state.gms.find((g:any)=>g.id===state.viewerGmId).teamCode;expect(Object.values(state.coaches).filter((c:any)=>c.team===me)).toHaveLength(12);await page.reload();await expect(page.getByRole('heading',{name:'Training Camp',exact:true})).toBeVisible();
 });
});

for(const [device,width] of [['desktop',1440],['mobile',390]] as const){
 test.describe(`UI-5 camp and phase return ${device}`,()=>{
  test.use({fixtureName:'training-camp'});
  test('optional guidance does not change state and camp advances through results and depth chart',async({page,consoleErrors})=>{
   await page.setViewportSize({width,height:device==='desktop'?1000:844});await page.goto('/');const before=await saved(page);
   const guide=page.getByRole('region',{name:'Franchise guidance'});await guide.getByText('Why this step matters',{exact:true}).click();expect((await saved(page)).trainingCamp).toEqual(before.trainingCamp);
   await page.getByRole('navigation',{name:'Main'}).getByRole('link',{name:'Finances & Cap',exact:true}).click();await guide.getByRole('link',{name:'Return to Training Camp',exact:true}).click();await expect(page).toHaveURL(/#\/training-camp$/);
   await page.getByRole('button',{name:'How it works',exact:true}).click();const help=page.getByRole('dialog',{name:'How it works',exact:true});await expect(help).toContainText('repeated focuses');
   if(device==='mobile'){const rect=(await help.getByRole('button',{name:'Close how it works'}).boundingBox())!;expect(await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.closest('[role=dialog]')?.getAttribute('aria-label'),{x:rect.x+rect.width/2,y:rect.y+rect.height/2}),'The help close control must be above mobile navigation').toBe('How it works');}
   const tabs=help.getByRole('tab');await tabs.first().focus();await page.keyboard.press('ArrowRight');await expect(tabs.nth(1)).toBeFocused();await expect(tabs.nth(1)).toHaveAttribute('aria-selected','true');await capture(page,`help-${device}.png`);await page.keyboard.press('Escape');
   await page.getByRole('button',{name:/^Quarterbacks/}).click();await page.getByRole('button',{name:/^Defensive line/}).click();if(device==='mobile'){const target=(await page.getByRole('button',{name:/^Quarterbacks/}).boundingBox())!;expect(target.height).toBeGreaterThanOrEqual(44);}
   await capture(page,`camp-${device}.png`);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
   await page.getByRole('button',{name:'Advance to End of Training Camp',exact:true}).click();await expect(page).toHaveURL(/#\/training-camp-results$/);
   const after=await saved(page);expect(after.season).toBe(before.season);const me=before.gms.find((g:any)=>g.id===before.viewerGmId).teamCode;expect(after.trainingCamp.plans[me].submitted).toBe(true);expect(after.trainingCamp.results[me].length).toBeGreaterThan(0);
   await page.reload();expect((await saved(page)).trainingCamp.results[me]).toEqual(after.trainingCamp.results[me]);
   await page.getByRole('button',{name:'Advance to Re-order Depth Chart',exact:true}).click();await expect(page).toHaveURL(/#\/roster$/);
   await expect(guide).toContainText('preseason');await page.getByRole('button',{name:'Ready to start the season',exact:true}).click();await expect.poll(async()=>(await saved(page)).stage).toBe('preseason');await expect(page).toHaveURL(/#\/hub$/);expect(consoleErrors).toEqual([]);
  });
 });
}

test.describe('UI-5 controlled online session UX',()=>{
 test.use({fixtureName:'training-camp'});
 test('a saved online view refuses local progress while disconnected and recovers by reconnecting',async({page,origin})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/');const state=await saved(page);const gm=state.gms.find((g:any)=>g.id===state.viewerGmId);
  const transport=await controlledLeague(page,origin,state,{teamCode:gm.teamCode,gmId:gm.id});await page.reload();await expect(page.getByText('Controlled UI league',{exact:true})).toBeVisible();
  const url='http://127.0.0.1:9/leagues/ui4-controlled';const unavailable=async(route:any)=>route.fulfill({status:503,json:{error:'Controlled offline test'},headers:{'access-control-allow-origin':origin,'access-control-allow-credentials':'true'}});
  await page.route(url,unavailable);await page.reload();await expect(page.getByText('Couldn’t reach your online league.',{exact:true})).toBeVisible();
  await expect(page.getByRole('region',{name:'Franchise guidance'})).toContainText('Reconnect');expect(transport.requests).toEqual([]);
  await page.unroute(url,unavailable);await page.reload();await expect(page.getByText('Controlled UI league',{exact:true})).toBeVisible();await expect(page.getByText('Couldn’t reach your online league.',{exact:true})).toHaveCount(0);expect(transport.requests).toEqual([]);
 });
 test('checked-in waiting state and a refused withdrawal remain truthful',async({page,origin})=>{
  await page.goto('/');const state=await saved(page);const gm=state.gms.find((g:any)=>g.id===state.viewerGmId);const other={...gm,id:'ui5_other',name:'Waiting GM',teamCode:Object.keys(state.teams).find(c=>c!==gm.teamCode),isHuman:true};state.gms.push(other);state.readiness[gm.id]=true;state.readiness[other.id]=false;
  state.reveal??={preseasonWeek:{},regularWeek:{},playoffRounds:{},step:{}};state.reveal.step[gm.id]='trainingCampResults';
  const transport=await controlledLeague(page,origin,state,{teamCode:gm.teamCode,gmId:gm.id},async()=>({status:403,body:{error:'Check-in could not be withdrawn.'}}));await page.reload();await expect(page.getByText('Controlled UI league',{exact:true})).toBeVisible();await page.getByRole('region',{name:'Franchise guidance'}).getByRole('link',{name:'Return to Training Camp Results',exact:true}).click();await expect(page.getByRole('heading',{name:'Waiting for other players',exact:true})).toBeVisible();await expect(page.getByText(/Waiting on Waiting GM/)).toBeVisible();
  await page.getByRole('button',{name:'Take back my check-in',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Check-in could not be withdrawn.'})).toBeVisible();await expect(page.getByRole('heading',{name:'Waiting for other players',exact:true})).toBeVisible();expect(transport.requests).toHaveLength(1);
 });
});


test.describe('UI-5 review regressions',()=>{
 test('seed initialization keeps team, settings and readiness locked while generation is delayed',async({page})=>{
  await page.goto('/#/setup');await page.getByRole('heading',{name:'League Setup',exact:true}).waitFor();
  await page.clock.install();await page.clock.fastForward(31_000);
  let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});let pending=0;
  await page.route('http://localhost:8787/**',async route=>{pending++;await gate;try{await route.abort('blockedbyclient');}catch{}});
  await page.getByRole('tab',{name:'League Settings',exact:true}).click();await page.getByText('League seed and replayability',{exact:true}).click();await page.getByRole('textbox',{name:'New solo setup seed',exact:true}).fill('9357');
  page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Restart setup with seed',exact:true}).click();
  try{
   await expect.poll(()=>pending).toBeGreaterThan(0);
   await expect(page.getByRole('dialog',{name:'Creating solo league',exact:true})).toBeVisible();
   await page.evaluate(()=>{location.hash='/history';});await expect(page).toHaveURL(/#\/history$/);await page.goBack();await expect(page).toHaveURL(/#\/setup$/);await page.getByRole('heading',{name:'League Setup',exact:true}).waitFor();expect(await page.locator('.team-tile:enabled').count(),'Browser Back must not drop the pending creation lock').toBe(0);
   await expect(page.getByRole('dialog',{name:'Creating solo league',exact:true})).toBeVisible();
   await expect(page.locator('.team-tile:enabled')).toHaveCount(0);
   await expect(page.getByRole('combobox',{name:'Fantasy draft',exact:true,includeHidden:true})).toBeDisabled();
   await expect(page.getByRole('button',{name:'Creating the league — please wait',exact:true})).toBeDisabled();await page.clock.fastForward(12_001);await expect(page.getByRole('button',{name:'Reload saved setup',exact:true})).toBeVisible();
  }finally{release();}
  await expect(page.getByRole('dialog',{name:'Creating solo league',exact:true})).toHaveCount(0);expect((await saved(page)).seed).toBe(9357);expect((await saved(page)).stage).toBe('setup');
 });
 test('help tabs reference real labelled panels',async({page})=>{
  await page.goto('/#/setup');await page.getByRole('button',{name:'How it works',exact:true}).click();const help=page.getByRole('dialog',{name:'How it works',exact:true});
  for(const tab of await help.getByRole('tab').all()){const id=(await tab.getAttribute('aria-controls'))!;expect(await help.locator(`[id="${id}"]`).count()).toBe(1);}
 });
});
test.describe('UI-5 stale camp reference',()=>{
 test.use({fixtureName:'training-camp'});
 test('opening old camp results preserves the current rookie-signings step marker',async({page,origin})=>{
  await page.goto('/');await page.getByRole('button',{name:/^Quarterbacks/}).click();await page.getByRole('button',{name:/^Defensive line/}).click();await page.getByRole('button',{name:'Advance to End of Training Camp',exact:true}).click();await expect(page).toHaveURL(/#\/training-camp-results$/);
  const completed=await saved(page);
  // Explicit legacy server view: a genuine offseason snapshot retaining a genuine completed camp.
  const state=JSON.parse(readFixture(process.env.E2E_FIXTURE_DIR!,'offseason-fa-skip-carried').save).state;state.trainingCamp=completed.trainingCamp;const gm=state.gms.find((g:any)=>g.id===state.viewerGmId);
  state.reveal??={preseasonWeek:{},regularWeek:{},playoffRounds:{},step:{}};state.reveal.step[gm.id]='rookieSignings';expect(state.trainingCamp.plans[gm.teamCode].submitted).toBe(true);
  let transport:Awaited<ReturnType<typeof controlledLeague>>;transport=await controlledLeague(page,origin,state,{teamCode:gm.teamCode,gmId:gm.id},async(path,payload)=>{if(!path.endsWith('/step'))return {status:400,body:{error:'Unexpected controlled action'}};state.reveal.step[gm.id]=payload.step;transport.setState(state);return {status:200,body:{ok:true,version:'ui4-version'}};});await page.goto('/#/training-camp');await page.reload();await expect(page.getByText('Controlled UI league',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'See Your Results',exact:true}).click();await expect(page).toHaveURL(/#\/training-camp-results$/);expect(state.reveal.step[gm.id],'Old results must not overwrite the current signings marker').toBe('rookieSignings');expect(transport.requests).toEqual([]);
 });
});
