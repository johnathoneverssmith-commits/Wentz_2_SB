import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHubClient } from '../../scripts/agent-loop/github.mjs';
import { initialState } from '../../scripts/agent-loop/reducer.mjs';
import { digest } from '../../scripts/agent-loop/contracts.mjs';
import { manifest,policy,sha,task } from './fixtures.mjs';

const response=(data,status=200)=>({ok:status<400,status,json:async()=>data});
test('publication validates actual files instead of the claimed summary',async()=>{
 const requests=[];
 const client=new GitHubClient({repository:'owner/repo',token:'fixture',policy,manifestDigest:digest(manifest),request:async(url,options)=>{requests.push({url,options});if(url.includes('/compare/'))return response({files:[{filename:'.github/workflows/evil.yml',status:'added',additions:1,deletions:0,patch:'@@\n+evil'}],total_commits:1});return response({});}});
 await assert.rejects(client.publish({task,baseSha:sha,headSha:'2'.repeat(40),branch:'agent-loop/docs-1/run-1',key:'3'.repeat(64),stateSha:sha,planDigest:'4'.repeat(64)}));
 assert.equal(requests.filter(r=>r.options.method!=='GET').length,0);
});
test('publisher cannot target master or arbitrary refs',async()=>{
 const client=new GitHubClient({repository:'owner/repo',token:'fixture',policy,manifestDigest:digest(manifest),request:async()=>{throw new Error('API should not be reached');}});
 for(const branch of ['master','agent-loop-state','feature/a','agent-loop/../master'])await assert.rejects(client.publish({task,baseSha:sha,headSha:'2'.repeat(40),branch,key:'3'.repeat(64)}),/branch/);
});
test('state update uses a child commit and fails on a moved expected ref',async()=>{
 const writes=[];
 const client=new GitHubClient({repository:'owner/repo',token:'fixture',policy,manifestDigest:digest(manifest),request:async(url,options)=>{if(options.method!=='GET')writes.push(options);return response({object:{sha:'2'.repeat(40)}});}});
 await assert.rejects(client.compareAndSwap(sha,{state:initialState(digest(manifest)),journal:[],outbox:[],lease:null}),/conflict/);
 assert.equal(writes.length,0);
});
test('raw webhook actor/body cannot synthesize approved observations',async()=>{
 const client=new GitHubClient({repository:'owner/repo',token:'fixture',policy,manifestDigest:digest(manifest),request:async()=>response({permission:'read',user:{type:'User'}})});
 await assert.rejects(client.verifyHuman('owner'),/human/);
});
test('one-line edit in a long file uses actual GitHub diff counts and tree SHA',async()=>{
 const treeSha='3'.repeat(40),head='2'.repeat(40),bodies=[];
 const state={task,runId:'run-1',baseSha:sha,headSha:null,planDigest:'4'.repeat(64),plan:{paths:['docs/fixture.md']}};
 const old=Array.from({length:200},(_,i)=>`line ${i}`).join('\n')+'\n';
 const client=new GitHubClient({repository:'owner/repo',token:'fixture',policy,manifestDigest:digest(manifest),request:async(url,options)=>{if(options.body)bodies.push(JSON.parse(options.body));if(url.includes('/compare/'))return response({files:[{filename:'docs/fixture.md',additions:1,deletions:1,patch:'@@\n-change\n+fixed'}]});if(url.includes('/git/trees/')&&options.method==='GET')return response({sha:treeSha,truncated:false,tree:[{path:'docs/fixture.md',mode:'100644',sha:'5'.repeat(40)}]});if(url.includes('/git/blobs/'))return response({encoding:'base64',content:Buffer.from(old).toString('base64')});return response({sha:head});}});
 const result=await client.importFiles(state,[{path:'docs/fixture.md',content:old.replace('line 0','fixed')}],{schemaVersion:1,taskId:task.id,runId:'run-1',planDigest:state.planDigest,baseSha:sha,headSha:sha,diff:[{path:'docs/fixture.md',additions:1,deletions:1,mode:'100644',binary:false}],summary:'fix'});
 assert.equal(result.diff[0].additions,1);assert.equal(result.diff[0].deletions,1);assert.equal(bodies.find(b=>b.base_tree).base_tree,treeSha);
});
test('published PR carries approved acceptance and immutable plan audit links',async()=>{
 let body;
 const client=new GitHubClient({repository:'owner/repo',token:'fixture',policy,manifestDigest:digest(manifest),request:async(url,options)=>{
  if(url.includes('/compare/'))return response({status:'ahead',files:[{filename:'docs/fixture.md',additions:1,deletions:0,patch:'@@\n+fixture'}]});
  if(url.includes('/git/trees/'))return response({truncated:false,tree:[{path:'docs/fixture.md',mode:'100644'}]});
  if(url.includes('/pulls?'))return response([]);
  if(url.includes('/git/ref/'))return response({},404);
  if(url.endsWith('/pulls')&&options.method==='POST'){body=JSON.parse(options.body).body;return response({number:7});}
  return response({});
 }});
 await client.publish({task,baseSha:sha,headSha:'2'.repeat(40),branch:'agent-loop/docs-1/run-1',key:'3'.repeat(64),stateSha:'5'.repeat(40),planDigest:'4'.repeat(64)});
 assert.ok(body.includes('fixture explains the task'));assert.ok(body.includes('/blob/'+ '5'.repeat(40)+'/loop.json'));assert.ok(body.includes('4'.repeat(64)));assert.ok(body.includes('Required checks: test'));
});
