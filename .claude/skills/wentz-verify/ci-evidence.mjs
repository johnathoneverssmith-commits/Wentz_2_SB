/**
 * Reads GitHub's own record of the CI run for the commit being verified, and
 * decides whether it can be trusted. This is the only way a result can become
 * VERIFIED: a person typing `{"test":"success"}` cannot.
 *
 * It is read-only: two GET requests to api.github.com for the repository's own
 * Actions runs and jobs. It sends no data, needs no token for a public
 * repository (a GITHUB_TOKEN in the environment is used if present, which a
 * private one needs), and writes nothing.
 *
 * Trusted means all of these hold at once:
 *   - the run belongs to the workflow file .github/workflows/deploy-render.yml;
 *   - its event is `pull_request` (a push or a manual run is not the PR check);
 *   - it ran for exactly the commit checked out here, and that commit has no
 *     uncommitted or untracked changes on top of it;
 *   - the run completed with conclusion `success`;
 *   - its `test` job concluded `success` and its `deploy` job was `skipped`.
 */
const API = "https://api.github.com";
export const WORKFLOW_PATH = ".github/workflows/deploy-render.yml";
export const WORKFLOW_NAME = "Test and deploy Render";

/** `https://github.com/o/r.git` or `git@github.com:o/r.git` -> { owner, repo }, else null. */
export function parseRemote(url) {
  const m = /^(?:https:\/\/(?:[^@/]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(String(url).trim());
  return m ? { owner: m[1], repo: m[2] } : null;
}

/**
 * Judges the two API answers. Pure.
 * @param {object} args
 * @param {string} args.headSha   the commit checked out here (full 40 characters)
 * @param {boolean} args.dirty    whether the working tree differs from that commit
 * @param {object} args.runs      body of GET /actions/runs?head_sha=...
 * @param {(runId: number) => object | undefined} args.jobsFor  body of GET /actions/runs/{id}/jobs
 */
export function validateCiEvidence({ headSha, dirty, runs, jobsFor }) {
  const no = (reason, extra = {}) => ({ validated: false, reason, ...extra });
  if (!/^[0-9a-f]{40}$/.test(headSha ?? "")) return no("the local commit is not known");
  if (dirty) return no("the working tree has uncommitted or untracked changes, so CI on the pushed commit does not describe it: commit or stash them");
  const list = Array.isArray(runs?.workflow_runs) ? runs.workflow_runs : [];
  const mine = list
    .filter((r) => r.head_sha === headSha && r.event === "pull_request" && typeof r.path === "string" && r.path.split("@")[0] === WORKFLOW_PATH)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || b.run_number - a.run_number);
  if (mine.length === 0) return no(`GitHub has no pull_request run of ${WORKFLOW_NAME} for commit ${headSha.slice(0, 7)}: push it and open a pull request`);
  const run = mine[0];
  if (run.status !== "completed") return no(`the latest run for ${headSha.slice(0, 7)} is ${run.status}, not completed`, { runUrl: run.html_url });
  if (run.conclusion !== "success") return no(`the latest run for ${headSha.slice(0, 7)} concluded ${run.conclusion}`, { failed: true, runUrl: run.html_url, runId: run.id });
  const jobs = jobsFor(run.id)?.jobs;
  if (!Array.isArray(jobs)) return no("GitHub did not report this run's jobs");
  const job = (name) => jobs.find((j) => j.name === name);
  const test = job("test");
  const deploy = job("deploy");
  if (!test) return no("the run has no `test` job");
  if (test.conclusion !== "success") return no(`the \`test\` job concluded ${test.conclusion}`, { failed: true, runUrl: run.html_url, runId: run.id });
  if (!deploy) return no("the run has no `deploy` job to show it was skipped");
  if (deploy.conclusion !== "skipped") return no(`a pull request must not deploy, but the \`deploy\` job concluded ${deploy.conclusion}`, { failed: true, runUrl: run.html_url, runId: run.id });
  return {
    validated: true,
    source: "github-api",
    event: run.event,
    headSha,
    runId: run.id,
    runUrl: run.html_url,
    test: test.conclusion,
    deploy: deploy.conclusion,
    workflow: run.name ?? WORKFLOW_NAME,
  };
}

/**
 * Asks GitHub and validates the answer. `fetchImpl` is replaced in tests.
 * Never throws: a network problem is reported as "not validated".
 */
export async function fetchCiEvidence({ owner, repo, headSha, dirty, fetchImpl = globalThis.fetch, token = process.env.GITHUB_TOKEN, now = () => new Date() }) {
  if (!owner || !repo) return { validated: false, reason: "the GitHub repository could not be worked out from the `origin` remote" };
  if (dirty) return validateCiEvidence({ headSha, dirty, runs: {}, jobsFor: () => undefined });
  const headers = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "wentz-verify", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const get = async (path) => {
    const url = `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${path}`;
    const res = await fetchImpl(url, { headers, method: "GET" });
    if (!res.ok) throw new Error(`GitHub answered ${res.status} for ${path.split("?")[0]}${res.status === 404 ? " (a private repository needs GITHUB_TOKEN)" : ""}`);
    return res.json();
  };
  try {
    const runs = await get(`/actions/runs?head_sha=${headSha}&event=pull_request&per_page=30`);
    const candidates = (runs.workflow_runs ?? []).filter((r) => r.head_sha === headSha && r.event === "pull_request");
    const jobs = new Map();
    for (const r of candidates) jobs.set(r.id, await get(`/actions/runs/${r.id}/jobs?per_page=100`));
    const result = validateCiEvidence({ headSha, dirty, runs, jobsFor: (id) => jobs.get(id) });
    return { ...result, retrievedAt: now().toISOString() };
  } catch (e) {
    return { validated: false, reason: `could not read GitHub: ${e.message}` };
  }
}
