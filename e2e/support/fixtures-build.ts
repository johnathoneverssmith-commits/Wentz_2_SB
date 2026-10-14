import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { baseEnvironment } from "../../.claude/skills/wentz-verify/db-safety.mjs";
import { runProcess } from "../../.claude/skills/wentz-verify/run-checks.mjs";

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

export interface BuildFixturesOptions {
  seed?: number;
  realClock?: boolean;
  /** Replaces the builder script (tests only: one that fails or hangs). */
  script?: string;
  timeoutMs?: number;
}

/**
 * Plays a league through the game's stage machine in a separate process and returns the directory the saves are in.
 * A separate process each time is the point: two builds share nothing, not even the module cache.
 *
 * The directory is removed if the build fails, times out (the process tree is ended, not just its first process),
 * or cannot start: a caller never receives a path that is not complete, and never has one to clean up after an error.
 */
export async function buildFixtures(options: BuildFixturesOptions = {}): Promise<{ dir: string; ms: number }> {
  const dir = mkdtempSync(join(tmpdir(), "wentz-e2e-fx-"));
  const started = Date.now();
  try {
    const tsx = createRequire(import.meta.url).resolve("tsx/cli");
    const timeoutMs = options.timeoutMs ?? 600_000;
    const r = await runProcess(
      {
        file: process.execPath,
        args: [tsx, "--tsconfig", "tsconfig.app.json", options.script ?? BUILDER, "--out", dir, "--seed", String(options.seed ?? FIXTURE_SEED), ...(options.realClock ? ["--real-clock"] : [])],
        shell: false,
      },
      { cwd: UI_DIR, env: baseEnvironment(process.env), timeoutMs },
    );
    if (r.timedOut) throw new Error(`building the fixtures timed out after ${timeoutMs} ms; its process tree was ended`);
    if (r.error) throw new Error(`building the fixtures could not start: ${r.error}`);
    if (r.status !== 0) throw new Error(`building the fixtures failed (exit ${r.status}): ${(r.stderr || r.stdout).slice(-1500)}`);
    return { dir, ms: Date.now() - started };
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    throw e;
  }
}

export const readFixture = (dir: string, name: string): FixtureDoc => JSON.parse(readFileSync(join(dir, `${name}.json`), "utf8")) as FixtureDoc;
export const readSummary = (dir: string): FixtureSummary => JSON.parse(readFileSync(join(dir, "summary.json"), "utf8")) as FixtureSummary;
