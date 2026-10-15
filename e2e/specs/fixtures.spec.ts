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
// the first three are reached early and rebuilt cheaply (`only`); the other two need a whole year played, and are built in full once
const EARLY = ["fantasy-draft", "coaching-draft", "preseason"] as const;
const NAMES = [...EARLY, "season-week-1", "season-week-9", "season-week-17", "midseason-fa", "offseason-fa-skip-carried"] as const;
const STAGES: Record<(typeof NAMES)[number], string> = {
  "fantasy-draft": "fantasyDraft",
  "coaching-draft": "coachingDraft",
  preseason: "preseason",
  "season-week-1": "regularSeason",
  "season-week-9": "regularSeason",
  "season-week-17": "regularSeason",
  "midseason-fa": "midseasonFreeAgency",
  "offseason-fa-skip-carried": "offseasonDraftSummary",
};
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
    expect(new Set(sizes).size).toBe(NAMES.length);
    const preseason = JSON.parse(readFixture(dir, "preseason").save) as { state: { draft: { results: unknown[] } | null; coachingDraft: unknown } };
    expect(preseason.state.coachingDraft, "the coaching draft was played").toBeTruthy();
  });

  test("the regular-season saves are three moments of one season, each with exactly the games already played", () => {
    const dir = process.env.E2E_FIXTURE_DIR!;
    type Doc = { state: { stage: string; week: number; schedule: Array<{ week: number; phase: string }>; games: Array<{ phase: string; week: number; played: boolean }>; bracket: unknown } };
    const at = (name: string) => JSON.parse(readFixture(dir, name).save) as Doc;
    for (const [name, week] of [["season-week-1", 1], ["season-week-9", 9], ["season-week-17", 17]] as const) {
      const f = readFixture(dir, name);
      const d = at(name);
      expect(f.week, name).toBe(week);
      expect(d.state, name).toMatchObject({ stage: "regularSeason", week });
      const reg = d.state.games.filter((g) => g.phase === "REG");
      // every scheduled game of the weeks before this one, and none of this week or after
      const scheduledBefore = d.state.schedule.filter((g) => g.phase === "REG" && g.week < week).length;
      expect(reg, name).toHaveLength(scheduledBefore);
      expect(reg.every((g) => g.played && g.week < week), name).toBe(true);
      expect(d.state.bracket, `${name}: no bracket yet`).toBeNull();
    }
    expect(at("season-week-1").state.games.filter((g) => g.phase === "REG")).toHaveLength(0);
  });

  test("the free-agency saves are the two moments the skip regression needs, from one playthrough", () => {
    const dir = process.env.E2E_FIXTURE_DIR!;
    type Doc = { state: { stage: string; season: number; week: number; freeAgencyEvent: { complete: boolean; round: number } | null; gms: Array<{ id: string; skips?: { freeAgency?: boolean } }>; viewerGmId: string } };
    const mid = readFixture(dir, "midseason-fa");
    const midDoc = JSON.parse(mid.save) as Doc;
    const late = readFixture(dir, "offseason-fa-skip-carried");
    const lateDoc = JSON.parse(late.save) as Doc;
    const choice = (d: Doc) => d.state.gms.find((g) => g.id === d.state.viewerGmId)?.skips?.freeAgency ?? false;

    // the first: the mid-season market has just opened, round one, and nothing has been chosen
    expect(midDoc.state.freeAgencyEvent).toMatchObject({ complete: false, round: 1 });
    expect(choice(midDoc)).toBe(false);
    expect(mid.skipFreeAgency).toBe(false);

    // the second: the same league, after that market was skipped and the season and the offseason were played on to the
    // door of the next market: the earlier market is the one still held, and the choice made in it is still set
    expect(lateDoc.state.season).toBe(midDoc.state.season); // the offseason after the season's playoffs, still before its rollover
    expect(lateDoc.state.freeAgencyEvent).toMatchObject({ complete: true, round: 5 });
    expect(choice(lateDoc)).toBe(true);
    expect(late.skipFreeAgency).toBe(true);
    expect(late.viewerTeam).toBe(mid.viewerTeam);
    expect(late.sizeBytes).toBeGreaterThan(mid.sizeBytes); // a season of results and a rookie draft later
  });

  test("two independently generated games from the same inputs are byte-identical", async () => {
    test.setTimeout(600_000); // two full builds: each plays a whole year
    const a = await buildFixtures();
    const b = await buildFixtures();
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
    const other = await buildFixtures({ seed: FIXTURE_SEED + 1, only: EARLY });
    try {
      for (const name of EARLY) expect(readFixture(other.dir, name).digest, name).not.toBe(readFixture(process.env.E2E_FIXTURE_DIR!, name).digest);
      expect(readSummary(other.dir).draftPickOrder).not.toEqual(readSummary(process.env.E2E_FIXTURE_DIR!).draftPickOrder);
    } finally {
      rmSync(other.dir, { recursive: true, force: true });
    }
  });

  test("what the clock changes, measured rather than assumed", async () => {
    test.setTimeout(240_000);
    const real = await buildFixtures({ realClock: true, only: EARLY });
    try {
      const fixed = process.env.E2E_FIXTURE_DIR!;
      const same = EARLY.map((n) => readFixture(real.dir, n).digest === readFixture(fixed, n).digest);
      // the real clock still builds legal, complete leagues of the same stages and the same draft; whether the
      // bytes differ is the finding, recorded for the report (some ids and deadlines are derived from Date.now)
      for (const name of EARLY) expect(readFixture(real.dir, name).stage).toBe(STAGES[name]);
      expect(readSummary(real.dir).draftPickOrder).toEqual(readSummary(fixed).draftPickOrder);
      test.info().annotations.push({ type: "clock-sensitivity", description: same.every(Boolean) ? "saves identical with the real clock" : `saves differ with the real clock: ${EARLY.filter((_, i) => !same[i]).join(", ")}` });
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
