import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpBroker } from '../../scripts/agent-loop/broker.mjs';
import { collectObservations, verifyManifestApproval } from '../../scripts/agent-loop/observe.mjs';
import { sha,manifest,policy,task,implementing } from './fixtures.mjs';
import { digest } from '../../scripts/agent-loop/contracts.mjs';

test('broker transport pins HTTPS and rejects redirects and uncertain jobs',async()=>{
 assert.throws(()=>new HttpBroker({url:'http://host',token:'fixture'}));
 const broker=new HttpBroker({url:'https://broker.example',token:'fixture',request:async()=>({ok:false,status:302})});
 await assert.rejects(broker.live('owner'));
});
test('broker retries reuse the same operation identity',async()=>{
 const bodies=[];const broker=new HttpBroker({url:'https://broker.example',token:'fixture',request:async(url,options)=>{bodies.push(JSON.parse(options.body));return {ok:true,json:async()=>({accepted:true})};}});
 const effect={type:'worker',role:'claude-implement',taskId:task.id,key:'f'.repeat(64)};
 await broker.execute(effect,implementing());await broker.execute(effect,implementing());assert.equal(bodies[0].key,bodies[1].key);
});
test('manifest approval must be an approved merged PR with exact reviewed content',async()=>{
 const client={repository:'owner/repo',verifyHuman:async()=>({actor:'owner',type:'User',permission:'admin'}),api:async path=>{
 if(path.endsWith('/reviews'))return [{id:9,state:'APPROVED',user:{login:'owner',type:'User'},commit_id:sha,html_url:'https://github.com/owner/repo/pull/1#pullrequestreview-9'}];
 if(path.includes('/contents/'))return {encoding:'base64',content:Buffer.from(JSON.stringify(manifest)).toString('base64')};
 if(path.includes('/compare/'))return {status:'ahead'};
 return {merged:true,base:{ref:'master'},head:{repo:{full_name:'owner/repo'}}};}};
 const evidence=await verifyManifestApproval(client,{pr:1,reviewId:9},manifest,'2'.repeat(40),policy);assert.equal(evidence.manifestDigest,digest(manifest));
 client.api=async()=>({merged:false});await assert.rejects(verifyManifestApproval(client,{pr:1,reviewId:9},manifest,sha,policy));
});
test('managed reaction alone never produces a clean observation',async()=>{
 const s=implementing();s.tasks[task.id].status='code_review';s.tasks[task.id].pr=7;s.tasks[task.id].headSha='2'.repeat(40);s.tasks[task.id].reviewStartedAt=1000;
 const client={repository:'owner/repo',api:async path=>path.includes('/pulls/7')?{head:{sha:'2'.repeat(40)},state:'open',merged:false}:[]};
 const events=await collectObservations(client,s,{now:1001,policy,broker:{results:async()=>[]},managedBot:'chatgpt-codex-connector[bot]'});
 assert.equal(events.filter(e=>e.type==='managed_review').length,0);
});
test('queued or absent CI blocks after the approved task deadline',async()=>{
 const s=implementing();s.tasks[task.id].status='ci_pending';s.tasks[task.id].pr=7;s.tasks[task.id].headSha='2'.repeat(40);
 const client={repository:'owner/repo',api:async()=>({head:{sha:'2'.repeat(40)},state:'open',merged:false,check_runs:[]})};
 const events=await collectObservations(client,s,{now:7201001,policy,broker:{results:async()=>[]}});assert.deepEqual(events.map(e=>e.type),['failure']);
});
test('broker pages more than one hundred historical results',async()=>{
 let calls=0;const first=Array.from({length:100},(_,i)=>({id:String(i)}));
 const broker=new HttpBroker({url:'https://broker.example',token:'fixture',request:async()=>({ok:true,json:async()=>++calls===1?{items:first,nextCursor:'a'.repeat(64)}:{items:[{id:'last'}],nextCursor:null}})});
 const result=await broker.results();assert.equal(result.length,101);assert.equal(calls,2);
});
