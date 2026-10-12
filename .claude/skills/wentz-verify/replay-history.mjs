#!/usr/bin/env node
/**
 * Replays past pull requests through the selector: "if this PR were being
 * verified today, what would the plan ask for?" It is how the risk map is
 * checked against changes that really happened.
 *
 *   node replay-history.mjs [--fixtures test/fixtures/verify-replay.json] [--json]
 *   node replay-history.mjs --capture out.json --merge 9a067c1:1:"Title" [--merge ...]
 *
 * A fixture records each PR's changed files (taken once from git history), so
 * the replay is deterministic and works on a shallow clone such as CI's. Each
 * entry: { pr, title, merge, parent, changes: [{ path, status, oldPath?, source }] }.
 * The plan uses TODAY's risk map and test trees, not those of the time.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { readJson } from "./io.mjs";
import { buildTestIndex, loadMap, mergeChanges, parseNameStatus, plan } from "./select-checks.mjs";

export function loadFixtures(path) {
  return readJson(path);
}

/** The plan for one recorded PR. */
export function replay(entry, { map = loadMap(), testIndex }) {
  return plan({
    changes: mergeChanges(entry.changes),
    testIndex,
    map,
    context: { base: `${entry.parent}`, mergeBase: entry.parent },
  });
}

/** The few facts about a plan worth comparing. */
export function brief(p) {
  return {
    risk: p.risk,
    classes: p.classes,
    conservative: p.conservative,
    required: p.required.map((c) => c.id),
    recommended: p.recommended.map((c) => c.id),
    approvals: p.approvalsNeeded,
    needsDatabase: p.needsDatabase,
    concurrencyCiOnly: p.notes.some((n) => /deadlocks|concurrency/i.test(n)) || p.recommended.some((c) => c.id === "ci-repeat-db"),
  };
}

/** Records a PR's changes from git: the merge commit against its first parent. */
export function capture({ merge, pr, title, cwd = process.cwd() }) {
  const git = (...args) => execFileSync("git", ["-c", "core.quotepath=false", ...args], { cwd, encoding: "utf8" });
  const parent = git("rev-parse", `${merge}^1`).trim();
  const full = git("rev-parse", merge).trim();
  const changes = parseNameStatus(git("diff", "--name-status", "-M", parent, full), "committed");
  return { pr: Number(pr), title, merge: full.slice(0, 7), parent: parent.slice(0, 7), changes };
}

function table(rows) {
  const L = [];
  for (const r of rows) {
    L.push(`PR #${r.pr}: ${r.title}`);
    L.push(`  risk ${r.brief.risk}${r.brief.conservative ? " (conservative)" : ""}; classes: ${r.brief.classes.join(", ")}`);
    L.push(`  REQUIRED:    ${r.brief.required.join(", ")}`);
    L.push(`  RECOMMENDED: ${r.brief.recommended.join(", ") || "-"}`);
    if (r.brief.approvals.length > 0) L.push(`  approval:    ${r.brief.approvals.join("; ")}`);
    L.push(`  needs a database: ${r.brief.needsDatabase ? "yes" : "no"}; concurrency flagged as CI-only: ${r.brief.concurrencyCiOnly ? "yes" : "no"}`);
    L.push("");
  }
  return L.join("\n");
}

export function main(argv = process.argv.slice(2)) {
  const o = { fixtures: "test/fixtures/verify-replay.json", json: false, captureOut: null, merges: [] };
  try {
    for (let i = 0; i < argv.length; i++) {
      const a = argv[i];
      if (a === "--fixtures") o.fixtures = argv[++i];
      else if (a === "--json") o.json = true;
      else if (a === "--capture") o.captureOut = argv[++i];
      else if (a === "--merge") {
        const [merge, pr, ...title] = argv[++i].split(":");
        o.merges.push({ merge, pr, title: title.join(":") });
      } else throw new Error(`unknown argument: ${a}`);
    }
    if (o.captureOut && o.merges.length === 0) throw new Error("--capture needs at least one --merge sha:pr:title");
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    return 2;
  }
  if (o.captureOut) {
    writeFileSync(o.captureOut, `${JSON.stringify(o.merges.map((m) => capture(m)), null, 2)}\n`);
    process.stdout.write(`captured ${o.merges.length} PR(s) to ${o.captureOut}\n`);
    return 0;
  }
  const map = loadMap();
  const testIndex = buildTestIndex(process.cwd(), map);
  const rows = loadFixtures(o.fixtures).map((entry) => ({ pr: entry.pr, title: entry.title, brief: brief(replay(entry, { map, testIndex })) }));
  process.stdout.write(o.json ? `${JSON.stringify(rows, null, 2)}\n` : `${table(rows)}\n`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main();
}
