import { spawn } from 'node:child_process';
import { schemas, validate } from './contracts.mjs';
import { validatePlan } from './policy.mjs';

const roles=['claude-plan','claude-implement','claude-fix','codex-plan-review','codex-code-review'];
export function workerArguments(role,{schemaPath,schema,maxUsd}) {
  if(!roles.includes(role))throw new Error('Unknown worker role');
  if(role.startsWith('claude')) {
    const tools=role==='claude-plan'?'Read,Glob,Grep':'Read,Glob,Grep,Edit,Write';
    return {command:'claude',args:['--bare','-p','--output-format','json','--json-schema',JSON.stringify(schema),'--max-budget-usd',String(maxUsd),'--tools',tools,'--allowedTools',tools]};
  }
  return {command:'codex',args:['exec','--ephemeral','--ignore-user-config','--sandbox','read-only','--output-schema',schemaPath,'--json','-']};
}
export function parseWorkerResult(role,text,context) {
  if(text.length>1000000)throw new Error('Worker result exceeds limit');
  let value;
  if(role.startsWith('claude')) {
    const envelope=JSON.parse(text);
    if(envelope.is_error || !envelope.structured_output)throw new Error('Claude did not produce successful structured output');
    value=envelope.structured_output;
  } else {
    const events=text.trim().split('\n').map(line=>JSON.parse(line));
    if(events.some(e=>['error','turn.failed'].includes(e.type)))throw new Error('Codex review failed');
    const last=events.filter(e=>e.type==='item.completed'&&e.item?.type==='agent_message').at(-1);
    if(!last)throw new Error('Codex structured review missing');
    value=JSON.parse(last.item.text);
  }
  const kind=role==='claude-plan'?'plan':role.startsWith('codex')?'review':'implementation';
  validate(kind,value);
  if(value.taskId!==context.task.id || value.runId!==context.runId || value.baseSha!==context.baseSha)throw new Error('Worker result identity mismatch');
  if(kind==='plan')validatePlan(context.task,value,context);
  if(kind==='review'&&(value.subjectDigest!==context.planDigest||value.headSha!==(role==='codex-plan-review'?null:context.headSha)))throw new Error('Worker reviewed stale subject');
  if(kind==='implementation'&&value.planDigest!==context.planDigest)throw new Error('Worker implemented stale plan');
  return value;
}
export async function executeProcess(spec) {
  return new Promise((resolve,reject)=>{
    const child=spawn(spec.command,spec.args,{cwd:spec.cwd,env:spec.env,shell:false,stdio:['pipe','pipe','pipe']});
    let stdout='',size=0,finished=false;
    const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('Worker timeout'));},spec.timeoutMs);
    child.stdout.on('data',chunk=>{size+=chunk.length;if(size>1000000){child.kill('SIGKILL');reject(new Error('Worker output limit'));}else stdout+=chunk;});
    child.stderr.on('data',()=>{}); // Raw transcripts are never persisted or published.
    child.on('error',error=>{clearTimeout(timer);reject(new Error(`Worker startup failed: ${error.code??'unknown'}`));});
    child.on('close',code=>{clearTimeout(timer);if(!finished){finished=true;resolve({code,stdout});}});
    child.stdin.on('error',()=>{});child.stdin.end(spec.stdin);
  });
}
export async function runWorker({role,context,policy,workspace,isolation,schemaPath,prompt,execute=executeProcess}) {
  if(isolation?.verified!==true||isolation.providerProxy!==true||isolation.budgetEnforced!==true)throw new Error('Verified external worker isolation is required');
  if(!(policy.maxUsd>0)||!(policy.maxTokens>0))throw new Error('Approved budgets required');
  const kind=role==='claude-plan'?'plan':role.startsWith('codex')?'review':'implementation';
  const spec=workerArguments(role,{schemaPath,schema:schemas[kind],maxUsd:policy.maxUsd});
  // The runtime must have an isolated home, restricted egress and a scoped proxy.
  // No real provider key, publisher token or inherited host environment enters it.
  const env={PATH:process.env.PATH,HOME:'/worker-home',CODEX_HOME:'/worker-home/codex',...(isolation.proxyEnvironment??{})};
  if(Object.keys(env).some(k=>!['PATH','HOME','CODEX_HOME','ANTHROPIC_BASE_URL','OPENAI_BASE_URL','ANTHROPIC_API_KEY','CODEX_API_KEY'].includes(k)))throw new Error('Forbidden worker environment');
  for(const k of ['ANTHROPIC_API_KEY','CODEX_API_KEY'])if(env[k]&&env[k]!=='proxy-only')throw new Error('Real provider keys must remain outside worker');
  const output=await execute({...spec,cwd:workspace,env,shell:false,stdin:prompt,timeoutMs:Math.min(policy.workerMs,1800000)});
  if(output.code!==0)throw new Error('Worker failed');
  return parseWorkerResult(role,output.stdout,context);
}
