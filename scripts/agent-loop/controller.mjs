import { digest, validate } from './contracts.mjs';
import { append } from './journal.mjs';
import { reduce } from './reducer.mjs';

// All events are observations assembled by trusted API readers, not webhook bodies.
// Persist intent before side effects; execute uses the stable key for idempotency.
export async function reconcile(context,client) {
  let {sha,document}=await client.read();
  validate('state',document.state);
  if(document.state.manifestDigest!==context.manifestDigest)throw new Error('Manifest changed; human reconciliation required');
  if(document.lease && document.lease.owner!==context.owner) {
    if(document.lease.expiresAt>context.now)throw new Error('Controller lease held');
    if(await client.workerLive(document.lease.owner))throw new Error('Expired lease has live worker');
  }
  document.lease={owner:context.owner,expiresAt:context.now+context.leaseMs};
  sha=await client.compareAndSwap(sha,document);
  for(const event of context.events) {
    const result=reduce(document.state,event,context.policy);
    if(result.state===document.state)continue;
    document.state=result.state;document.journal=append(document.journal,event);
    document.outbox.push(...result.effects.map((effect,i)=>({...effect,key:digest({eventId:event.id,index:i,effect}),attempts:0})));
  }
  if(document.state.paused)document.outbox=document.outbox.filter(e=>['publish','escalate','cancel_workers'].includes(e.type));
  sha=await client.compareAndSwap(sha,document);
  for(const effect of [...document.outbox]) {
    // Re-read before every operation so concurrent pause/lease changes stop work.
    const latest=await client.read();
    if(latest.sha!==sha || latest.document.lease?.owner!==context.owner)throw new Error('State changed before operation');
    if(effect.attempts>context.policy.infraRetries)throw new Error('Outbox retry limit; human intervention required');
    effect.attempts++;
    document.outbox=document.outbox.map(e=>e.key===effect.key?effect:e);
    sha=await client.compareAndSwap(sha,document);
    const result=await client.execute(effect,document.state);
    if(effect.type==='publish') {
      const event={id:`published-${effect.key}`,type:'published',at:context.now,actor:'publisher',taskId:effect.taskId,data:result};
      document.state=reduce(document.state,event,context.policy).state;
      document.journal=append(document.journal,event);
    }
    document.outbox=document.outbox.filter(e=>e.key!==effect.key);
    sha=await client.compareAndSwap(sha,document);
  }
  document.lease=null;
  await client.compareAndSwap(sha,document);
  return document.state;
}
