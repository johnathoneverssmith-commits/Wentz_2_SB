/**
 * Once per run: build the UI, serve it from a process this run owns, and play one league per audited franchise through
 * the game's own stage machine (e2e/fixtures/build.ts --team). The primary franchise gets every fixture the screen
 * catalog needs; the others only the stages the palette sweep uses. The teardown stops the server and removes every
 * temporary directory.
 */
import { rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { buildFixtures } from "../../e2e/support/fixtures-build.ts";
import { startUi } from "../../e2e/support/stack.ts";
import { PRIMARY_TEAM, runScope } from "./matrix.ts";
import { fixturesFor, SCREENS, SPEC_FIXTURES } from "./screens.ts";
import { OUT_DIR } from "./paths.ts";

export default async function globalSetup(): Promise<() => Promise<void>> {
  // the browser-free self-check needs neither the UI build nor any league (npm run audit:selfcheck)
  if (process.env.AUDIT_NO_STACK) return async () => undefined;
  const scope = runScope();
  const ui = await startUi();
  const dirs: Record<string, string> = {};
  try {
    for (const team of scope.teams) {
      const only = fixturesFor(team, PRIMARY_TEAM);
      if (scope.screens) {
        // narrowed by screen: only what those screens read, plus what the condition and online specs always need
        const need = new Set(SCREENS.filter((s) => scope.screens!.includes(s.id) && s.fixture).map((s) => s.fixture!));
        if (team === PRIMARY_TEAM) for (const f of SPEC_FIXTURES) need.add(f);
        for (let i = only.length - 1; i >= 0; i--) if (!need.has(only[i]!)) only.splice(i, 1);
        if (team === PRIMARY_TEAM) for (const f of need) if (!only.includes(f)) only.push(f);
      }
      if (only.length === 0) continue;
      const built = await buildFixtures({ team, only, timeoutMs: 900_000 });
      dirs[team] = built.dir;
      console.log(`audit: ${team} fixtures (${only.length}) built in ${built.ms} ms`);
    }
  } catch (e) {
    for (const d of Object.values(dirs)) rmSync(d, { recursive: true, force: true });
    await ui.stop();
    throw e;
  }
  process.env.E2E_UI_ORIGIN = ui.origin;
  process.env.AUDIT_FIXTURE_DIRS = JSON.stringify(dirs);
  mkdirSync(OUT_DIR, { recursive: true });
  const sha = (await import("node:child_process")).execFileSync("git", ["rev-parse", "HEAD"]).toString().trim();
  writeFileSync(join(OUT_DIR, "run.json"), JSON.stringify({ startedAt: new Date().toISOString(), gitHead: sha, masterSha: process.env.AUDIT_MASTER_SHA ?? null, scope, node: process.version, origin: ui.origin }, null, 2));
  console.log(`audit: UI at ${ui.origin}; output ${OUT_DIR}${scope.narrowed ? "  [NARROWED RUN: not the baseline]" : ""}`);
  return async () => {
    await ui.stop();
    for (const d of Object.values(dirs)) rmSync(d, { recursive: true, force: true });
  };
}
