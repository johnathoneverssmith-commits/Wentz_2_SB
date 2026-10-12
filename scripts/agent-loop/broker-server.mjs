import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { digest,validate } from './contracts.mjs';
import { JobStore,WorkerGate } from './jobs.mjs';
import { dockerWorker,validateRuntime } from './docker-worker.mjs';
import { executeProcess } from './worker.mjs';

// Run only on a dedicated Linux worker host behind TLS, after operator setup.
// No GitHub/publisher token or real provider key belongs on this host.
const config=JSON.parse(await readFile(process.argv[2],'utf8'));validateRuntime(config);
const token=process.env.LOOP_BROKER_TOKEN;
if(!token||token.length<32)throw new Error('Protected broker authentication required');
const store=new JobStore(config.jobDirectory),gate=new WorkerGate();
if(await store.paused())await gate.pause();
function authorized(value){const expected=Buffer.from(`Bearer ${token}`),actual=Buffer.from(value??'');return actual.length===expected.length&&timingSafeEqual(actual,expected);}
async function launch(key,request,token){token.running=true;try{gate.assertActive(token);await store.begin(key);const output=await dockerWorker(request,config,token.signal);gate.assertActive(token);await store.finish(key,{id:key,taskId:request.taskState.task.id,runId:request.taskState.runId,role:request.role,...output});}catch{await store.finish(key,{id:key,taskId:request.taskState.task.id,runId:request.taskState.runId,error:true});}finally{gate.finish(key);}}
async function pauseWorkers(){await store.setPaused(true);await gate.pause();for(const [key,token] of gate.tokens){await executeProcess({command:'docker',args:['rm','-f',`loop-${key.slice(0,24)}`],cwd:config.jobDirectory,env:{PATH:process.env.PATH},stdin:'',timeoutMs:30000});if(token.request?.taskState)await store.finish(key,{id:key,taskId:token.request.taskState.task.id,runId:token.request.taskState.runId,error:true});if(!token.running)gate.finish(key);}}
const server=createServer(async(req,res)=>{
  const send=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
  if(!authorized(req.headers.authorization)){send(401,{error:'Unauthorized'});return;}
  try {
    const url=new URL(req.url,'http://localhost');
    if(req.method==='GET'&&url.pathname==='/live'){send(200,{live:gate.tokens.size>0});return;}
    if(req.method==='GET'&&url.pathname==='/results'){send(200,await store.page(url.searchParams.get('cursor')??''));return;}
    if(req.method!=='POST'||!['/execute','/select','/pause','/resume'].includes(url.pathname)){send(404,{error:'Unsupported route'});return;}
    let body='';for await(const chunk of req){body+=chunk;if(body.length>2000000)throw new Error('Request too large');}const input=JSON.parse(body);
    if(url.pathname==='/pause'){await pauseWorkers();send(200,{paused:true});return;}
    if(url.pathname==='/resume'){await store.setPaused(false);gate.resume();send(200,{paused:false});return;}
    validate('state',input.state);
    if(input.state.manifestDigest!==config.manifestDigest)throw new Error('Unapproved manifest');
    if(url.pathname==='/select') {
      if(!Array.isArray(input.ready)||!input.ready.length||gate.tokens.size||gate.paused)throw new Error('Selection unavailable');
      validate('backlog',{schemaVersion:1,enabled:true,tasks:input.ready.map(t=>({...t,dependencies:[]}))});
      const key=digest(input),request={key,role:'claude-select',ready:input.ready,baseSha:config.selectionBaseSha};
      // Selection is a read-only bounded operation; durable cache prevents repeats.
      const accepted=await store.accept(key,request);
      if(!accepted){const previous=(await store.results()).find(r=>r.id===key);if(!previous?.result)throw new Error('Selection interrupted; human reconciliation required');send(200,previous.result);return;}
      await store.begin(key);const token=gate.reserve(key);
      try{const output=await dockerWorker(request,config,token.signal);gate.assertActive(token);await store.finish(key,{id:key,...output});send(200,output.result);}finally{gate.finish(key);}return;
    }
    const {effect,key,state}=input;
    if(effect.key!==key)throw new Error('Wrong effect key');
    if(effect.type==='cancel_workers') {
      await pauseWorkers();
      send(200,{accepted:true});return;
    }
    const retryRole={planning:'claude-plan',plan_review:'codex-plan-review',implementing:'claude-implement',fixing:'claude-fix',code_review:'codex-code-review'};
    const role=effect.type==='retry'?retryRole[state.tasks[effect.taskId]?.status]:effect.role;
    if(!['worker','retry'].includes(effect.type)||!['claude-plan','claude-implement','claude-fix','codex-plan-review','codex-code-review'].includes(role))throw new Error('Unsupported effect');
    const taskState=state.tasks[effect.taskId];if(!taskState||state.paused)throw new Error('Worker task unavailable');
    const request={key,role,taskState,state};
    if(gate.paused||(gate.tokens.size&&!gate.tokens.has(key)))throw new Error('Worker active/paused');
    if(await store.accept(key,request)){const token=gate.reserve(key);token.request=request;token.timer=setTimeout(()=>launch(key,request,token).catch(()=>{}),effect.type==='retry'?Math.min(effect.afterMs,60000):0);}
    send(200,{accepted:true});
  }catch{send(409,{error:'Worker operation blocked; inspect protected job records'});}
});
server.listen(config.port??8080,'127.0.0.1');
