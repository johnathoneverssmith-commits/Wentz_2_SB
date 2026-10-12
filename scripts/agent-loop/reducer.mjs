import { digest, validate } from './contracts.mjs';
import { validatePlan, validateDiff } from './policy.mjs';

export function initialState(manifestDigest) {return {schemaVersion:1,manifestDigest,sequence:0,paused:false,tasks:{},seen:[]};}
// Events enter here only after the controller has verified API identities/results.
// There is no event-provided "verified" bypass and no generic transition command.
export function reduce(previous,event,policy) {
  validate('event',event);
  if(previous.seen.includes(event.id))return {state:previous,effects:[]};
  const state=structuredClone(previous), effects=[];
  const t=state.tasks[event.taskId], d=event.data;
  const fail=reason=>{t.status='blocked';t.reason=reason;effects.push({type:'escalate',taskId:event.taskId,reason});};
  const status=(...allowed)=>{if(!t || !allowed.includes(t.status))throw new Error('Illegal transition');};
  if(state.paused && !['resume','pause','published','failure','cancel'].includes(event.type))throw new Error('Loop paused');
  if(t && event.at-t.startedAt>policy.taskMs && !['pause','resume','cancel'].includes(event.type)) { fail('Task deadline exceeded'); }
  else switch(event.type) {
    case 'pause': state.paused=true;effects.push({type:'cancel_workers'});break;
    case 'resume': if(d.expectedSequence!==previous.sequence)throw new Error('Stale resume');state.paused=false;break;
    case 'cancel': status('planning','plan_review','implementing','ci_pending','code_review','fixing','ready_for_human','blocked');t.status='cancelled';effects.push({type:'cancel_workers'});break;
    case 'start': {
      if(t || Object.values(state.tasks).some(x=>!['complete','cancelled','blocked','ready_for_human'].includes(x.status)))throw new Error('Task already active');
      validate('backlog',{schemaVersion:1,enabled:true,tasks:[{...d.task,dependencies:[]}]});
      if(d.task.dependencies.some(id=>state.tasks[id]?.status!=='complete'))throw new Error('Dependency incomplete');
      if(!/^[a-f0-9]{40}$/.test(d.baseSha)||!/^[-a-zA-Z0-9]+$/.test(d.runId)||d.task.id!==event.taskId)throw new Error('Invalid start');
      state.tasks[event.taskId]={task:d.task,runId:d.runId,baseSha:d.baseSha,status:'planning',startedAt:event.at,revision:0,fixes:0,infraFailures:0,findings:[],plan:null,planDigest:null,headSha:null,pr:null,ci:null,codeReview:null,managedReview:null};
      effects.push({type:'worker',role:'claude-plan',taskId:event.taskId});break;
    }
    case 'plan':
      status('planning');validatePlan(t.task,d.plan,{manifestDigest:state.manifestDigest,baseSha:t.baseSha,runId:t.runId,revision:t.revision,findings:t.findings});
      t.plan=d.plan;t.planDigest=digest(d.plan);t.status='plan_review';effects.push({type:'worker',role:'codex-plan-review',taskId:event.taskId});break;
    case 'plan_review': {
      status('plan_review');const r=validate('review',d.review);
      if(r.taskId!==event.taskId || r.runId!==t.runId || r.subjectDigest!==t.planDigest || r.baseSha!==t.baseSha || r.headSha!==null)throw new Error('Stale plan review');
      if(r.verdict==='escalate'||r.findings.some(f=>f.scope!=='approved')) {fail('Plan review requires human decision');break;}
      t.findings=r.findings;
      if(r.verdict==='revise') {if(t.revision>=policy.planRounds){fail('Plan revision limit');break;}t.revision++;t.status='planning';effects.push({type:'worker',role:'claude-plan',taskId:event.taskId});}
      else {t.status='implementing';effects.push({type:'worker',role:'claude-implement',taskId:event.taskId});}break;
    }
    case 'implementation': {
      status('implementing','fixing');const r=validate('implementation',d.result);
      if(r.taskId!==event.taskId||r.runId!==t.runId||r.planDigest!==t.planDigest||r.baseSha!==t.baseSha||r.headSha===t.headSha)throw new Error('Stale implementation');
      validateDiff(t.task,r.diff);
      if(r.diff.some(f=>!t.plan.paths.includes(f.path)))throw new Error('Unplanned change');
      t.headSha=r.headSha;t.ci=null;t.codeReview=null;t.managedReview=null;t.status='ci_pending';
      effects.push({type:'publish',taskId:event.taskId,headSha:r.headSha});break;
    }
    case 'published': status('ci_pending');if(d.headSha!==t.headSha||!Number.isSafeInteger(d.pr)||d.pr<1)throw new Error('Wrong published PR');t.pr=d.pr;break;
    case 'ci': status('ci_pending');if(d.headSha!==t.headSha)throw new Error('Stale CI');
      if(!t.task.requiredChecks.every(c=>d.checks[c]==='success')){fail('Required CI failed');break;}
      t.ci={headSha:t.headSha,checks:d.checks};t.status='code_review';t.reviewStartedAt=event.at;effects.push({type:'worker',role:'codex-code-review',taskId:event.taskId});break;
    case 'code_review': {
      status('code_review');const r=validate('review',d.review);
      if(r.taskId!==event.taskId||r.runId!==t.runId||r.headSha!==t.headSha||r.baseSha!==t.baseSha||r.subjectDigest!==t.planDigest)throw new Error('Stale code review');t.codeReview=r;break;
    }
    case 'managed_review': status('code_review');if(d.headSha!==t.headSha||typeof d.clean!=='boolean'||!Array.isArray(d.findings))throw new Error('Stale managed review');t.managedReview=d;break;
    case 'review_timeout': status('code_review');if(!t.managedReview&&event.at-t.reviewStartedAt>=policy.reviewMs){state.paused=true;fail('Managed review missing');}break;
    case 'close': status('ci_pending','code_review','fixing','ready_for_human');fail('PR closed without human merge');break;
    case 'human_merge': status('ready_for_human');if(d.headSha!==t.headSha||!policy.humans.includes(d.actor)||! /^[a-f0-9]{40}$/.test(d.mergeSha)||d.acceptanceVerified!==true)throw new Error('Unverified human merge');t.mergeSha=d.mergeSha;t.status='complete';break;
    case 'failure': status('planning','plan_review','implementing','ci_pending','code_review','fixing');t.infraFailures++;if(t.infraFailures>policy.infraRetries)fail('Infrastructure retry limit');else effects.push({type:'retry',taskId:event.taskId,afterMs:Math.min(60000,1000*2**t.infraFailures)});break;
    default: throw new Error('Unsupported event');
  }
  if(t?.status==='code_review' && t.codeReview && t.managedReview) {
    const r=t.codeReview,m=t.managedReview;
    if(r.verdict==='escalate'||r.findings.some(f=>f.scope!=='approved')||m.conflict||((r.verdict==='accept')!==m.clean))fail('Conflicting or scope-changing review');
    else if(r.verdict==='accept'&&m.clean)t.status='ready_for_human';
    else if(t.fixes>=policy.fixRounds)fail('Code fix limit');
    else {t.fixes++;t.findings=[...r.findings,...m.findings];t.status='fixing';effects.push({type:'worker',role:'claude-fix',taskId:event.taskId});}
  }
  state.seen.push(event.id);state.sequence++;
  return {state,effects};
}
