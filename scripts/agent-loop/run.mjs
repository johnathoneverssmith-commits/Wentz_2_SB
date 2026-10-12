import { readFileSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { digest, validate } from './contracts.mjs';
import { enablementProblems, readyTasks } from './policy.mjs';
import { GitHubClient } from './github.mjs';
import { HttpBroker } from './broker.mjs';
import { reconcile } from './controller.mjs';
import { collectObservations, verifyManifestApproval } from './observe.mjs';
import { emergencyPause } from './control.mjs';

const read=path=>JSON.parse(readFileSync(path,'utf8'));
export async function main(mode='status') {
  const manifest=validate('backlog',read('.agent-loop/approved-backlog.json'));
  const policy=read('.agent-loop/policy.json'),prerequisites=read('.agent-loop/prerequisites.json');
  const problems=enablementProblems(policy,prerequisites);
  const eligible=manifest.enabled&&manifest.tasks.length>0&&problems.length===0;
  if(mode==='status') {
    if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,`eligible=${eligible}\n`);
    console.log(JSON.stringify({enabled:manifest.enabled,approvedTasks:manifest.tasks.length,eligible,missing:problems}));return;
  }
  if(!eligible&&mode!=='pause') {console.log('Loop disabled or enablement prerequisites missing; no mutation performed.');return;}
  if(process.env.GITHUB_REF!=='refs/heads/master'||process.env.GITHUB_REPOSITORY!=='johnathoneverssmith-commits/Wentz_2_SB')throw new Error('Trusted master execution required');
  const integration=read('.agent-loop/integration.json');
  if(!integration.brokerUrl||!process.env.LOOP_APP_TOKEN||!process.env.LOOP_BROKER_TOKEN)throw new Error('Controller setup incomplete');
  const broker=new HttpBroker({url:integration.brokerUrl,token:process.env.LOOP_BROKER_TOKEN});
  const client=new GitHubClient({repository:process.env.GITHUB_REPOSITORY,token:process.env.LOOP_APP_TOKEN,policy,manifestDigest:digest(manifest),broker});
  if(mode==='pause') {
    await emergencyPause(client,broker,{actor:process.env.GITHUB_ACTOR,id:`human-${process.env.GITHUB_RUN_ID}-pause`,at:Date.now()});
    console.log('Authenticated worker stop and durable pause recorded.');return;
  }
  const branch=await client.api('/branches/master'),baseSha=branch.commit.sha;
  // The executing controller revision must equal current master, otherwise a
  // changed workflow/config could invalidate the enablement decision.
  if(baseSha!==process.env.GITHUB_SHA)throw new Error('Controller revision is stale');
  const evidence=await verifyManifestApproval(client,integration.approval,manifest,baseSha,policy);
  const authority={manifest,evidence,prerequisites};client.authority=authority;
  const snapshot=await client.read(),state=snapshot.document.state,now=Date.now();
  const events=[];
  if(['pause','resume'].includes(mode)) {
    const identity=await client.verifyHuman(process.env.GITHUB_ACTOR);
    const sequence=Number(process.env.LOOP_EXPECTED_SEQUENCE);
    if(!Number.isSafeInteger(sequence)||sequence!==state.sequence)throw new Error('Human control must reference current state sequence');
    if(mode==='resume')await broker.resume(digest({sequence,actor:identity.actor,run:process.env.GITHUB_RUN_ID}));
    events.push({id:`human-${process.env.GITHUB_RUN_ID}-${mode}`,type:mode,at:now,actor:identity.actor,taskId:'control',data:mode==='resume'?{expectedSequence:sequence}:{}});
  } else {
    if(!state.paused)events.push(...await collectObservations(client,state,{now,policy,broker,managedBot:integration.managedBot}));
    if(!state.paused&&!events.length&&!Object.values(state.tasks).some(t=>!['ready_for_human','complete','blocked','cancelled'].includes(t.status))) {
      const ready=readyTasks(manifest,state);
      if(ready.length) {
        // Claude chooses from ready approved IDs; never accept a new task ID.
        const selection=await broker.select(ready,state);
        const task=ready.find(t=>t.id===selection.taskId);if(!task)throw new Error('Claude selected outside ready approved backlog');
        const runId=`run-${state.sequence+1}`;
        events.push({id:`start-${task.id}-${runId}`,type:'start',at:now,actor:'selector',taskId:task.id,data:{task,runId,baseSha}});
      }
    }
  }
  await reconcile({events,owner:`controller-${process.env.GITHUB_RUN_ID}`,now,leaseMs:policy.workerMs,policy,manifestDigest:digest(manifest),authority},client);
  console.log('Verified reconciliation persisted.');
}
if(import.meta.url===pathToFileURL(process.argv[1]??'').href)main(process.argv[2]).catch(()=>{console.error('Controller stopped safely; inspect protected evidence.');process.exitCode=1;});
