import { digest, validate } from './contracts.mjs';
import { append, replay } from './journal.mjs';
import { reduce } from './reducer.mjs';

export async function reconcile(context,client) {
  let {sha,document}=await client.read();
  validate('state',document.state);
  if(document.state.manifestDigest!==context.manifestDigest)throw new Error('Manifest changed; human reconciliation required');
  if(digest(replay(document.journal,context.manifestDigest,context.policy,context.authority))!==digest(document.state))throw new Error('Journal/snapshot disagreement');
  if(document.lease&&document.lease.owner!==context.owner) {
    if(document.lease.expiresAt>context.now)throw new Error('Controller lease held');
    if(await client.workerLive(document.lease.owner))throw new Error('Expired lease has live worker');
  }
  const persist=async()=>{sha=await client.compareAndSwap(sha,document);};
  const record=event=>{
    const result=reduce(document.state,event,context.policy,context.authority);
    if(result.state===document.state)return;
    document.state=result.state;document.journal=append(document.journal,event);
    document.outbox.push(...result.effects.map((effect,i)=>({...effect,key:digest({eventId:event.id,index:i,effect}),attempts:0})));
  };
  document.lease={owner:context.owner,expiresAt:context.now+context.leaseMs};await persist();
  const acknowledge=(effect,result)=>{if(effect.type==='publish')record({id:`published-${effect.key}`,type:'published',at:context.now,actor:'publisher',taskId:effect.taskId,data:result});document.outbox=document.outbox.filter(e=>e.key!==effect.key);};
  async function drain(onlyPublication=false) {
    for(const effect of [...document.outbox]) {
      if(onlyPublication&&effect.type!=='publish')continue;
      if(['worker','retry','publish'].includes(effect.type)&&['blocked','cancelled','complete'].includes(document.state.tasks[effect.taskId]?.status)){document.outbox=document.outbox.filter(e=>e.key!==effect.key);await persist();continue;}
      if(document.state.paused&&!['escalate','cancel_workers'].includes(effect.type)) {
        if(effect.type==='publish'&&effect.attempts>0&&client.recoverPublication){const result=await client.recoverPublication(effect,document.state);if(result){acknowledge(effect,result);await persist();}}
        continue;
      }
      const latest=await client.read();if(latest.sha!==sha||latest.document.lease?.owner!==context.owner)throw new Error('State changed before operation');
      if(effect.attempts>context.policy.infraRetries) {
        record({id:`exhausted-${effect.key}`,type:'outbox_exhausted',at:context.now,actor:'controller',taskId:effect.taskId??'control',data:{reason:'Outbox retry limit'}});
        document.outbox=document.outbox.filter(e=>e.key!==effect.key);await persist();continue;
      }
      effect.attempts++;document.outbox=document.outbox.map(e=>e.key===effect.key?effect:e);await persist();
      const result=await client.execute(effect,document.state,{stateSha:sha});
      acknowledge(effect,result);await persist();
    }
  }
  try {
    // Incoming pause has priority over new publication. Recover already-pending
    // publication before processing CI observations of that visible PR.
    if(!context.events.some(e=>['pause','failure','outbox_exhausted'].includes(e.type)))await drain(true);
    for(const event of context.events)record(event);
    await persist();await drain();await drain();
  } finally {
    document.lease=null;await persist();
  }
  return document.state;
}
