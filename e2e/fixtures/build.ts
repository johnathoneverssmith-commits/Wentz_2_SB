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
const FIXTURES: Array<{ name: string; stage: Stage }> = [
  { name: "fantasy-draft", stage: "fantasyDraft" },
  { name: "coaching-draft", stage: "coachingDraft" },
  { name: "preseason", stage: "preseason" },
];

const state = () => useStore.getState();
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
      for (let guard = 0; guard < 400 && state().stage === "freeAgency"; guard++) {
        if (!state().freeAgencyEvent || state().freeAgencyEvent!.complete) break;
        state().freeAgencyTurn({ pass: true });
      }
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
const wanted = new Map(FIXTURES.map((f) => [f.stage, f.name]));
const kept = new Set<string>();
for (let guard = 0; guard < 80 && kept.size < FIXTURES.length; guard++) {
  const stage = state().stage;
  const name = wanted.get(stage);
  if (name && !kept.has(name)) {
    const save = saved.get(SAVE_KEY);
    if (!save) throw new Error(`no save had been written on arriving at ${stage}`);
    const s = state();
    const viewerTeam = s.gms.find((g) => g.id === s.viewerGmId)?.teamCode ?? null;
    const doc = {
      name,
      seed,
      stage,
      draftSalt,
      viewerTeam,
      clock: realClock ? "real" : "fixed",
      sizeBytes: Buffer.byteLength(save, "utf8"),
      digest: sha(save),
      inputs,
      save,
    };
    writeFileSync(join(resolve(out), `${name}.json`), JSON.stringify(doc));
    written.push(`${name} (${stage}) ${(doc.sizeBytes / 1024).toFixed(0)} KiB`);
    kept.add(name);
    if (kept.size === FIXTURES.length) break;
  }
  await playStage();
}
if (kept.size !== FIXTURES.length) throw new Error(`only reached ${[...kept].join(", ")} before the guard`);

writeFileSync(join(resolve(out), "summary.json"), JSON.stringify({ seed, draftSalt, draftPickOrder, written, buildMs: Math.round(performance.now() - wall), startedAt: started }));
console.log(`built ${written.length} fixtures in ${Math.round(performance.now() - wall)} ms: ${written.join("; ")}`);
process.exit(0);
