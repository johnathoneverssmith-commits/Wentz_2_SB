import { mkdir,readFile,writeFile,readdir,open,rename } from 'node:fs/promises';
import { join } from 'node:path';
import { digest } from './contracts.mjs';

export class JobStore {
  constructor(directory){this.directory=directory;}
  path(key,suffix){if(!/^[a-f0-9]{64}$/.test(key))throw new Error('Invalid job key');return join(this.directory,key+suffix);}
  async accept(key,request) {
    await mkdir(this.directory,{recursive:true});
    const path=this.path(key,'.request.json');
    try {await writeFile(path,JSON.stringify({digest:digest(request),request}),{flag:'wx',mode:0o600});return true;}
    catch(error){if(error.code!=='EEXIST')throw error;const previous=JSON.parse(await readFile(path,'utf8'));if(previous.digest!==digest(request))throw new Error('Changed job payload');return false;}
  }
  async begin(key){try{const file=await open(this.path(key,'.started'),'wx',0o600);await file.close();}catch(error){if(error.code==='EEXIST')throw new Error('Job already started; reconcile instead of rerunning');throw error;}}
  async finish(key,result){const target=this.path(key,'.result.json'),temp=target+'.tmp';await writeFile(temp,JSON.stringify(result),{mode:0o600});await rename(temp,target);}
  async results(){await mkdir(this.directory,{recursive:true});return Promise.all((await readdir(this.directory)).filter(p=>p.endsWith('.result.json')).map(async p=>JSON.parse(await readFile(join(this.directory,p),'utf8'))));}
  async paused(){try{return JSON.parse(await readFile(join(this.directory,'control.json'),'utf8')).paused===true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
  async setPaused(paused){await mkdir(this.directory,{recursive:true});await writeFile(join(this.directory,'control.json'),JSON.stringify({paused}),{mode:0o600});}
}
export class WorkerGate {
  constructor(){this.paused=false;this.tokens=new Map();}
  reserve(key){if(this.paused)throw new Error('Workers paused');if(!/^[a-f0-9]{64}$/.test(key))throw new Error('Invalid worker key');if(this.tokens.has(key))return this.tokens.get(key);const controller=new AbortController(),token={key,controller,signal:controller.signal,timer:null};this.tokens.set(key,token);return token;}
  assertActive(token){if(this.paused||token.signal.aborted)throw new Error('Worker cancelled/paused');}
  async pause(){this.paused=true;for(const token of this.tokens.values()){clearTimeout(token.timer);token.controller.abort();}}
  resume(){this.paused=false;}
  finish(key){this.tokens.delete(key);}
}
