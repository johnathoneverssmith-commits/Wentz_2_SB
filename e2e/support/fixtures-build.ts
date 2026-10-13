import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { baseEnvironment } from "../../.claude/skills/wentz-verify/db-safety.mjs";

import { REPO_ROOT } from "./stack.ts";

const BUILDER = fileURLToPath(new URL("../fixtures/build.ts", import.meta.url));
const UI_DIR = join(REPO_ROOT, "ui-source");
export const FIXTURE_SEED = 4242;

export interface FixtureDoc {
  name: string;
  seed: number;
  stage: string;
  draftSalt: number;
  viewerTeam: string | null;
  clock: "fixed" | "real";
  sizeBytes: number;
  digest: string;
  inputs: Record<string, string>;
  save: string;
}

export interface FixtureSummary {
  seed: number;
  draftSalt: number;
  draftPickOrder: string[];
  written: string[];
  buildMs: number;
}

/**
 * Plays a league through the game's stage machine in a separate process and returns the directory the saves are in.
 * A separate process each time is the point: two builds share nothing, not even the module cache.
 */
export function buildFixtures(options: { seed?: number; realClock?: boolean } = {}): { dir: string; ms: number } {
  const dir = mkdtempSync(join(tmpdir(), "wentz-e2e-fx-"));
  const tsx = createRequire(import.meta.url).resolve("tsx/cli");
  const started = Date.now();
  const r = spawnSync(
    process.execPath,
    [tsx, "--tsconfig", "tsconfig.app.json", BUILDER, "--out", dir, "--seed", String(options.seed ?? FIXTURE_SEED), ...(options.realClock ? ["--real-clock"] : [])],
    { cwd: UI_DIR, env: baseEnvironment(process.env), encoding: "utf8", timeout: 600_000, windowsHide: true },
  );
  if (r.status !== 0) throw new Error(`building the fixtures failed (exit ${r.status}): ${(r.stderr || r.stdout).slice(-1500)}`);
  return { dir, ms: Date.now() - started };
}

export const readFixture = (dir: string, name: string): FixtureDoc => JSON.parse(readFileSync(join(dir, `${name}.json`), "utf8")) as FixtureDoc;
export const readSummary = (dir: string): FixtureSummary => JSON.parse(readFileSync(join(dir, "summary.json"), "utf8")) as FixtureSummary;
