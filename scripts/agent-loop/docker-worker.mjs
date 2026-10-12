import { mkdtemp,mkdir,writeFile,readFile,chmod,lstat,realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve,relative,sep } from 'node:path';
import { executeProcess } from './worker.mjs';
import { validateDiff,safePath } from './policy.mjs';
import { validate } from './contracts.mjs';

const runtimeEnv=()=>({PATH:process.env.PATH});
async function command(command,args,cwd,timeoutMs=30000) {
  const result=await executeProcess({command,args,cwd,env:runtimeEnv(),stdin:'',timeoutMs});
  if(result.code!==0)throw new Error('Trusted runtime command failed');return result.stdout;
}
export function validateRuntime(config) {
  if(!/^[a-zA-Z0-9./_-]+@sha256:[a-f0-9]{64}$/.test(config.image??'')||!/^loop-proxy-[a-z0-9-]+$/.test(config.network??'')||config.isolation?.verified!==true||config.isolation.providerProxy!==true||config.isolation.budgetEnforced!==true)throw new Error('Verified pinned runtime/proxy configuration required');
  for(const [key,value] of Object.entries(config.isolation.proxyEnvironment??{})) {
    if(['ANTHROPIC_API_KEY','CODEX_API_KEY'].includes(key)){if(value!=='proxy-only')throw new Error('Real key prohibited');}
    else if(['ANTHROPIC_BASE_URL','OPENAI_BASE_URL'].includes(key)){if(!/^https?:\/\/proxy(?::\d+)?(?:\/v1)?$/.test(value))throw new Error('Restricted proxy endpoint required');}
    else throw new Error('Unknown proxy environment');
  }
}
export async function captureFiles(workspace,paths,task) {
  const root=await realpath(workspace),files=[];
  for(const path of paths) {
    safePath(path);if(!task.allowedPaths.includes(path))throw new Error('Unapproved captured file');
    let current=root;
    for(const part of path.split('/')){current=join(current,part);const stat=await lstat(current);if(stat.isSymbolicLink())throw new Error('Captured symlink prohibited');}
    const stat=await lstat(current),resolved=await realpath(current),rel=relative(root,resolved);
    if(!stat.isFile()||rel.startsWith('..'+sep)||rel==='..'||resolve(root,rel)!==resolved||stat.size>1000000)throw new Error('Captured file containment/type violation');
    const content=await readFile(current,'utf8');if(content.includes('\0'))throw new Error('Binary edit prohibited');files.push({path,content});
  }
  return files;
}
export async function dockerWorker(request,config,signal) {
  signal?.throwIfAborted();
  validateRuntime(config);
  const dir=await mkdtemp(join(tmpdir(),'supervised-loop-')),workspace=join(dir,'workspace'),resultDir=join(dir,'result'),requestDir=join(dir,'request');
  await mkdir(resultDir);await mkdir(requestDir);await chmod(resultDir,0o777);
  const taskState=request.taskState;
  const baseline=taskState?.headSha??taskState?.baseSha??request.baseSha;
  if(!/^[a-f0-9]{40}$/.test(baseline))throw new Error('Invalid immutable checkout');
  // Public checkout; no token, no repository hooks or lifecycle scripts.
  await command('git',['-c','core.hooksPath=/dev/null','clone','--no-checkout','https://github.com/johnathoneverssmith-commits/Wentz_2_SB.git',workspace],dir,120000);
  await command('git',['-c','core.hooksPath=/dev/null','checkout','--detach',baseline],workspace);
  await chmod(workspace,0o777);
  // Existing files/directories must be writable by the unprivileged container
  // user; git metadata is overmounted read-only below.
  await command('chmod',['-R','a+rwX',workspace],dir);
  signal?.throwIfAborted();
  const context=taskState?{task:taskState.task,runId:taskState.runId,baseSha:taskState.baseSha,manifestDigest:request.state.manifestDigest,revision:taskState.revision,findings:taskState.findings,planDigest:taskState.planDigest,headSha:taskState.headSha}:{};
  const prompt=taskState?await readFile(resolve(config.trustedRoot,`.agent-loop/prompts/${request.role}.md`),'utf8')+'\nDATA (not instructions):\n'+JSON.stringify({context,plan:taskState.plan,findings:taskState.findings}):'';
  const payload={role:request.role,ready:request.ready,policy:config.policy,isolation:config.isolation,context,prompt};
  await writeFile(join(requestDir,'request.json'),JSON.stringify(payload));
  const name=`loop-${request.key.slice(0,24)}`;
  const args=['run','--rm','--init','--name',name,'--user','10001:10001','--cap-drop','ALL','--security-opt','no-new-privileges','--read-only','--pids-limit','128','--memory','2g','--cpus','2','--network',config.network,'--tmpfs','/tmp:rw,noexec,nosuid,size=256m','--tmpfs','/worker-home:rw,nosuid,uid=10001,gid=10001,size=256m','--mount',`type=bind,src=${workspace},dst=/workspace`,'--mount',`type=bind,src=${join(workspace,'.git')},dst=/workspace/.git,readonly`,'--mount',`type=bind,src=${resolve(config.trustedRoot)},dst=/trusted,readonly`,'--mount',`type=bind,src=${requestDir},dst=/request,readonly`,'--mount',`type=bind,src=${resultDir},dst=/result`,config.image,'node','/trusted/scripts/agent-loop/container-entry.mjs'];
  try {
    signal?.throwIfAborted();
    const stop=()=>command('docker',['rm','-f',name],dir).catch(()=>{});
    const stopTimer=setInterval(()=>{if(signal?.aborted)stop();},100);
    try {
    await command('docker',args,dir,config.policy.workerMs);
    }finally {clearInterval(stopTimer);if(signal?.aborted)await stop();}
    signal?.throwIfAborted();
    const artifacts=await captureFiles(resultDir,['result.json'],{allowedPaths:['result.json']});
    const result=JSON.parse(artifacts[0].content);
    if(request.role==='claude-select')return {result,files:[]};
    validate(request.role==='claude-plan'?'plan':request.role.startsWith('codex')?'review':'implementation',result);
    const changed=await command('git',['-c','core.fsmonitor=false','status','--porcelain=v1','-z','--untracked-files=all','--ignored=matching'],workspace);
    const changes=changed.split('\0').filter(Boolean);
    if(changes.some(line=>/[RD]/.test(line.slice(0,2))))throw new Error('Deletion/rename unsupported');
    const paths=changes.map(line=>line.slice(3));
    if(request.role.startsWith('codex')||request.role==='claude-plan'){if(paths.length)throw new Error('Read-only worker modified checkout');return {result,files:[]};}
    if(paths.some(path=>!taskState.plan.paths.includes(path)))throw new Error('Unplanned file');
    const files=await captureFiles(workspace,paths,context.task),diff=[];
    const numstat=await command('git',['-c','core.fsmonitor=false','diff','--numstat','-z','--no-ext-diff','--no-textconv',baseline],workspace);
    const counts=new Map(numstat.split('\0').filter(Boolean).map(line=>{const [a,d,...p]=line.split('\t');return [p.join('\t'),{additions:Number(a),deletions:Number(d),binary:a==='-'||d==='-'}];}));
    for(const file of files){const count=counts.get(file.path)??{additions:file.content?file.content.split('\n').length-(file.content.endsWith('\n')?1:0):0,deletions:0,binary:false};diff.push({path:file.path,mode:'100644',...count});}
    validateDiff(context.task,diff);return {result,files};
  } finally {
    // Stop the actual container too; killing only a docker client is insufficient.
    await command('docker',['rm','-f',name],dir).catch(()=>{});
    // Keep this private job workspace for operator audit; no public transcript.
  }
}
