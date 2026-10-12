import { pathToFileURL } from 'node:url';

export function authorizeDeployment({eventName,ref,requestedSha,runSha,currentMasterSha,authorized}) {
  if(eventName!=='workflow_dispatch'||ref!=='refs/heads/master'||authorized!==true||!/^[a-f0-9]{40}$/.test(requestedSha??'')||requestedSha!==runSha||requestedSha!==currentMasterSha)throw new Error('Explicit current-master deployment authorization required');
  return requestedSha;
}
async function main() {
  const repo=process.env.GITHUB_REPOSITORY;
  const headers={Authorization:`Bearer ${process.env.GITHUB_TOKEN}`,Accept:'application/vnd.github+json'};
  const response=await fetch(`https://api.github.com/repos/${repo}/branches/master`,{headers,signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw new Error('Cannot verify current master');
  const master=await response.json();
  authorizeDeployment({eventName:process.env.GITHUB_EVENT_NAME,ref:process.env.GITHUB_REF,requestedSha:process.env.DEPLOY_REQUESTED_SHA,runSha:process.env.GITHUB_SHA,currentMasterSha:master.commit.sha,authorized:process.env.DEPLOY_AUTHORIZED==='true'});
  const environment=await fetch(`https://api.github.com/repos/${repo}/environments/production`,{headers,signal:AbortSignal.timeout(30000)});
  if(!environment.ok)throw new Error('Cannot verify protected production environment');
  const config=await environment.json();
  if(!config.protection_rules?.some(r=>r.type==='required_reviewers'&&r.prevent_self_review===true&&r.reviewers?.length))throw new Error('Protected production human approval is not configured');
  console.log('Explicit SHA and protected production approval verified.');
}
if(import.meta.url===pathToFileURL(process.argv[1]??'').href)main().catch(()=>{console.error('Deployment authorization failed closed.');process.exitCode=1;});
