import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,writeFile,symlink,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captureFiles } from '../../scripts/agent-loop/docker-worker.mjs';
import { WorkerGate } from '../../scripts/agent-loop/jobs.mjs';
import { collectObservations } from '../../scripts/agent-loop/observe.mjs';
import { implementing,policy,task,sha } from './fixtures.mjs';

test('host capture rejects symlink before reading external content',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'loop-capture-'));
 try{await mkdir(join(dir,'docs'));const secret=join(dir,'private-secret');await writeFile(secret,'CANARY');try{await symlink(secret,join(dir,'docs/fixture.md'));}catch(e){if(e.code==='EPERM'){t.skip('Windows symlink privilege unavailable; enforced in Linux CI');return;}throw e;}await assert.rejects(captureFiles(dir,['docs/fixture.md'],task),/symlink|file|containment/);}finally{await rm(dir,{recursive:true,force:true});}
});
test('pause stops pending timers and preparing worker launch',async()=>{const gate=new WorkerGate();const token=gate.reserve('a'.repeat(64));await gate.pause();assert.equal(token.signal.aborted,true);assert.throws(()=>gate.assertActive(token),/paused|cancel/);});
test('late completed review never emits a timeout in the same batch',async()=>{
 const s=implementing(),head='2'.repeat(40);Object.assign(s.tasks[task.id],{status:'code_review',pr:7,headSha:head,reviewStartedAt:0});
 const client={repository:'owner/repo',api:async path=>{if(path==='/pulls/7')return {head:{sha:head},state:'open',merged:false,base:{ref:'master'}};if(path.includes('/issues/7/comments'))return [{id:1,user:{login:'bot',type:'Bot'},body:'<!-- codex-pull-request-review-summary --> Completed `2222222`',updated_at:'2026-01-01T00:00:00Z'}];if(path.includes('/reactions'))return [{user:{login:'bot',type:'Bot'},content:'+1',created_at:'2026-01-01T00:01:00Z'}];return [];}};
 const events=await collectObservations(client,s,{now:1201001,policy,broker:{results:async()=>[]},managedBot:'bot'});assert.deepEqual(events.map(e=>e.type),['managed_review']);
});
test('merge into another branch cannot complete an approved task',async()=>{
 const s=implementing();Object.assign(s.tasks[task.id],{status:'ready_for_human',pr:7,headSha:'2'.repeat(40)});
 const client={repository:'owner/repo',verifyHuman:async()=>{},api:async()=>({head:{sha:'2'.repeat(40),repo:{full_name:'owner/repo'}},base:{ref:'other'},merged:true,merged_by:{login:'owner'},merge_commit_sha:sha})};
 await assert.rejects(collectObservations(client,s,{now:1000,policy,broker:{results:async()=>[]}}),/base|master/);
});
