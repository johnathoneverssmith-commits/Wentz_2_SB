import {expect,test,SAVE_KEY} from '../support/test.ts';
import {controlledLeague} from '../support/controlled-league.ts';
import type {Page} from '@playwright/test';
const onlineSaved=(page:Page)=>page.evaluate(()=>JSON.parse(localStorage.getItem('nfl-sim-ui.online-league')!).state);
const saved=(page:Page)=>page.evaluate(k=>JSON.parse(localStorage.getItem(k)!).state,SAVE_KEY);

test.describe('UI-4 controlled multiplayer transport — UI guards, not server E2E',()=>{
 test.describe('draft permissions',()=>{
  test.use({fixtureName:'fantasy-draft'});
  test('another GM can browse and compare but cannot submit the on-clock team selection',async({page,origin})=>{
   await page.goto('/');await page.getByRole('dialog').filter({hasText:'on the clock'}).click();const state=await saved(page);
   const targetId=(await page.locator('.draft-avail tbody tr').first().getAttribute('data-player-id'))!;state.players[targetId].potential=98765432;
   const owner=state.gms.find((g:any)=>g.id===state.viewerGmId);const other={...owner,id:"ui4_other_gm",name:"Other GM",teamCode:Object.keys(state.teams).find(code=>code!==owner.teamCode),isHuman:true};state.gms.push(other);
   const transport=await controlledLeague(page,origin,state,{teamCode:other.teamCode,gmId:other.id});await page.reload();
   await expect(page.getByText('Controlled UI league',{exact:true})).toBeVisible();
   const buttons=page.getByRole('table').getByRole('button',{name:/^Draft /});await expect(buttons.first()).toBeDisabled();
   const target=page.locator(`.draft-avail tr[data-player-id="${targetId}"]`);await expect(target).toBeVisible();await target.getByRole('button',{name:/^Compare /}).click();await expect(page.locator('body')).not.toContainText('98765432');expect(transport.requests).toEqual([]);
   expect((await saved(page)).draft.results).toEqual(state.draft.results);expect(transport.unexpected).toEqual([]);
   await page.reload();await expect(page.getByText('Controlled UI league',{exact:true})).toBeVisible();expect((await onlineSaved(page)).draft.results).toEqual(state.draft.results);
  });
 });
 test.describe('market refusal',()=>{
  test.use({fixtureName:'midseason-fa'});
  test('one in-flight offer reports a server refusal without optimistic ownership or contract changes',async({page,origin})=>{
   await page.setViewportSize({width:390,height:844});
   await page.goto('/');const state=await saved(page);const gm=state.gms.find((g:any)=>g.id===state.viewerGmId);
   const transport=await controlledLeague(page,origin,state,{teamCode:gm.teamCode,gmId:gm.id},async()=>{
    await new Promise(r=>setTimeout(r,150));return {status:403,body:{error:'This turn belongs to another GM.'}};
   });await page.reload();await expect(page.getByText('Controlled UI league',{exact:true})).toBeVisible();
   const offer=page.getByRole('button',{name:/^Offer /}).first();await offer.click();const form=page.getByRole('group',{name:/^Offer to /});
   const salary=Number(await form.getByRole('spinbutton').inputValue());
   await form.getByRole('button',{name:'Submit offer',exact:true}).evaluate((el:HTMLButtonElement)=>{el.click();el.click();});
   await expect(page.getByRole('status').filter({hasText:'This turn belongs to another GM.'})).toBeVisible();
   expect(transport.requests).toHaveLength(1);expect(transport.requests[0]!.payload.salary).toBe(salary);expect(transport.requests[0]!.payload.version).toBe('ui4-version');
   expect(transport.unexpected).toEqual([]);expect((await saved(page)).players).toEqual(state.players);
   await page.reload();await expect(page.getByText('Controlled UI league',{exact:true})).toBeVisible();const after=await onlineSaved(page);expect(after.players).toEqual(state.players);expect(after.freeAgencyEvent).toEqual(state.freeAgencyEvent); await page.getByRole('button',{name:'Pass this round',exact:true}).click(); const refusal=page.getByRole('status').filter({hasText:'This turn belongs to another GM.'});await expect(refusal).toBeInViewport();
  });
 });
 test.describe('market loading transition',()=>{
  test.use({fixtureName:'midseason-fa'});
  test('an online event disappearing into loading does not change hook order',async({page,origin,consoleErrors})=>{
   await page.goto('/');const state=await saved(page);const gm=state.gms.find((g:any)=>g.id===state.viewerGmId);
   let transport:Awaited<ReturnType<typeof controlledLeague>>;
   transport=await controlledLeague(page,origin,state,{teamCode:gm.teamCode,gmId:gm.id},async()=>{
    transport.setState({...state,freeAgencyEvent:null});return {status:200,body:{ok:true,version:'ui4-version'}};
   });await page.reload();await expect(page.getByText('Controlled UI league',{exact:true})).toBeVisible();
   await page.getByRole('button',{name:'Pass this round',exact:true}).click();
   await expect(page.getByText('Opening the market',{exact:true})).toBeVisible();expect(consoleErrors).toEqual([]);expect(transport.requests).toHaveLength(1);
  });
 });
 test.describe('frozen season checkpoint',()=>{
  test.use({fixtureName:'season-week-9'});
  test('online standing-market signing and ordinary trade submission stay closed during the played block',async({page,origin})=>{
   await page.goto('/');const state=await saved(page);const gm=state.gms.find((g:any)=>g.id===state.viewerGmId);
   const transport=await controlledLeague(page,origin,state,{teamCode:gm.teamCode,gmId:gm.id});await page.goto('/#/free-agency');await page.reload();
   await expect(page.getByText('Controlled UI league',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Negotiate',exact:true}).first()).toBeDisabled();
   await page.getByRole('navigation',{name:'Main'}).getByRole('link',{name:'Trade Proposal',exact:true}).click();
   const mine=page.locator('.decision-trade-column[data-side="you"]');await mine.getByRole('combobox').selectOption('PICK');await mine.locator('[data-asset-id]').first().click();
   await expect(page.getByRole('button',{name:'Propose trade',exact:true})).toBeDisabled();expect(transport.requests).toEqual([]);expect(transport.unexpected).toEqual([]);expect((await saved(page)).trades).toEqual(state.trades);
  });
 });
});

test.describe('UI-4 controlled deadline counter presentation',()=>{
 test.use({fixtureName:'trade-deadline'});
 test('recipient mobile selections retain proposer payload orientation and final acceptance is single-shot',async({page,origin})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/');const state=await saved(page);
  const gm=state.gms.find((g:any)=>g.id===state.viewerGmId);const otherCode=Object.keys(state.teams).find(code=>code!==gm.teamCode)!;
  const proposer={...gm,id:'ui4_counter_proposer',name:'Proposing GM',teamCode:otherCode,isHuman:true};state.gms.push(proposer);
  const player=(code:string)=>Object.values(state.players).find((p:any)=>p.nfl_team===code&&!p.retired&&!p.free_agent&&p.overall>65&&p.overall<85) as any;
  const mine=player(gm.teamCode),theirs=player(otherCode);expect(mine).toBeTruthy();expect(theirs).toBeTruthy();
  // Controlled response views exercise presentation; this is not a second rule engine.
  state.tradeDeadline.active={id:'ui4_counter_offer',round:state.tradeDeadline.round,fromTeam:otherCode,toTeam:gm.teamCode,fromAssets:[{kind:'player',playerId:theirs.id}],toAssets:[{kind:'player',playerId:mine.id}],awaiting:'recipient',modified:false};
  let transport:Awaited<ReturnType<typeof controlledLeague>>;
  transport=await controlledLeague(page,origin,state,{teamCode:gm.teamCode,gmId:gm.id},async(_path,payload)=>{
   const move=payload.move;
   if(move.kind==='modify'){
    const asset=(id:string)=>id.startsWith('pick:')?{kind:'pick',pick:state.draftPicks[id.slice(5)]}:{kind:'player',playerId:id};
    state.tradeDeadline.active={...state.tradeDeadline.active,fromAssets:move.proposerGives.map(asset),toAssets:move.proposerGets.map(asset),awaiting:'proposer',modified:true};
   }else if(move.kind==='accept'){
    state.tradeDeadline.resolved.push({...state.tradeDeadline.active,outcome:'accepted'});state.tradeDeadline.active=null;
   }else return {status:400,body:{error:'Unexpected controlled action'}};
   transport.setState(state);return {status:200,body:{ok:true,version:'ui4-version'}};
  });
  await page.reload();await expect(page.getByText('Controlled UI league',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Counter',exact:true}).click();
  const own=page.locator('.decision-trade-column[data-side="you"]');await expect(own.locator(`[data-asset-id="${mine.id}"]`)).toHaveAttribute('aria-pressed','true');
  await own.getByRole('combobox').selectOption('PICK');const pick=own.locator('[data-asset-id]').first();const pickId=(await pick.getAttribute('data-asset-id'))!;await pick.click();
  await page.getByRole('group',{name:'Trade workflow'}).getByRole('button',{name:/^Their assets/}).click();
  await expect(page.locator('.decision-trade-column[data-side="them"]').locator(`[data-asset-id="${theirs.id}"]`)).toHaveAttribute('aria-pressed','true');
  await page.getByRole('group',{name:'Trade workflow'}).getByRole('button',{name:'Review',exact:true}).click();
  await expect(page.getByRole('region',{name:'Selected trade assets'}).locator(`[data-asset-id="${pickId}"]`)).toBeVisible();
  await page.getByRole('button',{name:'Send Counter',exact:true}).click();await expect.poll(()=>transport.requests.length).toBe(1);
  expect(transport.requests[0]!.payload.move).toEqual({kind:'modify',proposerGives:[theirs.id],proposerGets:[mine.id,pickId]});
  await expect(page.getByRole('button',{name:'Send Counter',exact:true})).toHaveCount(0);
  transport.setViewer({teamCode:otherCode,gmId:proposer.id});await page.reload();await expect(page.getByText('They countered.',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Counter',exact:true})).toHaveCount(0);
  page.once('dialog',async dialog=>{expect(dialog.message()).toContain('Accept this trade');await dialog.accept();});
  await page.getByRole('button',{name:'Accept',exact:true}).click();await expect.poll(()=>transport.requests.length).toBe(2);
  expect(transport.requests[1]!.payload.move).toEqual({kind:'accept'});expect(transport.unexpected).toEqual([]);
  await expect(page.getByRole('status').filter({hasText:'Your last negotiation'})).toContainText('trade made with');
 });
});
