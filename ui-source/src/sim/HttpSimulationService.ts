/**
 * Calls the `nfl-franchise-sim` adapter (`server/index.ts`, `npm run server`,
 * http://localhost:8787) for the pieces the engine genuinely backs today:
 * the real-roster pool, the real 2026 schedule, game simulation, and the
 * gamecast broadcast view. Not a full `SimulationService` — see
 * `HybridSimulationService.ts`, which composes this with the Mock for the
 * rest and is what the store actually uses.
 *
 * Team-code note: the engine spells the Rams "LA"; this UI spells them "LAR"
 * (matches the nflverse/real-world convention everywhere else). Every other
 * code matches. `toEngine`/`toUi` translate at this boundary only.
 */
import type { GameBroadcast } from "@/domain/broadcast.ts";
import type { GameResult, Player, ScheduledGame } from "@/domain";

const BASE_URL = "http://localhost:8787";

const toEngine = (code: string): string => (code === "LAR" ? "LA" : code);
const toUi = (code: string): string => (code === "LA" ? "LAR" : code);

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`adapter ${path} -> ${res.status}`);
  return (await res.json()) as T;
}

function playerToEngine(p: Player): Player {
  return { ...p, nfl_team: toEngine(p.nfl_team) };
}
function playerToUi(p: Player): Player {
  return { ...p, nfl_team: toUi(p.nfl_team) };
}

export interface SchemeFitBaseline {
  off: Record<string, number>;
  def: Record<string, number>;
}

/** One coach-market candidate as the adapter returns it — `name` present only
 *  for the real 32-staff pool; generated candidates get a name client-side. */
export interface RawCoachCandidate {
  role: "HC" | "OC" | "DC";
  name?: string;
  /** the real team this coach's staff data came from — a hint only; every
   *  market candidate is a free agent (`team: null`) in this game's design. */
  previousTeam?: string;
  gameManagement?: number;
  discipline?: number;
  aggression?: number;
  rating?: number;
  scheme?: string;
  passBias?: number;
  tempo?: number;
  blitzBias?: number;
}

export interface RawConferenceSeeding {
  seeds: string[];
  divisionWinners: string[];
  wildCards: string[];
}

export interface RawPlayoffGame {
  conference: string; // "AFC" | "NFC" | "NFL" (superbowl)
  home: string;
  away: string;
  homeSeed: number;
  awaySeed: number;
  homeScore: number;
  awayScore: number;
  winner: string;
}

export interface RawPlayoffRoundResult {
  games: RawPlayoffGame[];
  nextRoundPreview: { conference: string; home: string; away: string; homeSeed: number; awaySeed: number }[] | null;
  done: boolean;
  champion: string | null;
}

export class HttpSimulationService {
  async generateInitialPool(): Promise<Player[]> {
    const pool = await post<Player[]>("/pool", {});
    return pool.map(playerToUi);
  }

  async generateSchedule(year?: number): Promise<ScheduledGame[]> {
    const games = await post<{ week: number; phase: "REG"; homeTeam: string; awayTeam: string }[]>(
      "/schedule",
      year !== undefined ? { year } : {},
    );
    return games.map((g) => ({
      week: g.week,
      phase: g.phase,
      homeTeam: toUi(g.homeTeam),
      awayTeam: toUi(g.awayTeam),
    }));
  }

  /**
   * `rosters`: team code -> that franchise's current players (for roster
   * injection). `viewer`: the slate's viewer game, if any — gets the full
   * broadcast/gamecast trace back.
   */
  async simulateWeek(
    seed: number,
    season: number,
    week: number,
    phase: "PRE" | "REG",
    games: { homeTeam: string; awayTeam: string }[],
    rosters: Record<string, Player[]>,
    viewer: { homeTeam: string; awayTeam: string } | null,
    depthCharts: Record<string, Partial<Record<string, string[]>>> = {},
  ): Promise<GameResult[]> {
    const engineRosters: Record<string, Player[]> = {};
    for (const [team, players] of Object.entries(rosters)) {
      engineRosters[toEngine(team)] = players.map(playerToEngine);
    }
    const engineDepth: Record<string, Record<string, string[]>> = {};
    for (const [team, chart] of Object.entries(depthCharts)) {
      const entries = Object.entries(chart).filter(([, ids]) => ids && ids.length > 0);
      if (entries.length > 0) {
        engineDepth[toEngine(team)] = Object.fromEntries(entries) as Record<string, string[]>;
      }
    }
    const body = {
      seed,
      season,
      week,
      phase,
      games: games.map((g) => ({ homeTeam: toEngine(g.homeTeam), awayTeam: toEngine(g.awayTeam) })),
      viewer: viewer ? { homeTeam: toEngine(viewer.homeTeam), awayTeam: toEngine(viewer.awayTeam) } : null,
      rosters: engineRosters,
      depthCharts: engineDepth,
    };
    const results = await post<
      (GameResult & { broadcast?: GameBroadcast & { home: string; away: string } })[]
    >("/simulate-week", body);
    return results.map((g) => ({
      ...g,
      homeTeam: toUi(g.homeTeam),
      awayTeam: toUi(g.awayTeam),
      // team codes come back in the engine's vocabulary; anything the UI
      // filters by team has to be translated, this list included
      injuries: (g.injuries ?? []).map((e) => ({ ...e, team: toUi(e.team) })),
      broadcast: g.broadcast
        ? {
            ...g.broadcast,
            home: toUi(g.broadcast.home),
            away: toUi(g.broadcast.away),
            drives: g.broadcast.drives.map((d) => ({ ...d, team: toUi(d.team) })),
            injuries: g.broadcast.injuries.map((e) => ({ ...e, team: toUi(e.team) })),
          }
        : undefined,
    }));
  }

  async schemeFitBaseline(): Promise<SchemeFitBaseline> {
    const res = await post<{ baseline: SchemeFitBaseline }>("/scheme-fit-baseline", {});
    return res.baseline;
  }

  async generateCoachMarket(
    seed: number,
  ): Promise<{ real: RawCoachCandidate[]; generated: RawCoachCandidate[] }> {
    const res = await post<{ real: RawCoachCandidate[]; generated: RawCoachCandidate[] }>(
      "/coach-market",
      { seed },
    );
    const translate = (c: RawCoachCandidate): RawCoachCandidate =>
      c.previousTeam ? { ...c, previousTeam: toUi(c.previousTeam) } : c;
    return { real: res.real.map(translate), generated: res.generated.map(translate) };
  }

  /** `games`: finished REG-season games, in this UI's team-code convention. */
  async seedPlayoffs(
    games: { home: string; away: string; homeScore: number; awayScore: number }[],
  ): Promise<{ AFC: RawConferenceSeeding; NFC: RawConferenceSeeding }> {
    const body = {
      games: games.map((g) => ({
        home: toEngine(g.home),
        away: toEngine(g.away),
        homeScore: g.homeScore,
        awayScore: g.awayScore,
      })),
    };
    const res = await post<{ AFC: RawConferenceSeeding; NFC: RawConferenceSeeding }>("/playoffs/seed", body);
    const translateSeeding = (s: RawConferenceSeeding): RawConferenceSeeding => ({
      seeds: s.seeds.map(toUi),
      divisionWinners: s.divisionWinners.map(toUi),
      wildCards: s.wildCards.map(toUi),
    });
    return { AFC: translateSeeding(res.AFC), NFC: translateSeeding(res.NFC) };
  }

  /**
   * Stateless: `roundsPlayed` (0-3) says how many rounds have already been
   * played, and the adapter replays from scratch up through that point (the
   * per-round seed is a fixed offset of `seed`, so replaying reproduces the
   * exact same earlier rounds every time) before playing the next one.
   */
  async playoffRound(
    seed: number,
    seeding: { AFC: RawConferenceSeeding; NFC: RawConferenceSeeding },
    roundsPlayed: number,
  ): Promise<RawPlayoffRoundResult> {
    const body = {
      seed,
      seeding: {
        AFC: { seeds: seeding.AFC.seeds.map(toEngine), divisionWinners: [], wildCards: [] },
        NFC: { seeds: seeding.NFC.seeds.map(toEngine), divisionWinners: [], wildCards: [] },
      },
      roundsPlayed,
    };
    const res = await post<RawPlayoffRoundResult>("/playoffs/round", body);
    const translateGame = (g: RawPlayoffGame): RawPlayoffGame => ({
      ...g,
      home: toUi(g.home),
      away: toUi(g.away),
      winner: toUi(g.winner),
    });
    return {
      games: res.games.map(translateGame),
      nextRoundPreview: res.nextRoundPreview?.map((g) => ({ ...g, home: toUi(g.home), away: toUi(g.away) })) ?? null,
      done: res.done,
      champion: res.champion ? toUi(res.champion) : null,
    };
  }
}
