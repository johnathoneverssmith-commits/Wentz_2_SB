import { createHash } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { buildFixtures, FIXTURE_SEED, readFixture, readSummary } from "../support/fixtures-build.ts";
import { REPO_ROOT } from "../support/stack.ts";

/**
 * About the saves the browser tests start from. No browser here: these are the checks that the starting states are
 * deterministic, pinned to their inputs, built by genuine play, and small enough for a browser to hold.
 */
const NAMES = ["fantasy-draft", "coaching-draft", "preseason"] as const;
const STAGES: Record<(typeof NAMES)[number], string> = { "fantasy-draft": "fantasyDraft", "coaching-draft": "coachingDraft", preseason: "preseason" };
const PINNED = JSON.parse(readFileSync(new URL("../fixtures/inputs.json", import.meta.url), "utf8")) as Record<string, string>;
const sha = (text: string): string => createHash("sha256").update(text).digest("hex");

test.describe("fixture saves", () => {
  test("the data the generator reads is exactly the data that is pinned", () => {
    const now = Object.fromEntries(Object.keys(PINNED).map((f) => [f, sha(readFileSync(join(REPO_ROOT, f), "utf8").replace(/\r\n/g, "\n"))]));
    // a changed pool or schedule changes every league built from it: repin inputs.json on purpose, in the same commit
    expect(now).toEqual(PINNED);
    for (const name of NAMES) expect(readFixture(process.env.E2E_FIXTURE_DIR!, name).inputs, name).toEqual(PINNED);
  });

  test("they come from playing the game's own stage machine, in order, with explicit controls", () => {
    const dir = process.env.E2E_FIXTURE_DIR!;
    for (const name of NAMES) {
      const f = readFixture(dir, name);
      expect(f.stage, name).toBe(STAGES[name]);
      expect(f.seed, name).toBe(FIXTURE_SEED);
      expect(f.seed, "seed 1 draws a random draft salt").not.toBe(1);
      expect(f.draftSalt, name).toBe(FIXTURE_SEED * 31);
      expect(f.clock).toBe("fixed");
      const doc = JSON.parse(f.save) as { version: number; state: { stage: string; seed: number; draftSalt: number } };
      expect(doc.state.stage, name).toBe(STAGES[name]);
      expect(doc.state.seed).toBe(FIXTURE_SEED);
      expect(doc.state.draftSalt).toBe(FIXTURE_SEED * 31);
    }
    // later stages hold more of the league's history: the draft's 1,000-plus picks and a coaching draft were really played
    const sizes = NAMES.map((n) => readFixture(dir, n).sizeBytes);
    expect(new Set(sizes).size).toBe(3);
    const preseason = JSON.parse(readFixture(dir, "preseason").save) as { state: { draft: { results: unknown[] } | null; coachingDraft: unknown } };
    expect(preseason.state.coachingDraft, "the coaching draft was played").toBeTruthy();
  });

  test("two independently generated games from the same inputs are byte-identical", async () => {
    test.setTimeout(240_000);
    const a = buildFixtures();
    const b = buildFixtures();
    try {
      for (const name of NAMES) {
        const fa = readFixture(a.dir, name);
        const fb = readFixture(b.dir, name);
        expect(fb.digest, `${name}: digest`).toBe(fa.digest);
        expect(fb.save === fa.save, `${name}: the saves are the same string`).toBe(true);
        expect(fb.sizeBytes).toBe(fa.sizeBytes);
      }
      expect(readSummary(b.dir).draftPickOrder).toEqual(readSummary(a.dir).draftPickOrder);
      test.info().annotations.push({ type: "build-ms", description: `two independent builds: ${a.ms} ms and ${b.ms} ms` });
    } finally {
      rmSync(a.dir, { recursive: true, force: true });
      rmSync(b.dir, { recursive: true, force: true });
    }
  });

  test("the seed is what makes a league: another seed gives a different one", async () => {
    test.setTimeout(240_000);
    const other = buildFixtures({ seed: FIXTURE_SEED + 1 });
    try {
      for (const name of NAMES) expect(readFixture(other.dir, name).digest, name).not.toBe(readFixture(process.env.E2E_FIXTURE_DIR!, name).digest);
      expect(readSummary(other.dir).draftPickOrder).not.toEqual(readSummary(process.env.E2E_FIXTURE_DIR!).draftPickOrder);
    } finally {
      rmSync(other.dir, { recursive: true, force: true });
    }
  });

  test("what the clock changes, measured rather than assumed", async () => {
    test.setTimeout(240_000);
    const real = buildFixtures({ realClock: true });
    try {
      const fixed = process.env.E2E_FIXTURE_DIR!;
      const same = NAMES.map((n) => readFixture(real.dir, n).digest === readFixture(fixed, n).digest);
      // the real clock still builds legal, complete leagues of the same stages and the same draft; whether the
      // bytes differ is the finding, recorded for the report (some ids and deadlines are derived from Date.now)
      for (const name of NAMES) expect(readFixture(real.dir, name).stage).toBe(STAGES[name]);
      expect(readSummary(real.dir).draftPickOrder).toEqual(readSummary(fixed).draftPickOrder);
      test.info().annotations.push({ type: "clock-sensitivity", description: same.every(Boolean) ? "saves identical with the real clock" : `saves differ with the real clock: ${NAMES.filter((_, i) => !same[i]).join(", ")}` });
    } finally {
      rmSync(real.dir, { recursive: true, force: true });
    }
  });

  test("every save fits comfortably in a browser's storage", () => {
    const LIMIT = 4 * 1024 * 1024; // a browser gives a site about 5 MB for localStorage, shared with everything else
    const notes: string[] = [];
    for (const name of NAMES) {
      const f = readFixture(process.env.E2E_FIXTURE_DIR!, name);
      expect(f.sizeBytes, name).toBeLessThan(LIMIT);
      expect(Buffer.byteLength(f.save, "utf8")).toBe(f.sizeBytes);
      notes.push(`${name} ${(f.sizeBytes / 1024).toFixed(0)} KiB`);
    }
    test.info().annotations.push({ type: "save-sizes", description: notes.join("; ") });
  });
});
