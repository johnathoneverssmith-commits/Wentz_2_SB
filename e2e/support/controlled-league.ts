import type {Page} from '@playwright/test';
/** Controlled UI transport only. No HTTP server, database, or real remote endpoint is contacted. */
export async function controlledLeague(page:Page,origin:string,initial:any,you:{teamCode:string;gmId:string},onAction?:(path:string,payload:any)=>Promise<{status:number;body:unknown}>) {
 let state=initial;const requests:{path:string;payload:any}[]=[];let loads=0;const unexpected:string[]=[];
 const headers={'access-control-allow-origin':origin,'access-control-allow-credentials':'true','access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'content-type'};
 await page.route('http://127.0.0.1:9/**',async route=>{
  const request=route.request();const path=new URL(request.url()).pathname;
  if(request.method()==='OPTIONS'){await route.fulfill({status:204,headers});return;}
  if(path.includes('/actions/')){
   const payload=request.postDataJSON();requests.push({path,payload});
   const result=onAction?await onAction(path,payload):{status:403,body:{error:'Controlled test refusal'}};
   await route.fulfill({status:result.status,headers,json:result.body});return;
  }
  if(path.endsWith('/stream')){await route.fulfill({status:200,headers:{...headers,'content-type':'text/event-stream'},body:': controlled UI stream\n\n'});return;}
  if(path.endsWith('/feed')){await route.fulfill({headers,json:{events:[]}});return;}
  // Read-only automatic preview is intentionally unavailable in this UI-only transport.
  // Tests of engine evidence use their own seeded-engine responder, never fabricated odds here.
  if(path.endsWith('/plan-preview')){await route.fulfill({headers,status:503,json:{error:'No engine in the controlled UI transport.'}});return;}
  if(path==='/leagues/ui4-controlled'){
   loads++;await route.fulfill({headers,json:{league:{id:'ui4-controlled',name:'Controlled UI league'},state,version:'ui4-version',you,isCommissioner:false,inviteCode:null,msLeft:null,waitingOn:[],canClaimCommissioner:false}});return;
  }
  unexpected.push(path);await route.fulfill({headers,status:404,json:{error:'Unexpected controlled endpoint: '+path}});
 });
 await page.evaluate(()=>{const solo=localStorage.getItem('nfl-sim-ui.league');if(solo)localStorage.setItem('nfl-sim-ui.online-league',solo);localStorage.setItem('fs.online.leagueId','ui4-controlled');});
 return {requests,unexpected,setViewer(next:{teamCode:string;gmId:string}){you=next;},get loads(){return loads;},setState(next:any){state=next;}};
}
