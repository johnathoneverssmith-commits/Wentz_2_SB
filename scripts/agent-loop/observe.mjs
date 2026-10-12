import { digest, validate } from './contracts.mjs';
import { authorizeTask } from './policy.mjs';

export async function verifyManifestApproval(client,approval,manifest,baseSha,policy) {
  if(!Number.isSafeInteger(approval?.pr)||!Number.isSafeInteger(approval?.reviewId))throw new Error('Manifest approval reference required');
  const pr=await client.api(`/pulls/${approval.pr}`);
  if(!pr.merged||pr.base.ref!=='master'||pr.head.repo?.full_name!==client.repository)throw new Error('Manifest approval PR must be merged');
  const reviews=await client.api(`/pulls/${approval.pr}/reviews`);
  const review=reviews.find(r=>r.id===approval.reviewId&&r.state==='APPROVED'&&r.user.type==='User');
  if(!review)throw new Error('Human manifest review missing/dismissed');
  const identity=await client.verifyHuman(review.user.login);
  const file=await client.api(`/contents/.agent-loop/approved-backlog.json?ref=${review.commit_id}`);
  if(file.encoding!=='base64')throw new Error('Unsupported manifest content');
  const reviewed=JSON.parse(Buffer.from(file.content,'base64').toString('utf8'));
  if(digest(reviewed)!==digest(manifest))throw new Error('Manifest changed since approval');
  const ancestry=await client.api(`/compare/${review.commit_id}...${baseSha}`);
  if(!['ahead','identical'].includes(ancestry.status))throw new Error('Approval revision not on master');
  // Approval binds to manifest content; ancestry binds its reviewed revision to
  // the current master baseline. A merge commit need not equal review.commit_id.
  const evidence={...identity,state:review.state,manifestDigest:digest(reviewed),commitSha:baseSha,eventUrl:review.html_url};
  authorizeTask(manifest,evidence,{policy,baseSha});return evidence;
}
export async function collectObservations(client,state,{now,policy,broker,managedBot}) {
  const events=[];
  const emit=(type,taskId,data,id)=>events.push({id,type,at:now,actor:'observer',taskId,data});
  for(const item of await broker.results()) {
    const t=state.tasks[item.taskId];
    if(!t||t.runId!==item.runId||state.seen.includes(item.id))continue;
    if(item.error){emit('failure',item.taskId,{reason:'Isolated worker failed'},item.id);continue;}
    const kind=item.role==='claude-plan'?'plan':item.role.startsWith('codex')?'review':'implementation';
    validate(kind,item.result);
    if(kind==='implementation') {
      // Worker claims are not a Git head: publisher constructs an immutable
      // commit from actual captured files and later validates the server diff.
      const prepared=await client.importFiles(t,item.files,item.result);
      emit('implementation',item.taskId,{result:prepared},item.id);
    } else emit(kind==='plan'?'plan':item.role==='codex-plan-review'?'plan_review':'code_review',item.taskId,{[kind]:item.result},item.id);
  }
  for(const [taskId,t] of Object.entries(state.tasks)) {
    if(['planning','plan_review','implementing','fixing'].includes(t.status)&&now-t.startedAt>=policy.taskMs) {
      emit('failure',taskId,{reason:'Task deadline exceeded'},`deadline-${t.runId}`);continue;
    }
    if(!t.pr||!['ci_pending','code_review','ready_for_human'].includes(t.status))continue;
    const pr=await client.api(`/pulls/${t.pr}`);
    if(pr.head.sha!==t.headSha)throw new Error('PR head differs from durable state');
    if(pr.merged) {
      if(pr.base?.ref!=='master'||pr.head.repo?.full_name!==client.repository)throw new Error('Merged PR has wrong base/repository');
      const master=await client.api('/branches/master');
      const ancestry=await client.api(`/compare/${pr.merge_commit_sha}...${master.commit.sha}`);
      if(!['ahead','identical'].includes(ancestry.status))throw new Error('Merge not present on master');
      if(t.status!=='ready_for_human')throw new Error('PR merged before required loop checks');
      await client.verifyHuman(pr.merged_by.login);
      // Explicit human acceptance record is a review on the exact head, not a label.
      const reviews=await client.api(`/pulls/${t.pr}/reviews`);
      const acceptance=reviews.some(r=>r.state==='APPROVED'&&r.commit_id===t.headSha&&policy.humans.includes(r.user.login)&&r.user.type==='User');
      if(!acceptance)throw new Error('Human acceptance review missing');
      emit('human_merge',taskId,{headSha:t.headSha,actor:pr.merged_by.login,mergeSha:pr.merge_commit_sha,acceptanceVerified:true},`merge-${t.pr}-${pr.merge_commit_sha}`);continue;
    }
    if(pr.state==='closed'){emit('close',taskId,{},`closed-${t.pr}`);continue;}
    if(t.status==='ci_pending') {
      const runs=await client.api(`/commits/${t.headSha}/check-runs?per_page=100`);
      const checks={};for(const name of t.task.requiredChecks) {
        const matches=runs.check_runs.filter(c=>c.name===name&&c.app?.slug==='github-actions');
        matches.sort((a,b)=>b.id-a.id);checks[name]=matches[0]?.status==='completed'?matches[0].conclusion:'pending';
      }
      if(Object.values(checks).every(s=>s!=='pending'))emit('ci',taskId,{headSha:t.headSha,checks},`ci-${t.headSha}-${digest(checks)}`);
    }
    if(t.status==='code_review'&&!t.managedReview) {
      let completed=false;
      const comments=await client.api(`/issues/${t.pr}/comments?per_page=100`);
      const summary=comments.find(c=>c.user.login===managedBot&&c.user.type==='Bot'&&c.body.startsWith('<!-- codex-pull-request-review-summary -->')&&c.body.includes('Completed')&&c.body.includes(`\`${t.headSha.slice(0,7)}\``));
      if(summary) {
        const inline=await client.api(`/pulls/${t.pr}/comments?per_page=100`);
        const findings=inline.filter(c=>c.user.login===managedBot&&c.user.type==='Bot'&&c.commit_id===t.headSha).map(c=>({id:`managed-${c.id}`,severity:'P1',evidence:`${c.path}:${c.line??c.original_line??0} ${c.body.slice(0,3000)}`,correction:'Address this finding within the approved requirements',scope:'approved'}));
        // Managed summary completion has no stable typed verdict. Require explicit
        // no-findings reaction from the authenticated bot as well, never alone.
        const reactions=await client.api(`/issues/${t.pr}/reactions?per_page=100`);
        const clean=findings.length===0&&reactions.some(r=>r.user.login===managedBot&&r.user.type==='Bot'&&r.content==='+1'&&Date.parse(r.created_at)>=Date.parse(summary.updated_at));
        if(findings.length||clean){completed=true;emit('managed_review',taskId,{headSha:t.headSha,clean,findings},`managed-${summary.id}-${t.headSha}`);}
      }
      if(!completed&&now-t.reviewStartedAt>=policy.reviewMs)emit('review_timeout',taskId,{},`review-timeout-${t.headSha}`);
    }
  }
  return events;
}
