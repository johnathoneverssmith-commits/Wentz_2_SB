import { mkdirSync, writeFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Stage } from "@/domain";

import { DEFAULT_CONFIG } from "./seed.ts";
import { bestCoachingPick, coachingOnTheClock } from "./coachingDraft.ts";
import { pendingFor } from "./tradeDeadline.ts";
import { FakeIDBFactory, quotaStorage } from "./fakeIndexedDb.testutil";
import { gunzip, type SaveRecord } from "./durableSave";

/**
 * SOAK (opt-in): a real-engine franchise, many seasons, reloaded at season boundaries.
 *
 *   npm run server &                      # the engine adapter on :8787
 *   SAVE_SOAK=1 SOAK_SEASONS=10 npx vitest run src/state/saveSoak.test.ts
 *
 * At every stage change it measures the JSON the old build would have written to localStorage (the
 * thing that overflowed) and the bytes actually stored, and asserts the stored copy equals the live
 * state. At every season boundary (preseason, end of season, offseason entry) it RELOADS — fresh
 * module graph, same device storage — and carries on playing the reloaded store, so a lossy save
 * shows up as a failed assertion or a diverging season. Skipped unless SAVE_SOAK=1 (it is minutes
 * long and needs the adapter).
 */
const SOAK = process.env.SAVE_SOAK === "1";
const TIMEOUT = 3 * 60 * 60_000;
const OUT = process.env.SOAK_OUT ?? "/tmp/save-soak";
const SAVE_KEY = "nfl-sim-ui.league";
const LS_LIMIT = 5_242_875;

type StoreModule = typeof import("./store.ts");
let mod: StoreModule;
const M = (): StoreModule => mod;
const state = (): ReturnType<StoreModule["useStore"]["getState"]> => mod.useStore.getState();

const device = { idb: new FakeIDBFactory(), ls: quotaStorage() };
async function pageLoad(): Promise<void> {
  vi.resetModules();
  globalThis.window = { localStorage: device.ls, indexedDB: device.idb } as unknown as typeof globalThis.window;
  mod = await import("./store.ts");
  await vi.waitFor(() => {
    let h = false;
    mod.onStoreHydrated((x) => (h = x))();
    expect(h).toBe(true);
  }, { timeout: 120_000 });
}

/** Does whatever this stage needs before its readiness gate can open. */
async function actOn(stage: Stage): Promise<void> {
  const s = M().useStore.getState();
  switch (stage) {
    case "setup":
      for (const g of s.gms) if (g.isHuman && !g.teamCode) s.pickTeam(g.id, unclaimedTeam());
      break;
    case "fantasyDraft":
      s.startDraft("fantasy");
      M().useStore.getState().autopickRemaining();
      break;
    case "offseasonDraft":
      s.startDraft("rookie");
      M().useStore.getState().autopickRemaining();
      break;
    case "offseasonSignings": {
      const mine = viewerTeam();
      for (const r of M().useStore.getState().draft?.results ?? []) {
        if (r.teamCode === mine && r.selectedId) M().useStore.getState().signRookie(r.selectedId, mine);
      }
      break;
    }
    case "coachingHiring":
    case "offseasonFreeAgency": {
      // run the live window out to its last day, the way the clock does
      const subject = stage === "coachingHiring" ? "coaches" : "players";
      M().useStore.getState().startBidding(subject);
      for (let i = 0; i < 6; i++) M().useStore.getState().advanceBiddingDay(subject);
      break;
    }
    case "preseason":
    case "regularSeason":
    case "playoffs":
      await M().useStore.getState().simulateGameDay();
      break;
    // The turn-based events end themselves once every turn is taken — the
    // readiness gate no longer skips them (it once left the fantasy draft
    // at pick 20 and skipped a whole midseason market online). So the
    // viewer takes their turns, the plain way: best available coach, pass
    // in the market, pass at the deadline.
    case "coachingDraft":
      for (let guard = 0; guard < 400 && state().stage === "coachingDraft"; guard++) {
        const team = coachingOnTheClock(state());
        const pick = team ? bestCoachingPick(state(), team) : null;
        if (!pick) break;
        M().useStore.getState().draftCoach(pick);
      }
      break;
    case "freeAgency":
    case "midseasonFreeAgency":
      for (let guard = 0; guard < 400 && state().stage === stage; guard++) {
        if (!state().freeAgencyEvent || state().freeAgencyEvent!.complete) break;
        M().useStore.getState().freeAgencyTurn({ pass: true });
      }
      break;
    case "tradeDeadline":
      for (let guard = 0; guard < 400 && state().stage === "tradeDeadline"; guard++) {
        const duty = pendingFor(state(), viewerTeam());
        if (!duty) break;
        M().useStore.getState().deadlineTurn(duty === "propose" ? { kind: "skip" } : { kind: "deny" });
      }
      break;
    default:
      break;
  }
}

function unclaimedTeam(): string {
  const s = M().useStore.getState();
  const taken = new Set(s.gms.map((g) => g.teamCode).filter(Boolean));
  return Object.keys(s.teams).find((c) => !taken.has(c))!;
}

function viewerTeam(): string {
  const s = M().useStore.getState();
  return s.gms.find((g) => g.id === s.viewerGmId)?.teamCode ?? "";
}

/** One stage's worth of play. Returns the stage we ended up in. */
async function playStage(): Promise<Stage> {
  const stage = state().stage;
  await actOn(stage);
  // an event that ended itself has already moved the league on
  if (state().stage !== stage) return state().stage;

  const s = M().useStore.getState();
  s.autoReadyNonViewers();
  s.setReady(s.viewerGmId, true);

  // in-season stages step through Game Day, everything else through the gate
  if (stage === "preseason" || stage === "regularSeason" || stage === "playoffs") {
    await M().useStore.getState().finishGameDay();
  } else {
    const moved = await M().useStore.getState().tryAdvance();
    expect(moved.moved, `stage ${stage} refused to advance`).toBe(true);
  }
  return state().stage;
}



/** What is in IndexedDB right now, decoded. */
async function storedJson(): Promise<{ json: string; bytes: number }> {
  const rec = device.idb.raw().get(SAVE_KEY) as SaveRecord;
  const json = rec.enc === "gzip" ? await gunzip(rec.data as ArrayBuffer) : String(rec.data);
  return { json, bytes: rec.enc === "gzip" ? (rec.data as ArrayBuffer).byteLength : json.length };
}

const BOUNDARY: Stage[] = ["preseason", "endOfSeasonAnnounce", "offseasonHotSeat"];

describe.skipIf(!SOAK)("save soak — real engine", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("plays N seasons, persists every stage, reloads at season boundaries, loses nothing", async () => {
    vi.unstubAllGlobals(); // test-setup stubs fetch to fail; this one wants the adapter
    mkdirSync(OUT, { recursive: true });
    const seed = Number(process.env.SOAK_SEED ?? 4001);
    const seasons = Number(process.env.SOAK_SEASONS ?? 10);
    await pageLoad();
    await state().newLeague(seed, { ...DEFAULT_CONFIG, humanGmCount: 1 });
    const target = 2026 + seasons;
    const rows: string[] = ["season stage week jsonChars storedBytes overLocalStorage reload"];
    let peakChars = 0;
    let peakBytes = 0;
    let overCount = 0;
    let reloads = 0;
    let guard = 900;
    let lastReloadKey = "";
    let writes = 0;
    while (guard-- > 0 && state().season < target) {
      const before = state().stage;
      const after = await playStage();
      const s = state();
      const opts = M().useStore.persist.getOptions();
      const chars = JSON.stringify({ state: opts.partialize!(s), version: opts.version }).length;
      expect(await M().flushSave(), `save landed at ${s.season} ${after}`).toBe(true);
      const stored = await storedJson();
      writes++;
      // the stored copy IS the live state, byte for byte — no silent rollback
      expect(stored.json.length, `stored length at ${s.season} ${after}`).toBe(chars);
      expect(stored.json, `stored == live at ${s.season} ${after}`).toBe(JSON.stringify({ state: opts.partialize!(s), version: opts.version }));
      expect(device.ls.getItem(SAVE_KEY), "nothing written to localStorage").toBeNull();
      expect(M().saveStatus().broken ?? false).toBe(false);
      peakChars = Math.max(peakChars, chars);
      peakBytes = Math.max(peakBytes, stored.bytes);
      if (chars > LS_LIMIT) overCount++;

      let reloaded = "";
      const key = `${s.season}|${after}`;
      if (BOUNDARY.includes(after) && key !== lastReloadKey && before !== after) {
        lastReloadKey = key;
        const snap = { season: s.season, stage: s.stage, week: s.week, history: s.history.length, games: s.games.length, archive: s.gameArchive?.length ?? 0, players: Object.keys(s.players).length, champions: JSON.stringify(s.champions) };
        const ser = JSON.stringify(opts.partialize!(s));
        await pageLoad();
        const r = state();
        expect({ season: r.season, stage: r.stage, week: r.week, history: r.history.length, games: r.games.length, archive: r.gameArchive?.length ?? 0, players: Object.keys(r.players).length, champions: JSON.stringify(r.champions) }, `reload at ${key}`).toEqual(snap);
        expect(JSON.stringify(M().useStore.persist.getOptions().partialize!(r)), `reloaded state equals saved at ${key}`).toBe(ser);
        reloads++;
        reloaded = "RELOADED";
      }
      rows.push(`${s.season} ${after} w${s.week} ${chars} ${stored.bytes} ${chars > LS_LIMIT ? "OVER" : "-"} ${reloaded}`);
      writeFileSync(`${OUT}/sizes.txt`, rows.join("\n"));
    }
    expect(state().season, "reached the target season").toBeGreaterThanOrEqual(target);
    const summary = `seasons=${seasons} stagesWritten=${writes} reloads=${reloads} peakJsonChars=${peakChars} peakStoredBytes=${peakBytes} stagesOverLocalStorageLimit=${overCount} warnings=0`;
    writeFileSync(`${OUT}/summary.txt`, summary);
    console.log(summary);
    expect(reloads).toBeGreaterThanOrEqual(seasons * 2);
  }, TIMEOUT);
});
