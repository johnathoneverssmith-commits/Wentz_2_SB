import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JobStore } from '../../scripts/agent-loop/jobs.mjs';
import { digest } from '../../scripts/agent-loop/contracts.mjs';
import { manifest } from './fixtures.mjs';

test('durable job acceptance deduplicates after restart and rejects changed payload',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'loop-jobs-'));
 try {const key=digest(manifest),store=new JobStore(dir);assert.equal(await store.accept(key,{taskId:'docs-1'}),true);assert.equal(await new JobStore(dir).accept(key,{taskId:'docs-1'}),false);await assert.rejects(store.accept(key,{taskId:'different'}));await assert.rejects(store.accept('../escape',{}));} finally {await rm(dir,{recursive:true,force:true});}
});
test('uncertain interrupted job never silently reruns',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'loop-jobs-'));
 try {const key=digest(manifest),store=new JobStore(dir);await store.accept(key,{taskId:'docs-1'});await store.begin(key);await assert.rejects(new JobStore(dir).begin(key),/already/);await store.finish(key,{taskId:'docs-1',runId:'run-1',id:key,error:true});assert.equal((await store.results())[0].error,true);}finally {await rm(dir,{recursive:true,force:true});}
});
