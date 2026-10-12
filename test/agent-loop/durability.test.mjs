import test from 'node:test';
import assert from 'node:assert/strict';
import { append, replay } from '../../scripts/agent-loop/journal.mjs';
import { reconcile } from '../../scripts/agent-loop/controller.mjs';
import { initialState } from '../../scripts/agent-loop/reducer.mjs';
import { digest } from '../../scripts/agent-loop/contracts.mjs';
import { manifest, policy, task, sha, observation, implementing } from './fixtures.mjs';

test('journal detects modified, missing and reordered entries',()=>{
 let j=append([],observation('start',{task,runId:'run-1',baseSha:sha}));j=append(j,observation('pause',{},'pause'));
 assert.equal(replay(j,digest(manifest),policy).paused,true);
 for(const bad of [[j[1]],[j[1],j[0]],[{...j[0],hash:'f'.repeat(64)},j[1]]])assert.throws(()=>replay(bad,digest(manifest),policy));
});
class Store {
 constructor(state){this.document={state,journal:[],outbox:[],lease:null};this.version=0;this.prs=[];this.failAfterCreate=false;this.workers=[];}
 async read(){return {sha:String(this.version),document:structuredClone(this.document)};}
 async compareAndSwap(expected,document){if(expected!==String(this.version))throw new Error('Lease conflict');this.document=structuredClone(document);this.version++;return String(this.version);}
 async workerLive(){return false;}
 async execute(effect){if(effect.type==='publish'){let pr=this.prs.find(x=>x.key===effect.key);if(!pr){pr={key:effect.key,number:1,headSha:effect.headSha};this.prs.push(pr);}if(this.failAfterCreate){this.failAfterCreate=false;throw new Error('Simulated crash');}return {pr:pr.number,headSha:pr.headSha};}this.workers.push(effect);return {};}
}
const context=(events=[],owner='controller-1')=>({events,owner,now:1000,leaseMs:60000,policy,manifestDigest:digest(manifest)});
test('duplicate trigger and competing controllers launch one worker',async()=>{
 const store=new Store(initialState(digest(manifest)));const e=observation('start',{task,runId:'run-1',baseSha:sha});
 const results=await Promise.allSettled([reconcile(context([e]),store),reconcile(context([e],'controller-2'),store)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(store.workers.length,1);
 await reconcile(context([e]),store);assert.equal(store.workers.length,1);
});
test('crash after publication recovers the same PR',async()=>{
 const store=new Store(implementing());store.failAfterCreate=true;
 const e=observation('implementation',{result:{schemaVersion:1,taskId:task.id,runId:'run-1',planDigest:store.document.state.tasks[task.id].planDigest,baseSha:sha,headSha:'2'.repeat(40),diff:[{path:'docs/fixture.md',additions:1,deletions:0,mode:'100644',binary:false}],summary:'fixture'}});
 await assert.rejects(reconcile(context([e]),store));await reconcile(context([], 'controller-1'),store);
 assert.equal(store.prs.length,1);assert.equal(store.document.state.tasks[task.id].pr,1);assert.equal(store.document.outbox.length,0);
});
test('pause cancels pending worker effects before execution',async()=>{
 const store=new Store(initialState(digest(manifest)));
 await reconcile(context([observation('start',{task,runId:'run-1',baseSha:sha}),observation('pause',{},'pause')]),store);
 assert.deepEqual(store.workers.map(e=>e.type),['cancel_workers']);assert.equal(store.document.state.paused,true);
});
test('expired lease cannot be stolen from a live worker',async()=>{
 const store=new Store(initialState(digest(manifest)));store.document.lease={owner:'old',expiresAt:0};store.workerLive=async()=>true;
 await assert.rejects(reconcile(context(),store),/live worker/);
});
