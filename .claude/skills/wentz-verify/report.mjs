#!/usr/bin/env node
/**
 * Judges the recorded results against the plan and prints the report.
 *
 *   node report.mjs --plan plan.json --results results.json [--json]
 *        [--confirm scope,how-it-works-review] [--ci '{"test":"success","deploy":"skipped","event":"pull_request"}']
 *
 * `--confirm` attests manual checks you really did by hand. `--ci` supplies
 * GitHub's result for the required `ci-pr` check, read from the pull request;
 * without it that check stays PENDING CI and the verdict can be at most
 * LOCALLY VERIFIED.
 *
 * Exit codes: 0 verified or locally verified; 1 failed or blocked;
 * 4 incomplete (a required check did not run or was skipped); 2 bad arguments.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { exitCodeFor, renderReport, summarize } from "./verdict.mjs";

export function main(argv = process.argv.slice(2)) {
  const o = { plan: null, results: null, json: false, confirm: [], ci: null };
  try {
    for (let i = 0; i < argv.length; i++) {
      const a = argv[i];
      if (a === "--plan") o.plan = argv[++i];
      else if (a === "--results") o.results = argv[++i];
      else if (a === "--json") o.json = true;
      else if (a === "--confirm") o.confirm = argv[++i].split(",").filter(Boolean);
      else if (a === "--ci") o.ci = JSON.parse(argv[++i]);
      else throw new Error(`unknown argument: ${a}`);
    }
    if (!o.plan || !o.results) throw new Error("--plan and --results are required");
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    return 2;
  }
  const plan = JSON.parse(readFileSync(o.plan, "utf8"));
  const results = JSON.parse(readFileSync(o.results, "utf8")).results ?? [];
  const byId = new Map(results.map((r) => [r.id, r]));
  for (const id of o.confirm) byId.set(id, { id, status: "CONFIRMED" });
  if (o.ci) byId.set("ci-pr", { id: "ci-pr", ci: o.ci });
  const summary = summarize(plan, [...byId.values()]);
  process.stdout.write(`${o.json ? JSON.stringify(summary, null, 2) : renderReport(summary)}\n`);
  return exitCodeFor(summary.verdict);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main();
}
