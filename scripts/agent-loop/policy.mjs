import { digest, validate } from './contracts.mjs';

export function authorizeTask(manifest, evidence, {policy,baseSha}) {
  validate('backlog',manifest);
  if (!manifest.enabled || !policy.humans.includes(evidence.actor) || evidence.type !== 'User' || !['admin','maintain','write'].includes(evidence.permission) || evidence.state !== 'APPROVED' || evidence.manifestDigest !== digest(manifest) || evidence.commitSha !== baseSha || !/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+#pullrequestreview-\d+$/.test(evidence.eventUrl)) throw new Error('Missing verified human manifest approval');
  return true;
}
export function readyTasks(manifest,state) {
  validate('backlog',manifest);
  if (!manifest.enabled || state.paused) return [];
  return manifest.tasks.filter(t => !state.tasks[t.id] && t.dependencies.every(id=>state.tasks[id]?.status==='complete'));
}
export function safePath(path) {
  if (typeof path !== 'string' || !path || path.startsWith('/') || /[\\:\x00-\x1f]/.test(path) || path.split('/').some(s=>!s || s==='.' || s==='..' || s.startsWith('.')) || /^(scripts\/agent-loop|test\/agent-loop|docs\/agent-loop|AGENTS\.md|CLAUDE\.md|package.*\.json|render.*|scripts\/.*deploy|data\/|artifacts\/)/i.test(path) || /(?:^|\/)(?:.*\.local\.|.*\.csv$|.*\.parquet$|.*\.pem$|.*\.key$|.*lock.*|.*config.*)/i.test(path)) throw new Error('Prohibited path');
  return path;
}
export function validateDiff(task,diff) {
  if (!Array.isArray(diff) || !diff.length || diff.length > Math.min(task.maxFiles,10)) throw new Error('Invalid diff size');
  let lines=0;const seen=new Set();
  for (const file of diff) {
    safePath(file.path);
    if (seen.has(file.path) || !task.allowedPaths.includes(file.path) || file.binary || file.mode !== '100644' || (file.previousPath && file.previousPath !== file.path) || !Number.isSafeInteger(file.additions) || !Number.isSafeInteger(file.deletions) || file.additions<0 || file.deletions<0) throw new Error('Diff violates approved scope');
    seen.add(file.path);lines+=file.additions+file.deletions;
  }
  if (lines > Math.min(task.maxLines,300)) throw new Error('Diff line budget exceeded');
  return true;
}
export function validatePlan(task,plan,{manifestDigest,baseSha,runId,revision,findings=[]}) {
  validate('plan',plan);
  if (plan.taskId!==task.id || plan.runId!==runId || plan.manifestDigest!==manifestDigest || plan.baseSha!==baseSha || plan.revision!==revision) throw new Error('Stale plan');
  const same = (a,b) => JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
  if (!same(plan.requirementIds,task.requirements.map(r=>r.id)) || !same(plan.tests,task.requiredChecks) || !same(plan.acceptance,task.acceptance) || !plan.paths.length || plan.paths.some(p=>!task.allowedPaths.includes(safePath(p)))) throw new Error('Plan changes approved scope');
  if (!same(plan.dispositions.map(d=>d.id),findings.map(f=>f.id)) || plan.dispositions.some(d=>d.resolution!=='addressed')) throw new Error('Unresolved corrections');
}
export function enablementProblems(policy,prerequisites) {
  const missing=['humanApprovalProtection','stateProtection','deploymentGate','renderAutoDeployOff','workerIsolation','providerBudget','publisherApp','reviewIntegration','pinnedRuntime'].filter(k=>prerequisites[k]!==true);
  if (!(policy.maxUsd>0))missing.push('approvedDollarBudget');
  if (!(policy.maxTokens>0))missing.push('approvedTokenBudget');
  return missing;
}
