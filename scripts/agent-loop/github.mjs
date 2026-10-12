import { digest, validate } from './contracts.mjs';
import { replay,append } from './journal.mjs';
import { reduce } from './reducer.mjs';
import { validateDiff } from './policy.mjs';

const SHA=/^[a-f0-9]{40}$/;
export class GitHubClient {
  constructor({repository,token,policy,manifestDigest,request=fetch,broker=null}) {
    if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository))throw new Error('Invalid repository');
    this.repository=repository;this.token=token;this.policy=policy;this.manifestDigest=manifestDigest;this.request=request;this.broker=broker;
  }
  async api(path,method='GET',body) {
    const result=await this.request(`https://api.github.com/repos/${this.repository}${path}`,{method,headers:{Authorization:`Bearer ${this.token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
    if(!result.ok)throw new Error(`GitHub operation failed (${result.status})`);
    return result.json();
  }
  async verifyHuman(actor) {
    if(!this.policy.humans.includes(actor))throw new Error('Unauthorized human');
    const result=await this.api(`/collaborators/${encodeURIComponent(actor)}/permission`);
    if(result.user?.type!=='User'||!['admin','maintain','write'].includes(result.permission))throw new Error('Unauthorized human');
    return {actor,type:'User',permission:result.permission};
  }
  async read({emergency=false}={}) {
    const ref=await this.api('/git/ref/heads/agent-loop-state');const sha=ref.object.sha;
    const file=await this.api(`/contents/loop.json?ref=${sha}`);
    if(file.encoding!=='base64'||file.size>5000000)throw new Error('Invalid state file');
    const document=JSON.parse(Buffer.from(file.content,'base64').toString('utf8'));
    if(Object.keys(document).sort().join(',')!=='journal,lease,outbox,state')throw new Error('Invalid state document');
    validate('state',document.state);
    if(!emergency&&digest(replay(document.journal,this.manifestDigest,this.policy,this.authority))!==digest(document.state))throw new Error('State snapshot disagrees with journal');
    if(emergency) {
      let previous='0'.repeat(64);
      for(const [i,entry] of document.journal.entries()){const {hash,...record}=entry;if(record.sequence!==i+1||record.previousHash!==previous||digest(record)!==hash)throw new Error('Corrupt emergency journal');previous=hash;}
      if(document.state.sequence!==document.journal.length)throw new Error('Emergency journal sequence mismatch');
    }
    if(!Array.isArray(document.outbox)||document.outbox.length>100)throw new Error('Invalid outbox');
    return {sha,document};
  }
  async compareAndSwap(expected,document) {
    if(!SHA.test(expected))throw new Error('Invalid state SHA');
    validate('state',document.state);
    const ref=await this.api('/git/ref/heads/agent-loop-state');
    if(ref.object.sha!==expected)throw new Error('State lease conflict');
    const commit=await this.api(`/git/commits/${expected}`);
    const tree=await this.api('/git/trees','POST',{base_tree:commit.tree.sha,tree:[{path:'loop.json',mode:'100644',type:'blob',content:JSON.stringify(document)}]});
    const next=await this.api('/git/commits','POST',{message:'agent-loop: persist verified transition',tree:tree.sha,parents:[expected]});
    // A sibling commit cannot fast-forward this ref: GitHub rejects a raced write.
    await this.api('/git/refs/heads/agent-loop-state','PATCH',{sha:next.sha,force:false});return next.sha;
  }
  async workerLive(owner) {
    if(!this.broker)throw new Error('Worker broker unavailable; cannot reclaim lease');
    return this.broker.live(owner);
  }
  async importFiles(t,files,claimed) {
    validate('implementation',claimed);
    if(claimed.taskId!==t.task.id||claimed.runId!==t.runId||claimed.baseSha!==t.baseSha||claimed.planDigest!==t.planDigest||!Array.isArray(files)||files.length>10)throw new Error('Invalid captured implementation');
    const parent=t.headSha??t.baseSha, entries=[];
    const tree=await this.api(`/git/trees/${parent}?recursive=1`);
    if(tree.truncated)throw new Error('Truncated baseline');
    for(const file of files) {
      if(Object.keys(file).sort().join(',')!=='content,path'||typeof file.content!=='string'||Buffer.byteLength(file.content)>1000000||!t.plan.paths.includes(file.path)||file.content.includes('\0'))throw new Error('Invalid captured file');
      const oldEntry=tree.tree.find(e=>e.path===file.path);
      if(oldEntry&&oldEntry.mode!=='100644')throw new Error('Unsafe baseline file mode');
      let old='';
      if(oldEntry){const blob=await this.api(`/git/blobs/${oldEntry.sha}`);if(blob.encoding!=='base64')throw new Error('Unsupported baseline blob');old=Buffer.from(blob.content,'base64').toString('utf8');}
      if(old===file.content)continue;
      entries.push({path:file.path,mode:'100644',type:'blob',content:file.content});
    }
    if(!entries.length||new Set(entries.map(f=>f.path)).size!==entries.length)throw new Error('Empty/duplicate captured diff');
    const nextTree=await this.api('/git/trees','POST',{base_tree:tree.sha,tree:entries});
    const commit=await this.api('/git/commits','POST',{message:`agent-loop: ${t.task.id} approved plan`,tree:nextTree.sha,parents:[parent]});
    const comparison=await this.api(`/compare/${parent}...${commit.sha}`);
    if(!Array.isArray(comparison.files)||comparison.files.length!==entries.length)throw new Error('Unexpected prepared diff');
    const diff=comparison.files.map(f=>({path:f.filename,previousPath:f.previous_filename??f.filename,additions:f.additions,deletions:f.deletions,mode:'100644',binary:!f.patch}));
    validateDiff(t.task,diff);
    return {...claimed,headSha:commit.sha,diff};
  }
  async recordEmergencyPause({actor,id,at}) {
    const {sha,document}=await this.read({emergency:true});
    const event={id,type:'pause',at,actor,taskId:'control',data:{}};
    if(document.state.seen.includes(id))return;
    document.state=reduce(document.state,event,this.policy).state;
    document.journal=append(document.journal,event);
    await this.compareAndSwap(sha,document);
  }
  async publish({task,baseSha,headSha,branch,key,stateSha,planDigest}) {
    if(!new RegExp(`^agent-loop/${task.id}/[A-Za-z0-9-]+$`).test(branch))throw new Error('Prohibited publication branch');
    if(!SHA.test(baseSha)||!SHA.test(headSha)||! /^[a-f0-9]{64}$/.test(key))throw new Error('Invalid publication identity');
    if(!SHA.test(stateSha)||! /^[a-f0-9]{64}$/.test(planDigest))throw new Error('Immutable plan audit identity required');
    const body=`Supervised task ${task.id}. Publication ${key}.\n\nApproved phase: ${task.phase}\nPlan digest: ${planDigest}\nPublished head: ${headSha}\n\n[Immutable plan/review audit](https://github.com/${this.repository}/blob/${stateSha}/loop.json)\n[Approved backlog](https://github.com/${this.repository}/blob/${baseSha}/.agent-loop/approved-backlog.json)\n\nAcceptance:\n${task.acceptance.map(c=>'- '+c).join('\n')}\n\nRequired checks: ${task.requiredChecks.join(', ')}\n\nHuman merge required. No deployment authorization.`;
    const comparison=await this.api(`/compare/${baseSha}...${headSha}`);
    if(!Array.isArray(comparison.files)||comparison.files.length>10||comparison.files.length===300||!['ahead','identical'].includes(comparison.status))throw new Error('Invalid actual Git comparison');
    const tree=await this.api(`/git/trees/${headSha}?recursive=1`);
    if(tree.truncated)throw new Error('Truncated tree');
    validateDiff(task,comparison.files.map(f=>({path:f.filename,previousPath:f.previous_filename??f.filename,additions:f.additions,deletions:f.deletions,binary:!f.patch,mode:tree.tree.find(e=>e.path===f.filename)?.mode??'invalid'})));
    const existing=await this.api(`/pulls?state=all&head=${encodeURIComponent(this.repository.split('/')[0]+':'+branch)}&per_page=100`);
    if(existing.length>1)throw new Error('Ambiguous PR publication');
    if(existing[0]) {
      if(existing[0].state==='closed')throw new Error('Task PR closed');
      if(existing[0].head.sha!==headSha)await this.advanceBranch(branch,existing[0].head.sha,headSha);
      if(existing[0].body!==body)await this.api(`/pulls/${existing[0].number}`,'PATCH',{body});
      const marker=`agent-loop-review:${headSha}`;
      const comments=await this.api(`/issues/${existing[0].number}/comments?per_page=100`);
      if(comments.length>=100)throw new Error('Review-request history requires pagination');
      if(!comments.some(c=>c.body?.includes(marker)))await this.api(`/issues/${existing[0].number}/comments`,'POST',{body:`<!-- ${marker} -->\n@codex review`});
      return {pr:existing[0].number,headSha};
    }
    // Read branch before creation; a found mismatched branch is never overwritten.
    let ref;
    try {ref=await this.api(`/git/ref/heads/${branch}`);}catch(error){if(!error.message.includes('(404)'))throw error;}
    if(ref&&ref.object.sha!==headSha)throw new Error('Publication branch conflict');
    if(!ref)await this.api('/git/refs','POST',{ref:`refs/heads/${branch}`,sha:headSha});
    const pr=await this.api('/pulls','POST',{base:'master',head:branch,title:`${task.id}: approved requirement implementation`,body,draft:false});
    return {pr:pr.number,headSha};
  }
  async advanceBranch(branch,expected,headSha) {
    if(!/^agent-loop\/[A-Za-z0-9-]+\/[A-Za-z0-9-]+$/.test(branch)||!SHA.test(headSha))throw new Error('Invalid branch');
    const ref=await this.api(`/git/ref/heads/${branch}`);if(ref.object.sha!==expected)throw new Error('Task branch conflict');
    await this.api(`/git/refs/heads/${branch}`,'PATCH',{sha:headSha,force:false});
  }
  async recoverPublication(effect,state) {
    const t=state.tasks[effect.taskId],branch=`agent-loop/${effect.taskId}/${t.runId}`;
    const prs=await this.api(`/pulls?state=all&head=${encodeURIComponent(this.repository.split('/')[0]+':'+branch)}&per_page=100`);
    if(prs.length!==1||prs[0].head.sha!==effect.headSha)return null;
    return {pr:prs[0].number,headSha:effect.headSha};
  }
  async escalate(effect) {
    const marker=`agent-loop-escalation:${effect.key}`;
    const issues=await this.api('/issues?state=all&per_page=100');
    const existing=issues.find(i=>i.body?.includes(marker));if(existing)return;
    // Deliberately omit untrusted finding bodies and runtime output from public issues.
    await this.api('/issues','POST',{title:`Agent loop blocked: ${effect.taskId}`,body:`${marker}\n\nController stopped this approved task. Inspect the durable state branch and exact evidence privately before resuming. No merge or deployment occurred.`});
  }
  async execute(effect,state,metadata={}) {
    switch(effect.type) {
      case 'publish': {const t=state.tasks[effect.taskId];return this.publish({task:t.task,baseSha:t.baseSha,headSha:t.headSha,branch:`agent-loop/${effect.taskId}/${t.runId}`,key:effect.key,stateSha:metadata.stateSha,planDigest:t.planDigest});}
      case 'escalate': await this.escalate(effect);return {};
      case 'worker': case 'retry': case 'cancel_workers':
        if(!this.broker)throw new Error('Isolated worker broker not configured');
        return this.broker.execute(effect,state);
      default: throw new Error('Unknown effect');
    }
  }
}
