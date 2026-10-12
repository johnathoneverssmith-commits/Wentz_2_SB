import { validate } from './contracts.mjs';

// Operator-hosted isolated workers. HTTPS auth is between controller and broker;
// model/provider credentials are never part of this transport payload.
export class HttpBroker {
  constructor({url,token,request=fetch}) {
    const parsed=new URL(url);
    if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.search||parsed.hash)throw new Error('Broker must use pinned HTTPS origin');
    this.url=parsed.origin;this.token=token;this.request=request;
  }
  async call(path,body) {
    const response=await this.request(this.url+path,{method:body?'POST':'GET',redirect:'error',headers:{Authorization:`Bearer ${this.token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw new Error(`Worker broker failed (${response.status})`);
    return response.json();
  }
  async live(owner) {const result=await this.call(`/live?owner=${encodeURIComponent(owner)}`);if(typeof result.live!=='boolean')throw new Error('Invalid live-worker evidence');return result.live;}
  async results() {const result=await this.call('/results');if(!Array.isArray(result)||result.length>100)throw new Error('Invalid worker results');return result;}
  async execute(effect,state) {validate('state',state);return this.call('/execute',{key:effect.key,effect,state});}
  async select(ready,state) {return this.call('/select',{ready,state});}
  async pause(key){return this.call('/pause',{key});}
  async resume(key){return this.call('/resume',{key});}
}
