import test from 'node:test';
import assert from 'node:assert/strict';
import { workerArguments, parseWorkerResult, runWorker } from '../../scripts/agent-loop/worker.mjs';
import { sha,task,policy,plan } from './fixtures.mjs';

test('Claude scripted review uses bare mode and no shell tools',()=>{
 const spec=workerArguments('claude-plan',{schemaPath:'/trusted/plan.json',schema:{type:'object'},maxUsd:5});
 assert.equal(spec.command,'claude');assert.ok(spec.args.includes('--bare'));assert.ok(spec.args.includes('--json-schema'));assert.ok(spec.args.includes('Read,Glob,Grep'));assert.ok(spec.args.includes('--tools'));assert.ok(!spec.args.join(' ').includes('Bash'));
});
test('Codex reviewer is independent and read-only',()=>{
 const spec=workerArguments('codex-plan-review',{schemaPath:'/trusted/review.json',schema:{type:'object'},maxUsd:5});
 assert.equal(spec.command,'codex');assert.equal(spec.args[spec.args.indexOf('--sandbox')+1],'read-only');assert.ok(spec.args.includes('--ephemeral'));assert.ok(!spec.args.includes('--resume'));
});
test('worker rejects errors, malformed JSON, and forged plan references',()=>{
 assert.throws(()=>parseWorkerResult('claude-plan','not-json',{task,baseSha:sha,runId:'run-1',manifestDigest:plan.manifestDigest,revision:0}));
 assert.throws(()=>parseWorkerResult('claude-plan',JSON.stringify({is_error:true,structured_output:plan}),{task}));
 assert.throws(()=>parseWorkerResult('claude-plan',JSON.stringify({structured_output:{...plan,baseSha:'2'.repeat(40)}}),{task,baseSha:sha,runId:'run-1',manifestDigest:plan.manifestDigest,revision:0}));
});
test('worker cannot run without externally verified isolation and proxy budgets',async()=>{
 await assert.rejects(runWorker({role:'claude-plan',context:{task},policy,workspace:'.',isolation:{},prompt:'fixture'}),/isolation/);
});
test('worker uses argument arrays and suppresses runtime transcripts',async()=>{
 let captured;
 const result=await runWorker({role:'claude-plan',context:{task,baseSha:sha,runId:'run-1',manifestDigest:plan.manifestDigest,revision:0},policy,workspace:'.',isolation:{verified:true,providerProxy:true,budgetEnforced:true},schemaPath:'/trusted/plan.json',prompt:'untrusted data: $(echo secret)',execute:async spec=>{captured=spec;return {code:0,stdout:JSON.stringify({structured_output:plan}),stderr:'secret canary'};}});
 assert.equal(result.taskId,task.id);assert.equal(captured.shell,false);assert.equal(captured.stdin,'untrusted data: $(echo secret)');assert.equal(captured.env.ANTHROPIC_API_KEY,undefined);assert.equal(result.stderr,undefined);
});
