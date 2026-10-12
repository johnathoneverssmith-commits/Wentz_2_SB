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


