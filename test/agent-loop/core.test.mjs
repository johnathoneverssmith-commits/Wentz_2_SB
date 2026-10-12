import test from 'node:test';
import assert from 'node:assert/strict';
import { digest, validate } from '../../scripts/agent-loop/contracts.mjs';
import { authorizeTask, readyTasks, validateDiff } from '../../scripts/agent-loop/policy.mjs';
import { initialState, reduce } from '../../scripts/agent-loop/reducer.mjs';

export const sha = '1'.repeat(40);
export const task = { id: 'docs-1', phase: 'approved-phase', requirements: [{id:'R1',text:'Add fixture documentation',source:'https://github.com/example/repo/issues/1'}], acceptance: ['fixture explains the task'], dependencies: [], allowedPaths: ['docs/fixture.md'], requiredChecks: ['test'], maxFiles: 10, maxLines: 300 };
export const manifest = {schemaVersion:1,enabled:true,tasks:[task]};
export const policy = {humans:['owner'],planRounds:2,fixRounds:2,infraRetries:3,taskMs:7200000,reviewMs:1200000,workerMs:1800000,maxUsd:5,maxTokens:10000};
export const plan = {schemaVersion:1,taskId:task.id,runId:'run-1',manifestDigest:digest(manifest),baseSha:sha,revision:0,requirementIds:['R1'],paths:['docs/fixture.md'],steps:['Add fixture documentation'],tests:['test'],acceptance:['fixture explains the task'],risks:[],dispositions:[]};
export const authority = {manifest, evidence:{actor:'owner',type:'User',permission:'admin',state:'APPROVED',manifestDigest:digest(manifest),commitSha:sha,eventUrl:'https://github.com/example/repo/pull/1#pullrequestreview-1'}, prerequisites:Object.fromEntries(['humanApprovalProtection','stateProtection','deploymentGate','renderAutoDeployOff','workerIsolation','providerBudget','publisherApp','reviewIntegration','pinnedRuntime'].map(k=>[k,true]))};
export const observation = (type,data={},id=type) => ({id,type,at:1000,actor:'controller',taskId:task.id,data});
export function start() { return reduce(initialState(digest(manifest)), observation('start',{task,runId:'run-1',baseSha:sha}), policy, authority).state; }
export function planned() { return reduce(start(),observation('plan',{plan}),policy,authority).state; }
export function implementing() { const s=planned();return reduce(s,observation('plan_review',{review:{schemaVersion:1,taskId:task.id,runId:'run-1',subjectDigest:digest(plan),baseSha:sha,headSha:null,verdict:'accept',findings:[]}}),policy,authority).state; }

test('digest canonicalizes keys and rejects undefined',()=>{assert.equal(digest({a:1,b:2}),digest({b:2,a:1}));assert.throws(()=>digest({a:undefined}));});
test('closed contracts reject arbitrary commands',()=>{assert.throws(()=>validate('backlog',{schemaVersion:1,enabled:false,tasks:[],shell:'echo'}));assert.throws(()=>validate('plan',{...plan,baseSha:'master'}));});
test('backlog rejects duplicate IDs and dependency cycles',()=>{assert.throws(()=>validate('backlog',{...manifest,tasks:[task,task]}));assert.throws(()=>validate('backlog',{...manifest,tasks:[{...task,dependencies:[task.id]}]}));});
test('approval binds the manifest to human API evidence',()=>{
 const evidence={actor:'owner',type:'User',permission:'admin',state:'APPROVED',manifestDigest:digest(manifest),commitSha:sha,eventUrl:'https://github.com/example/repo/pull/1#pullrequestreview-1'};
 assert.equal(authorizeTask(manifest,evidence,{policy,baseSha:sha}),true);
 for(const bad of [{actor:'bot'},{type:'Bot'},{permission:'read'},{manifestDigest:'0'.repeat(64)},{commitSha:'2'.repeat(40)},{state:'COMMENTED'}])assert.throws(()=>authorizeTask(manifest,{...evidence,...bad},{policy,baseSha:sha}));
});
test('selection waits for merged complete dependencies',()=>{const m={...manifest,tasks:[task,{...task,id:'docs-2',dependencies:[task.id]}]};assert.deepEqual(readyTasks(m,{tasks:{[task.id]:{status:'ready_for_human'}}}),[]);assert.deepEqual(readyTasks(m,{tasks:{[task.id]:{status:'complete'}}}).map(x=>x.id),['docs-2']);});
test('diff rejects paths, symlinks, binary data, and excessive size',()=>{
 assert.equal(validateDiff(task,[{path:'docs/fixture.md',additions:3,deletions:0,mode:'100644',binary:false}]),true);
 for(const path of ['../docs/fixture.md','/docs/fixture.md','docs\\fixture.md','.github/workflows/a.yml','docs/.env'])assert.throws(()=>validateDiff({...task,allowedPaths:[path]},[{path,additions:1,deletions:0,mode:'100644',binary:false}]));
 assert.throws(()=>validateDiff(task,[{path:'docs/other.md',additions:1,deletions:0,mode:'100644',binary:false}]));
 for(const bad of [{mode:'120000'},{binary:true},{additions:301},{deletions:-1}])assert.throws(()=>validateDiff(task,[{path:'docs/fixture.md',additions:1,deletions:0,mode:'100644',binary:false,...bad}]));
});
test('plan cannot widen approved paths, tests or acceptance',()=>{for(const bad of [{paths:['src/new.ts']},{tests:[]},{requirementIds:['R2']},{acceptance:['new scope']}])assert.throws(()=>reduce(start(),observation('plan',{plan:{...plan,...bad}}),policy,authority));});
test('stale review does not authorize implementation',()=>{assert.throws(()=>reduce(planned(),observation('plan_review',{review:{schemaVersion:1,taskId:task.id,runId:'run-1',subjectDigest:'0'.repeat(64),baseSha:sha,headSha:null,verdict:'accept',findings:[]}}),policy,authority));});
test('review corrections are re-reviewed and bounded',()=>{let s=planned();for(let i=0;i<3;i++){const review={schemaVersion:1,taskId:task.id,runId:'run-1',subjectDigest:s.tasks[task.id].planDigest,baseSha:sha,headSha:null,verdict:'revise',findings:[{id:'F1',severity:'P1',evidence:'missing detail',correction:'explain existing scope',scope:'approved'}]};s=reduce(s,observation('plan_review',{review},`review-${i}`),policy,authority).state;if(i<2)s=reduce(s,observation('plan',{plan:{...plan,revision:i+1,dispositions:[{id:'F1',resolution:'addressed'}]}},`plan-${i}`),policy,authority).state;}assert.equal(s.tasks[task.id].status,'blocked');});
test('duplicate events do not advance state twice',()=>{const s=start();assert.deepEqual(reduce(s,observation('start',{task,runId:'run-1',baseSha:sha}),policy,authority),{state:s,effects:[]});});
test('arbitrary transitions and merge effects are unavailable',()=>{assert.throws(()=>reduce(start(),observation('merge'),policy,authority));assert.throws(()=>reduce(start(),observation('complete'),policy,authority));});
test('infrastructure retries exhaust without resetting counters',()=>{let s=start();for(let i=0;i<4;i++)s=reduce(s,observation('failure',{reason:'worker unavailable'},`f${i}`),policy,authority).state;assert.equal(s.tasks[task.id].status,'blocked');assert.equal(s.tasks[task.id].infraFailures,4);});
test('pause blocks worker output until explicit human resume',()=>{const s=reduce(start(),observation('pause',{},'p'),policy,authority).state;assert.equal(s.paused,true);assert.throws(()=>reduce(s,observation('plan',{plan}),policy,authority));assert.throws(()=>reduce(s,observation('resume',{expectedSequence:0},'r'),policy,authority));});
test('a disabled or different manifest cannot start even with a valid-shaped event',()=>{
 const e=observation('start',{task,runId:'run-1',baseSha:sha});
 assert.throws(()=>reduce(initialState(digest(manifest)),e,policy));
 assert.throws(()=>reduce(initialState(digest(manifest)),e,policy,{...authority,manifest:{...manifest,enabled:false}}));
 assert.throws(()=>reduce(initialState(digest(manifest)),e,policy,{...authority,evidence:{...authority.evidence,actor:'bot'}}));
 assert.throws(()=>reduce(initialState(digest(manifest)),e,policy,{...authority,prerequisites:{}}));
});

