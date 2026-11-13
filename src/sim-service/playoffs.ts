/**
 * The playoff request handlers: a stateless round stepper and a single decided
 * game, both pure functions of their body. Shared by the local adapter and any
 * other host (issue #74 Phase 3); they play on this thread and need no worker.
 */
import { broadcastGame } from "../engine/broadcast.js";
import type { Conference } from "../engine/nfl-structure.js";
import {
  decidePlayoffGame,
  playPlayoffRound,
  startPlayoffs,
  withPlayoffRosters,
  type PlayoffProgress,
  type RecordedPlayoffGame,
} from "../engine/playoffs.js";
import { Roster, type DepthOrder } from "../engine/roster.js";
import type { GamePlan } from "../engine/gameplan.js";
import type { Game } from "../engine/sim.js";
import type { Staff } from "../engine/staff.js";
import type { ConferenceSeeding } from "../engine/standings.js";
import type { Player } from "../schema/player.js";
import { presentGame, rosterFrom } from "./game.js";

/** team code -> Roster, for every team the body supplied players for. */
function rostersFrom(
  rosters: Record<string, Player[]> | undefined,
  depthCharts: Record<string, DepthOrder> | undefined,
): Record<string, Roster> | null {
  if (!rosters) return null;
  const out: Record<string, Roster> = {};
  for (const [team, players] of Object.entries(rosters)) {
    const r = rosterFrom(team, players, depthCharts?.[team]);
    if (r) out[team] = r;
  }
  return out;
}

export interface PlayoffRoundBody {
  seed: number;
  seeding: { AFC: ConferenceSeeding; NFC: ConferenceSeeding };
  /**
   * The franchise's own players, per team. Without them the engine plays the
   * postseason with the reference NFL rosters — which is what it always did,
   * and why a GM's playoff games never reflected the team they had built.
   */
  rosters?: Record<string, Player[]>;
  depthCharts?: Record<string, DepthOrder>;
  talentScale?: number;
  offenseAdjust?: number;
  staffs?: Record<string, Staff>;
  /** team code -> its game plan (`src/engine/gameplan.ts`) */
  plans?: Record<string, GamePlan>;
  /** how many rounds have already been played, before this call plays the next one. */
  roundsPlayed: number;
  /**
   * The games the caller already holds for the rounds before this one. They
   * are applied, not re-simulated: rosters change between rounds (injuries),
   * so a replay could crown a different winner than the one on record.
   */
  recorded?: RecordedPlayoffGame[];
}

/**
 * Stateless round stepper: `playPlayoffRound` is pure and each round's RNG
 * seed is a fixed offset of the base `seed` (see playoffs.ts), so replaying
 * from `startPlayoffs` up through `roundsPlayed` reproduces the exact same
 * earlier rounds every time — no server-side bracket state to keep or lose.
 * Also previews the *next* round's pairing (home/away/seeds only, no score)
 * by playing one round further and discarding the result, so the UI can show
 * "who's up next" before that round is actually played — same two-step
 * seed-then-play flow the UI's bracket screen already expects.
 */
export function handlePlayoffRound(body: PlayoffRoundBody & { viewerTeam?: string | null }) {
  const rosters = rostersFrom(body.rosters, body.depthCharts);
  const captured = new Capture();
  const out = withPlayoffRosters(
    rosters,
    () => playoffRound(body, (on) => (captured.on = on)),
    body.talentScale ?? 1,
    body.staffs ?? null,
    body.offenseAdjust ?? 0,
    captured.hook,
    body.plans ?? null,
  );
  return { ...out, boxes: presentCaptured(captured, body, rosters) };
}

/** The games a playoff call decided, keyed "HOME|AWAY", while capturing is on. */
class Capture {
  on = true;
  games = new Map<string, { g: Game; neutral: boolean; seed: number }>();
  hook = (g: Game, home: string, away: string, neutral: boolean, seed: number): void => {
    if (this.on) this.games.set(`${home}|${away}`, { g, neutral, seed });
  };
}

/**
 * Each captured playoff game, presented by the same builder a regular-season
 * week uses (`presentGame`), and for the viewer's own game the play-by-play
 * too: replayed from the seed that decided it, with the options it was played
 * with. A playoff game is no longer a score and nothing else.
 */
function presentCaptured(
  c: Capture,
  body: {
    rosters?: Record<string, Player[]> | undefined;
    talentScale?: number | undefined;
    offenseAdjust?: number | undefined;
    staffs?: Record<string, Staff> | undefined;
    plans?: Record<string, GamePlan> | undefined;
    viewerTeam?: string | null | undefined;
  },
  rosters: Record<string, Roster> | null,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, { g, neutral, seed }] of c.games) {
    const [home, away] = key.split("|") as [string, string];
    const present = presentGame(g, {
      homeTeam: home,
      awayTeam: away,
      week: 0,
      weather: g.weather,
      players: body.rosters ? { [home]: body.rosters[home] ?? [], [away]: body.rosters[away] ?? [] } : undefined,
    });
    const hs = body.staffs?.[home];
    const as = body.staffs?.[away];
    out[key] =
      body.viewerTeam && (body.viewerTeam === home || body.viewerTeam === away)
        ? {
            ...present,
            broadcast: broadcastGame(seed, home, away, {
              homeRoster: rosters?.[home],
              awayRoster: rosters?.[away],
              talentScale: body.talentScale,
              offenseAdjust: body.offenseAdjust,
              overtime: "nfl",
              mustDecide: true,
              neutralSite: neutral,
              ...(g.weather ? { weather: g.weather } : {}),
              ...(hs && as ? { homeStaff: hs, awayStaff: as } : {}),
              ...(body.plans?.[home] ? { homePlan: body.plans[home] } : {}),
              ...(body.plans?.[away] ? { awayPlan: body.plans[away] } : {}),
            }),
          }
        : present;
  }
  return out;
}

/** One humans-only playoff game: decided, never tied, on the teams GMs built. */
export function handlePlayoffGame(body: {
  seed: number;
  homeTeam: string;
  awayTeam: string;
  neutralSite?: boolean;
  rosters?: Record<string, Player[]>;
  depthCharts?: Record<string, DepthOrder>;
  talentScale?: number;
  offenseAdjust?: number;
  staffs?: Record<string, Staff>;
  /** team code -> its game plan (`src/engine/gameplan.ts`) */
  plans?: Record<string, GamePlan>;
  viewerTeam?: string | null;
}) {
  const rosters = rostersFrom(body.rosters, body.depthCharts);
  const captured = new Capture();
  const result = withPlayoffRosters(
    rosters,
    () => decidePlayoffGame(body.seed, body.homeTeam, body.awayTeam, body.neutralSite ?? false),
    body.talentScale ?? 1,
    body.staffs ?? null,
    body.offenseAdjust ?? 0,
    captured.hook,
    body.plans ?? null,
  );
  const boxes = presentCaptured(captured, body, rosters);
  return { ...result, box: boxes[`${body.homeTeam}|${body.awayTeam}`] ?? null };
}

function playoffRound(body: PlayoffRoundBody, capture: (on: boolean) => void = () => {}) {
  const seeding = body.seeding as Record<Conference, ConferenceSeeding>;
  capture(false); // the rounds replayed to reach this one aren't this call's games
  let p: PlayoffProgress = startPlayoffs(body.seed, seeding);
  for (let i = 0; i < body.roundsPlayed; i++) p = playPlayoffRound(p, body.recorded).progress;
  capture(true);
  const { progress, games } = playPlayoffRound(p);
  capture(false); // and neither is the next round's preview, played only to name its pairings

  let nextRoundPreview: { conference: string; home: string; away: string; homeSeed: number; awaySeed: number }[] | null = null;
  if (progress.nextRound !== "done") {
    const preview = playPlayoffRound(progress).games;
    nextRoundPreview = preview.map((g) => ({
      conference: g.conference,
      home: g.home,
      away: g.away,
      homeSeed: g.homeSeed,
      awaySeed: g.awaySeed,
    }));
  }
  const done = progress.nextRound === "done";
  return { games, nextRoundPreview, done, champion: done ? games[games.length - 1]!.winner : null };
}

