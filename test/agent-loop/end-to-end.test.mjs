import test from 'node:test';
import assert from 'node:assert/strict';
import { reduce } from '../../scripts/agent-loop/reducer.mjs';
import { digest } from '../../scripts/agent-loop/contracts.mjs';
import { start,plan,policy,task,sha,observation,authority } from './fixtures.mjs';

const head='2'.repeat(40);
const result={schemaVersion:1,taskId:task.id,runId:'run-1',planDigest:digest(plan),baseSha:sha,headSha:head,diff:[{path:'docs/fixture.md',additions:1,deletions:0,mode:'100644',binary:false}],summary:'fixture'};
const review=(verdict='accept',findings=[])=>({schemaVersion:1,taskId:task.id,runId:'run-1',subjectDigest:digest(plan),baseSha:sha,headSha:head,verdict,findings});
function reviewed() {let s=start();for(const e of [observation('plan',{plan}),observation('plan_review',{review:{...review(),headSha:null}}),observation('implementation',{result}),observation('published',{pr:7,headSha:head}),observation('ci',{headSha:head,checks:{test:'success'}})])s=reduce(s,e,policy,authority).state;return s;}
test('full loop reaches human-ready before verified human merge',()=>{
 let s=reviewed();s=reduce(s,observation('code_review',{review:review()}),policy,authority).state;
 assert.equal(s.tasks[task.id].status,'code_review');
 s=reduce(s,observation('managed_review',{headSha:head,clean:true,findings:[]}),policy,authority).state;
 assert.equal(s.tasks[task.id].status,'ready_for_human');assert.throws(()=>reduce(s,observation('human_merge',{headSha:head,actor:'bot',mergeSha:sha,acceptanceVerified:true}),policy,authority));
 s=reduce(s,observation('human_merge',{headSha:head,actor:'owner',mergeSha:sha,acceptanceVerified:true}),policy,authority).state;
 assert.equal(s.tasks[task.id].status,'complete');
});
test('new implementation invalidates previous evidence and requires re-review',()=>{
 let s=reviewed();const finding={id:'F1',severity:'P1',evidence:'fixture detail missing',correction:'add detail',scope:'approved'};
 s=reduce(s,observation('code_review',{review:review('revise',[finding])}),policy,authority).state;
 s=reduce(s,observation('managed_review',{headSha:head,clean:false,findings:[finding]}),policy,authority).state;
 assert.equal(s.tasks[task.id].status,'fixing');
 s=reduce(s,observation('implementation',{result:{...result,headSha:'3'.repeat(40)}},'fix-1'),policy,authority).state;
 assert.equal(s.tasks[task.id].status,'ci_pending');assert.equal(s.tasks[task.id].ci,null);assert.equal(s.tasks[task.id].managedReview,null);
 assert.throws(()=>reduce(s,observation('ci',{headSha:head,checks:{test:'success'}},'stale-ci'),policy,authority));
});
test('conflicting reviewers escalate instead of looping',()=>{let s=reduce(reviewed(),observation('code_review',{review:review()}),policy,authority).state;s=reduce(s,observation('managed_review',{headSha:head,clean:false,findings:[]}),policy,authority).state;assert.equal(s.tasks[task.id].status,'blocked');});
test('managed new-scope finding cannot enter fixing',()=>{const f={id:'F1',severity:'P1',evidence:'fixture',correction:'fix within scope',scope:'approved'};let s=reduce(reviewed(),observation('code_review',{review:review('revise',[f])}),policy,authority).state;s=reduce(s,observation('managed_review',{headSha:head,clean:false,findings:[{...f,id:'M1',scope:'new'}]}),policy,authority).state;assert.equal(s.tasks[task.id].status,'blocked');});
test('missing managed review and closed unmerged PR never mean success',()=>{let s=reviewed();s=reduce(s,{...observation('review_timeout'),at:1201001},policy,authority).state;assert.equal(s.tasks[task.id].status,'blocked');assert.equal(s.paused,true);assert.equal(reduce(reviewed(),observation('close'),policy,authority).state.tasks[task.id].status,'blocked');});
