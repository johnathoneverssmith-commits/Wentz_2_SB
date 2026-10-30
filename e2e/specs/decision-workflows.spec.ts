import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, SAVE_KEY } from '../support/test.ts';
import type { Page } from '@playwright/test';
const saved=(page:Page)=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)!).state,SAVE_KEY);
async function capture(page:Page,name:string){if(process.env.UI4_ARTIFACTS){mkdirSync(process.env.UI4_ARTIFACTS,{recursive:true});await page.evaluate(()=>{document.querySelectorAll('.scroll-list').forEach(el=>el.scrollTop=0);window.scrollTo({top:0,behavior:'instant'});});await page.screenshot({path:join(process.env.UI4_ARTIFACTS,name),fullPage:page.viewportSize()!.width<700});}}
for(const [device,width] of [['desktop',1600],['mobile',390]] as const){
 test.describe(`UI-4 draft ${device}`,()=>{
  test.use({fixtureName:'fantasy-draft'});
  test('confirmation is cancellable and drafts the exact player once after compare and reload',async({page})=>{
   await page.emulateMedia({reducedMotion:'reduce'});await page.setViewportSize({width,height:device==='desktop'?1100:844}); await page.goto('/');
   await page.getByRole('dialog').filter({hasText:'on the clock'}).click();
   const before=await saved(page); const row=page.locator('.draft-avail tbody tr').nth(2);
   const button=row.getByRole('button',{name:/^Draft /});const name=(await button.getAttribute('aria-label'))!.replace(/^Draft /,'');
   const candidate=before.players[(await row.getAttribute('data-player-id'))!];
   await row.getByRole('button',{name:`Compare ${name}`,exact:true}).click();expect((await saved(page)).draft).toEqual(before.draft);
   if(device==='mobile'){const search=(await page.getByRole('searchbox').boundingBox())!;const filter=(await page.getByRole('combobox',{name:'Filter by position',exact:true}).boundingBox())!;expect(filter.y).toBeGreaterThanOrEqual(search.y+search.height);}
   await capture(page,`draft-${device}.png`);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
   await button.click();const dialog=page.getByRole('dialog',{name:`Draft ${name}?`,exact:true});
   await expect(dialog).toBeVisible();await expect(dialog).toContainText(name);await expect(dialog.getByRole('button',{name:'Cancel',exact:true})).toBeFocused();await page.keyboard.press('Shift+Tab');await expect(dialog.getByRole('button',{name:'Confirm pick',exact:true})).toBeFocused();await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(button).toBeFocused();
   expect((await saved(page)).draft).toEqual(before.draft);
   await button.click();await dialog.getByRole('button',{name:'Confirm pick',exact:true}).click();
   const me=before.gms.find((g:any)=>g.id===before.viewerGmId).teamCode;
   await expect.poll(async()=> (await saved(page)).draft.results.filter((r:any)=>r.selectedId===candidate.id).length).toBe(1);
   const after=await saved(page);expect(after.players[candidate.id].nfl_team).toBe(me);
   await page.reload();expect((await saved(page)).draft.results).toEqual(after.draft.results);
  });
 });
}

for(const [device,width] of [['desktop',1600],['mobile',390]] as const){
 test.describe(`UI-4 five-round market ${device}`,()=>{
  test.use({fixtureName:'midseason-fa'});
  test('compares, cancels and submits the exact salary and years with persistence',async({page})=>{
   await page.setViewportSize({width,height:device==='desktop'?1100:844});await page.goto('/');
   const before=await saved(page);const row=page.locator('[data-player-id]').filter({has:page.getByRole('button',{name:/^Offer /})}).first();
   const id=(await row.getAttribute('data-player-id'))!;const player=before.players[id];
   await row.getByRole('button',{name:`Compare ${player.name}`,exact:true}).click();
   expect((await saved(page)).freeAgencyEvent).toEqual(before.freeAgencyEvent);
   await row.getByRole('button',{name:`Offer ${player.name}`,exact:true}).click();
   let form=page.getByRole('group',{name:`Offer to ${player.name}`,exact:true});
   const salary=Number(await form.getByRole('spinbutton').inputValue());
   await form.getByRole('combobox').selectOption('2');
   const card=page.locator('.decision-workspace .card');
   expect(await card.evaluate(el=>el.scrollLeft),'the offer must not horizontally scroll the whole card').toBe(0);
   if(device==='desktop'){const crest=(await page.locator('.decision-heading .sports-crest').boundingBox())!;const frame=(await card.boundingBox())!;expect(crest.x).toBeGreaterThanOrEqual(frame.x);}
   await capture(page,`free-agency-${device}.png`);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
   await form.getByRole('button',{name:'Cancel',exact:true}).click();
   expect((await saved(page)).freeAgencyEvent).toEqual(before.freeAgencyEvent);
   await row.getByRole('button',{name:`Offer ${player.name}`,exact:true}).click();
   form=page.getByRole('group',{name:`Offer to ${player.name}`,exact:true});
   await form.getByRole('combobox').selectOption('2');await form.getByRole('button',{name:'Submit offer',exact:true}).click();
   const me=before.gms.find((g:any)=>g.id===before.viewerGmId).teamCode;
   await expect.poll(async()=> (await saved(page)).freeAgencyEvent.offers[id]?.filter((o:any)=>o.teamCode===me&&o.salary===salary&&o.years===2).length??0).toBe(1);
   const after=await saved(page);await page.reload();expect((await saved(page)).freeAgencyEvent).toEqual(after.freeAgencyEvent);
  });
 });
 test.describe(`UI-4 trade ${device}`,()=>{
  test.use({fixtureName:'season-week-9'});
  test('reviews an exact owned pick and sends one proposal that persists',async({page})=>{
   await page.setViewportSize({width,height:device==='desktop'?1100:844});await page.goto('/#/trade');
   const before=await saved(page);const mine=page.locator('.decision-trade-column[data-side="you"]');
   await mine.getByRole('combobox').selectOption('PICK');const asset=mine.locator('[data-asset-id]').first();
   const id=(await asset.getAttribute('data-asset-id'))!;expect(id.startsWith('pick:')).toBe(true);
   await asset.click();
   if(device==='mobile')await page.getByRole('group',{name:'Trade workflow'}).getByRole('button',{name:'Review',exact:true}).click();
   const summary=page.getByRole('region',{name:'Selected trade assets'});
   await expect(summary.locator('[data-asset-id]')).toHaveAttribute('data-asset-id',id);
   expect((await saved(page)).trades).toEqual(before.trades);
   await capture(page,`trade-${device}.png`);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
   const submit=page.getByRole('button',{name:'Propose trade',exact:true});await expect(submit).toBeEnabled();await submit.click();
   await expect.poll(async()=>(await saved(page)).trades.length).toBe(before.trades.length+1);
   const after=await saved(page);const sent=after.trades[after.trades.length-1];expect(sent.fromAssets).toHaveLength(1);expect(sent.fromAssets[0].kind).toBe('pick');
   const expected=before.draftPicks[id.slice(5)];expect(sent.fromAssets[0].pick).toMatchObject({year:expected.year,round:expected.round,originalTeam:expected.originalTeam});
   await page.reload();expect((await saved(page)).trades).toEqual(after.trades);
  });
 });
}
test.describe('UI-4 standing market',()=>{
 test.use({fixtureName:'season-week-9'});
 test('negotiation edits cancel without altering player contracts at phone and tablet widths',async({page})=>{
  for(const width of [390,768]){
   await page.setViewportSize({width,height:1000});await page.goto('/#/free-agency');const before=await saved(page);
   await page.getByRole('button',{name:'Negotiate',exact:true}).first().click();
   const form=page.getByRole('region',{name:/^Offer to /});await expect(form).toBeVisible();
   await expect(form.getByRole('spinbutton').first()).toBeFocused();await form.getByRole('spinbutton').first().fill('5');
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
   await form.getByRole('button',{name:'Cancel',exact:true}).click();expect((await saved(page)).players).toEqual(before.players);
  }
 });
});
test.describe('UI-4 deadline',()=>{
 test.use({fixtureName:'trade-deadline'});
 test('the existing deadline decision advances once and survives a reload',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/');const before=await saved(page);
  const accept=page.getByRole('button',{name:'Accept',exact:true});
  if(await accept.count()){
   page.once('dialog',async dialog=>{expect(dialog.message()).toContain('Accept this trade');await dialog.accept();});await accept.click();
  }else{
   const pass=page.getByRole('button',{name:'Pass this turn',exact:true});
   page.once('dialog',async dialog=>{expect(dialog.message()).toContain('Pass');await dialog.accept();});await pass.click();
  }
  await expect.poll(async()=>JSON.stringify((await saved(page)).tradeDeadline)).not.toBe(JSON.stringify(before.tradeDeadline));
  const after=await saved(page);await page.reload();expect((await saved(page)).tradeDeadline).toEqual(after.tradeDeadline);
 });
});
