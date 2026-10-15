/**
 * Builds browser saves by playing a real league, headless, through the game's own stage machine.
 *
 *   cd ui-source && npx tsx --tsconfig tsconfig.app.json ../e2e/fixtures/build.ts --out <dir> [--seed 4242] [--real-clock]
 *
 * Nothing here sets a stage. The league is created with an explicit seed (never 1, which would draw a random
 * draft salt), a team is claimed, readiness is given, and `tryAdvance` moves the league on, exactly as the
 * screens do; the helper that does each stage's work (`actOn`) mirrors `ui-source/src/state/playthrough.test.ts`,
 * which is the guard that this same play stays legal. A save is captured at the first arrival in each stage
 * named in FIXTURES: the very string the app would have written to localStorage.
 *
 * Controlled inputs, because a frozen clock alone does not make a league deterministic:
 *   - the seed, and the draft salt (which the game derives as seed * 31 for any seed but 1, set here explicitly);
 *   - the data the generator reads, hashed into the output so a changed input is visible (inputs.json pins them);
 *   - the engine adapter is unreachable, so the in-process Mock simulation is always the one that plays;
 *   - the clock is fixed unless --real-clock (used by the tests to see what the clock changes, if anything).
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const SAVE_KEY = "nfl-sim-ui.league";

const opt = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? undefined : process.argv[i + 1];
};
const seed = Number(opt("seed") ?? 4242);
const out = opt("out");
const realClock = process.argv.includes("--real-clock");
// build only these fixtures (and stop playing once they are kept); by default all of them
const only = opt("only")?.split(",").filter(Boolean);
if (!out) throw new Error("--out <directory> is required");
if (!Number.isSafeInteger(seed) || seed === 1) throw new Error("--seed must be a whole number other than 1 (1 draws a random draft salt)");

// ---- controlled inputs, before the game's code is loaded
const FIXED_TIME = Date.UTC(2026, 0, 1);
if (!realClock) Date.now = () => FIXED_TIME;
Object.assign(globalThis, { fetch: () => Promise.reject(new TypeError("headless mock mode")) });
const saved = new Map<string, string>();

const { useStore } = await import("../../ui-source/src/state/store.ts");
const { DEFAULT_CONFIG } = await import("../../ui-source/src/state/seed.ts");
const { bestCoachingPick, coachingOnTheClock } = await import("../../ui-source/src/state/coachingDraft.ts");
const { pendingFor } = await import("../../ui-source/src/state/tradeDeadline.ts");
Object.assign(globalThis, {
  window: {
    localStorage: {
      getItem: (k: string) => saved.get(k) ?? null,
      setItem: (k: string, v: string) => void saved.set(k, v),
      removeItem: (k: string) => void saved.delete(k),
    },
  },
});
type Stage = ReturnType<typeof useStore.getState>["stage"];

/** Stages at which a save is kept, in the order a league reaches them. */
const FIXTURES: Array<{ name: string; stage: Stage; /** keep the first arrival at this week of the stage, not the first at the stage */ week?: number }> = [
  { name: "fantasy-draft", stage: "fantasyDraft" },
  { name: "coaching-draft", stage: "coachingDraft" },
  { name: "preseason", stage: "preseason" },
  // The free-agency skip regression (commit b757e8d). Both are saves from one and the same playthrough:
  //   midseason-fa: the first arrival at the mid-season market, nothing chosen yet;
  //   offseason-fa-skip-carried: a year later, the moment before the offseason market opens, after the human GM
  //   chose "Skip free agency" in the mid-season market (the store's own `setSkip`, which the checkbox calls) and the
  //   league was then played on through its stage machine. Whether that choice is still set here is what the defect
  //   was; the builder refuses to write the fixture unless it is, so the fixture always exercises the carry-over.
  // The regular season, kept at three moments of the same playthrough (before the mid-season fixtures below, which are later):
  //   season-week-1: the opening week, nothing played; season-week-9: the last week before the trade deadline;
  //   season-week-17: two weeks from the playoffs.
  { name: "season-week-1", stage: "regularSeason", week: 1 },
  { name: "season-week-9", stage: "regularSeason", week: 9 },
  { name: "season-week-17", stage: "regularSeason", week: 17 },
  // the first arrival at the playoffs: the regular season played out, the bracket seeded by the game, nothing in it played yet
  { name: "playoffs-wild-card", stage: "playoffs" },
  { name: "midseason-fa", stage: "midseasonFreeAgency" },
  { name: "offseason-fa-skip-carried", stage: "offseasonDraftSummary" },
];
const SKIP_CHOSEN_AT = "midseason-fa";
const SKIP_MUST_BE_SET_AT = "offseason-fa-skip-carried";

const state = () => useStore.getState();
const viewerTeam = (): string => state().gms.find((g) => g.id === state().viewerGmId)?.teamCode ?? "";
let draftPickOrder: string[] = [];

/** Does whatever the stage needs before its readiness gate opens. A mirror of playthrough.test.ts's `actOn`. */
async function actOn(stage: Stage): Promise<void> {
  const s = state();
  switch (stage) {
    case "setup": {
      const taken = new Set(s.gms.map((g) => g.teamCode).filter(Boolean));
      const free = Object.keys(s.teams).filter((c) => !taken.has(c));
      for (const g of s.gms) if (g.isHuman && !g.teamCode) s.pickTeam(g.id, free.shift()!);
      break;
    }
    case "fantasyDraft":
      s.startDraft("fantasy");
      // the order the game derives from this seed and salt, kept so a browser's run of the same draft can be compared with it
      draftPickOrder = [...state().draft!.pickOrder];
      state().autopickRemaining();
      break;
    case "coachingHiring":
      state().startBidding("coaches");
      for (let i = 0; i < 6; i++) state().advanceBiddingDay("coaches");
      break;
    case "coachingDraft":
      for (let guard = 0; guard < 400 && state().stage === "coachingDraft"; guard++) {
        const team = coachingOnTheClock(state());
        const pick = team ? bestCoachingPick(state(), team) : null;
        if (!pick) break;
        state().draftCoach(pick);
      }
      break;
    case "freeAgency":
    case "midseasonFreeAgency":
      for (let guard = 0; guard < 400 && state().stage === stage; guard++) {
        if (!state().freeAgencyEvent || state().freeAgencyEvent!.complete) break;
        state().freeAgencyTurn({ pass: true });
      }
      break;
    case "tradeDeadline": {
      const mine = viewerTeam();
      for (let guard = 0; guard < 400 && state().stage === "tradeDeadline"; guard++) {
        const duty = pendingFor(state(), mine);
        if (!duty) break;
        state().deadlineTurn(duty === "propose" ? { kind: "skip" } : { kind: "deny" });
      }
      break;
    }
    case "preseason":
    case "regularSeason":
    case "playoffs":
      await state().simulateGameDay();
      break;
    case "offseasonDraft":
      s.startDraft("rookie");
      state().autopickRemaining();
      break;
    case "offseasonSignings": {
      const mine = viewerTeam();
      for (const r of state().draft?.results ?? []) if (r.teamCode === mine && r.selectedId) state().signRookie(r.selectedId, mine);
      break;
    }
    case "offseasonFreeAgency":
      // a league caught inside the old live window: run it out the way the clock does
      state().startBidding("players");
      for (let i = 0; i < 6; i++) state().advanceBiddingDay("players");
      break;
    default:
      break;
  }
}

async function playStage(): Promise<void> {
  const stage = state().stage;
  await actOn(stage);
  if (state().stage !== stage) return; // an event that ended itself has already moved the league on
  const s = state();
  s.autoReadyNonViewers();
  s.setReady(s.viewerGmId, true);
  // in-season stages step through Game Day, everything else through the gate (as playthrough.test.ts does)
  if (stage === "preseason" || stage === "regularSeason" || stage === "playoffs") {
    await state().finishGameDay();
    return;
  }
  const moved = await state().tryAdvance();
  if (!moved.moved) throw new Error(`stage ${stage} refused to advance`);
}

// ---- input data the generator reads, hashed with line endings normalised so the digest is the same on every OS
const INPUT_FILES = [
  "ui-source/src/data/pool-2026.json",
  "ui-source/src/data/teams.ts",
  "src/engine/schedule.ts",
  "src/engine/nfl-structure.ts",
  "src/engine/staff-data.ts",
];
const sha = (text: string | Buffer): string => createHash("sha256").update(text).digest("hex");
const inputs = Object.fromEntries(INPUT_FILES.map((f) => [f, sha(readFileSync(join(REPO, f), "utf8").replace(/\r\n/g, "\n"))]));

// ---- play
const started = Date.now();
const wall = performance.now();
await state().newLeague(seed, { ...DEFAULT_CONFIG, humanGmCount: 1 });
// controlled explicitly; the game derives exactly this for any seed but 1 (rules.ts `draftSalt`)
const draftSalt = seed * 31;
useStore.setState({ draftSalt });

mkdirSync(resolve(out), { recursive: true });
const written: string[] = [];
const chosen = FIXTURES.filter((f) => !only || only.includes(f.name));
if (only) for (const n of only) if (!FIXTURES.some((f) => f.name === n)) throw new Error(`--only names a fixture that does not exist: ${n}`);
const kept = new Set<string>();
// the whole-year fixtures need the playthrough to go on past the preseason; the guard is generous but finite
for (let guard = 0; guard < 220 && kept.size < chosen.length; guard++) {
  const stage = state().stage;
  if (process.env.E2E_BUILD_TRACE) console.error(`[build] ${guard} ${stage} season ${state().season} week ${state().week}`);
  const name = chosen.find((f) => f.stage === stage && (f.week === undefined || f.week === state().week) && !kept.has(f.name))?.name;
  if (name) {
    const save = saved.get(SAVE_KEY);
    if (!save) throw new Error(`no save had been written on arriving at ${stage}`);
    const s = state();
    const viewerTeam = s.gms.find((g) => g.id === s.viewerGmId)?.teamCode ?? null;
    const skipSet = Boolean(s.gms.find((g) => g.id === s.viewerGmId)?.skips?.freeAgency);
    if (name === SKIP_MUST_BE_SET_AT && !skipSet) {
      throw new Error(`${name}: the skip chosen at ${SKIP_CHOSEN_AT} is no longer set, so this save would not exercise the carry-over. Refusing to write it.`);
    }
    const doc = {
      name,
      seed,
      stage,
      draftSalt,
      viewerTeam,
      season: s.season,
      week: s.week,
      skipFreeAgency: skipSet,
      clock: realClock ? "real" : "fixed",
      sizeBytes: Buffer.byteLength(save, "utf8"),
      digest: sha(save),
      inputs,
      save,
    };
    writeFileSync(join(resolve(out), `${name}.json`), JSON.stringify(doc));
    written.push(`${name} (${stage}) ${(doc.sizeBytes / 1024).toFixed(0)} KiB`);
    kept.add(name);
    if (kept.size === chosen.length) break;
    if (name === SKIP_CHOSEN_AT && chosen.some((f) => f.name === SKIP_MUST_BE_SET_AT)) {
      // what the checkbox does: the store's own action, for this GM's team only
      const r = state().setSkip("freeAgency", true);
      if (!r.ok) throw new Error(`could not choose Skip free agency: ${r.reason}`);
      if (!state().freeAgencyEvent?.complete) throw new Error("with every human skipping, the mid-season market should have finished");
    }
  }
  await playStage();
}
if (kept.size !== chosen.length) throw new Error(`only reached ${[...kept].join(", ")} before the guard`);

writeFileSync(join(resolve(out), "summary.json"), JSON.stringify({ seed, draftSalt, draftPickOrder, written, buildMs: Math.round(performance.now() - wall), startedAt: started }));
console.log(`built ${written.length} fixtures in ${Math.round(performance.now() - wall)} ms: ${written.join("; ")}`);
process.exit(0);
