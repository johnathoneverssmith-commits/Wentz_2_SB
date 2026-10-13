#!/usr/bin/env node
/**
 * Judges the recorded results against the plan and prints the report.
 *
 *   node report.mjs --plan plan.json --results results.json [--json] [--cwd <repo>]
 *        [--confirm scope,how-it-works-review] [--check-ci [--repo owner/name]]
 *
 * Results count only while they still describe the plan and the files as they are
 * now; otherwise the check shows as stale and NOT RUN. Earlier failed attempts are
 * listed even after a rerun passed.
 *
 *   --confirm   attests MANUAL checks you really did by hand (reading the diff,
 *               looking at the UI). It cannot confirm a command check, which only
 *               the runner can record, and the report marks it as attested.
 *   --check-ci  asks GitHub (read-only) for the CI run of the commit checked out
 *               here and validates it (ci-evidence.mjs). This is the only route to
 *               VERIFIED. It needs the commit pushed, a pull request open, and a
 *               clean working tree.
 *   --ci '{..}' records a claim about CI that you read somewhere else. It is shown
 *               and NOT believed: it can fail the verdict if it says CI failed, but
 *               it can never make it VERIFIED.
 *
 * Exit codes: 0 verified or locally verified; 1 failed or blocked;
 * 4 incomplete (a required check did not run, was skipped, or is stale); 2 bad arguments.
 */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { fetchCiEvidence, parseRemote } from "./ci-evidence.mjs";
import { fingerprint, normalizeHistory } from "./evidence.mjs";
import { readJson } from "./io.mjs";
import { exitCodeFor, renderReport, summarize } from "./verdict.mjs";

function remoteOf(cwd, override) {
  if (override) {
    const [owner, repo] = override.split("/");
    return owner && repo ? { owner, repo } : null;
  }
  try {
    return parseRemote(execFileSync("git", ["remote", "get-url", "origin"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
  } catch {
    return null;
  }
}

export async function main(argv = process.argv.slice(2), { fetchImpl } = {}) {
  const o = { plan: null, results: null, json: false, confirm: [], ci: null, checkCi: false, repo: null, cwd: process.cwd() };
  try {
    for (let i = 0; i < argv.length; i++) {
      const a = argv[i];
      if (a === "--plan") o.plan = argv[++i];
      else if (a === "--results") o.results = argv[++i];
      else if (a === "--json") o.json = true;
      else if (a === "--confirm") o.confirm = argv[++i].split(",").filter(Boolean);
      else if (a === "--ci") o.ci = JSON.parse(argv[++i]);
      else if (a === "--check-ci") o.checkCi = true;
      else if (a === "--repo") o.repo = argv[++i];
      else if (a === "--cwd") o.cwd = resolve(argv[++i]);
      else throw new Error(`unknown argument: ${a}`);
    }
    if (!o.plan || !o.results) throw new Error("--plan and --results are required");
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    return 2;
  }
  const plan = readJson(o.plan);
  const history = normalizeHistory(readJson(o.results));
  const manual = new Set([...plan.required, ...plan.recommended].filter((c) => c.kind === "manual").map((c) => c.id));
  const notManual = o.confirm.filter((id) => !manual.has(id));
  if (notManual.length > 0) {
    process.stderr.write(`--confirm only attests manual checks; ${notManual.join(", ")} ${notManual.length === 1 ? "is" : "are"} not one (a command check can only be recorded by run-checks.mjs).\n`);
    return 2;
  }
  const state = fingerprint(o.cwd);
  const attested = o.confirm.map((id) => ({ id, status: "CONFIRMED", evidence: "attested" }));

  let ciEvidence;
  if (o.checkCi) {
    const remote = remoteOf(o.cwd, o.repo);
    ciEvidence = state.error
      ? { validated: false, reason: state.error }
      : await fetchCiEvidence({ owner: remote?.owner, repo: remote?.repo, headSha: state.head, dirty: state.dirty, ...(fetchImpl ? { fetchImpl } : {}) });
  }
  const summary = summarize(plan, [...history.runs, ...attested], { state, ciEvidence, attestedCi: o.ci ?? undefined });
  process.stdout.write(`${o.json ? JSON.stringify(summary, null, 2) : renderReport(summary)}\n`);
  return exitCodeFor(summary.verdict);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await main();
}
