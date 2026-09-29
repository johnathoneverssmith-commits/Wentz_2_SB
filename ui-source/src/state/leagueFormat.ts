/**
 * League formats.
 *
 * `nfl` is the game as it has always been: all 32 franchises, the real
 * divisions, the real 17-game schedule and the 14-team playoff.
 *
 * `humansOnly` is a league of just the GMs' own teams. The other franchises
 * do not exist at all — not as CPU teams sitting out, not as rosters anyone
 * can trade with. The league is padded with the fewest CPU-run teams that
 * give it full matchups every week, and plays a round robin:
 *
 *   - **Size** — the GM count rounded up to an even number, so every week
 *     every team plays and nobody sits on a bye; never fewer than four teams.
 *     Three GMs play a four-team league with one CPU team; five play six.
 *   - **Season** — whole round robins, as many as land nearest to seventeen
 *     games. Four teams play six times through (18 games), six teams three
 *     (15), eight teams twice (14). Each time a pair meets, the venue swaps.
 *   - **Playoffs** — the top half of the table, seeded by record, single
 *     elimination. Single elimination needs a power of two, so it is the top
 *     half rounded up to one: a final for four teams, the top four for six
 *     or eight.
 *
 * Rosters are built the same way as always — a fantasy draft, topped up to a
 * full 53 — from the whole player pool, so teams in a small league are
 * deeper than real NFL rosters. That is the point of the format, not a side
 * effect to correct for.
 *
 * Everything here is derived from the config and the team count; nothing is
 * persisted, so an older save simply reads as `nfl`.
 */

import { TEAMS } from "@/data/teams";
import type { LeagueConfig, LeagueState, PlayoffRound, ScheduledGame } from "@/domain";

export type LeagueFormat = NonNullable<LeagueConfig["leagueFormat"]>;

export const MIN_HUMANS_ONLY_TEAMS = 4;

export function formatOf(config: Pick<LeagueConfig, "leagueFormat">): LeagueFormat {
  return config.leagueFormat ?? "nfl";
}

export const isHumansOnly = (s: Pick<LeagueState, "config">): boolean => formatOf(s.config) === "humansOnly";

/** The header badge for league-wide screens: a humans-only league isn't the NFL. */
export const leagueBadge = (s: Pick<LeagueState, "config">): string => (isHumansOnly(s) ? "LG" : "NFL");

/** How many teams a humans-only league with this many GMs has. */
export function humansOnlyLeagueSize(gmCount: number): number {
  const even = gmCount % 2 === 0 ? gmCount : gmCount + 1;
  return Math.max(MIN_HUMANS_ONLY_TEAMS, even);
}

/** Complete round robins in a season: whichever count lands nearest 17 games. */
export function roundRobinSets(teamCount: number): number {
  const perSet = teamCount - 1;
  return Math.max(1, Math.round(17 / perSet));
}

export interface SeasonShape {
  preseasonWeeks: number;
  regularSeasonWeeks: number;
  /**
   * The last week before the trade deadline. The regular season is simulated
   * as two blocks either side of it (`revealBlocks.ts`), because a deadline
   * trade changes both blocks' inputs.
   */
  deadlineWeek: number;
}

/** The NFL's shape — kept as the one source for the old constants. */
export const NFL_SEASON_SHAPE: SeasonShape = {
  preseasonWeeks: 3,
  regularSeasonWeeks: 18,
  deadlineWeek: 9,
};

export function seasonShapeFor(format: LeagueFormat, teamCount: number): SeasonShape {
  if (format === "nfl") return NFL_SEASON_SHAPE;
  const regularSeasonWeeks = roundRobinSets(teamCount) * (teamCount - 1);
  return {
    // one pass of the rotation, capped at the NFL's three
    preseasonWeeks: Math.min(3, teamCount - 1),
    regularSeasonWeeks,
    deadlineWeek: Math.max(1, Math.floor(regularSeasonWeeks / 2)),
  };
}

export function seasonShape(s: Pick<LeagueState, "config" | "teams">): SeasonShape {
  return seasonShapeFor(formatOf(s.config), Object.keys(s.teams).length);
}

/**
 * A round-robin schedule by the circle method.
 *
 * One team stays fixed while the rest rotate, which pairs everyone once per
 * pass. Home and away alternate within a pass by position in the rotation,
 * and every second pass flips every venue — so each time two teams meet, the
 * other one hosts.
 *
 * Preseason reuses the first weeks of the rotation: exhibition games are
 * against the same few teams there are.
 */
export function roundRobinSchedule(teamCodes: readonly string[]): ScheduledGame[] {
  const n = teamCodes.length;
  if (n < 2 || n % 2 !== 0) throw new Error(`round robin needs an even team count, got ${n}`);
  const passes = roundRobinSets(n);
  const shape = seasonShapeFor("humansOnly", n);

  /**
   * Every round of one pass, as `[home, away]` pairs — the canonical circle
   * schedule. Teams 0..n-2 sit round the circle and team n-1 in the middle.
   * In round r the middle team meets team r, and every other pair is
   * (r+k, r-k). Venues: the middle game alternates by round, and each other
   * pair gives home to the side the parity of k picks. That split is what
   * keeps every team within one game of even home and away inside a pass —
   * the naive "alternate by seat" rule left one team 4-1 in a six-team pass.
   */
  const onePass = (flip: boolean): [string, string][][] => {
    const m = n - 1; // teams on the circle
    const at = (i: number): string => teamCodes[((i % m) + m) % m]!;
    const hub = teamCodes[m]!;
    const rounds: [string, string][][] = [];
    for (let r = 0; r < m; r++) {
      const round: [string, string][] = [];
      const hubHosts = r % 2 === 1;
      round.push(hubHosts !== flip ? [hub, at(r)] : [at(r), hub]);
      for (let k = 1; k < n / 2; k++) {
        const a = at(r + k);
        const b = at(r - k);
        const aHosts = k % 2 === 1;
        round.push(aHosts !== flip ? [a, b] : [b, a]);
      }
      rounds.push(round);
    }
    return rounds;
  };

  const games: ScheduledGame[] = [];
  const pre = onePass(true);
  for (let w = 0; w < shape.preseasonWeeks; w++) {
    for (const [home, away] of pre[w]!) games.push({ week: w + 1, phase: "PRE", homeTeam: home, awayTeam: away });
  }
  let week = 1;
  for (let p = 0; p < passes; p++) {
    for (const round of onePass(p % 2 === 1)) {
      for (const [home, away] of round) games.push({ week, phase: "REG", homeTeam: home, awayTeam: away });
      week++;
    }
  }
  return games;
}

/** How many teams make a humans-only playoff: the top half, up to a power of two. */
export function playoffFieldSize(teamCount: number): number {
  return Math.min(teamCount, 2 ** Math.ceil(Math.log2(teamCount / 2)));
}

/**
 * The rounds a humans-only playoff plays, in order. Reuses the NFL round keys
 * so the reveal and game-day machinery is shared: a four-team field plays a
 * semifinal round under `CONF` and the final under `SB`; a two-team field is
 * just the final.
 */
export function humansOnlyRounds(teamCount: number): PlayoffRound[] {
  return playoffFieldSize(teamCount) >= 4 ? ["CONF", "SB"] : ["SB"];
}

// ---- forming the league ------------------------------------------------------

/** A small deterministic shuffle, so the same league forms the same way on any machine. */
function shuffled<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let x = (seed >>> 0) || 0x9e3779b9;
  const next = (): number => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

const hashOf = (s: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
};

/**
 * The season's schedule for a humans-only league. The rotation order is
 * reshuffled each season, so the same teams do not open against each other
 * every year.
 */
export function humansOnlySchedule(s: Pick<LeagueState, "teams" | "season">): ScheduledGame[] {
  const codes = Object.keys(s.teams).sort();
  return roundRobinSchedule(shuffled(codes, hashOf(`${s.season}|${codes.join(",")}`)));
}

/**
 * Shrinks a league to its humans-only shape, once, as setup closes.
 *
 * Setup offers all 32 franchises so each GM can pick theirs; once they have,
 * the league becomes those teams plus the fewest CPU franchises that make
 * the count even (and at least four). Every other franchise is removed
 * outright — its team record, its draft picks and its schedule — so nothing
 * downstream can trade with, draft against or play a team that is not in
 * the league. The CPU franchises are drawn deterministically from the ones
 * nobody picked.
 *
 * Runs before the fantasy draft, which builds every roster in this format,
 * so the whole player pool is returned to it here.
 */
export function formHumansOnlyLeague(s: LeagueState): void {
  const held = [...new Set(s.gms.map((g) => g.teamCode).filter((c) => c && s.teams[c]))];
  const size = Math.max(humansOnlyLeagueSize(s.config.humanGmCount), held.length + (held.length % 2));
  const open = TEAMS.map((t) => t.code).filter((c) => !held.includes(c));
  const cpu = shuffled(open, hashOf(`${s.season}|${held.sort().join(",")}`)).slice(0, size - held.length);
  const keep = new Set([...held, ...cpu]);

  for (const code of Object.keys(s.teams)) if (!keep.has(code)) delete s.teams[code];
  for (const [key, pick] of Object.entries(s.draftPicks ?? {})) {
    if (!keep.has(pick.originalTeam) || !keep.has(pick.ownedBy)) delete s.draftPicks[key];
  }
  for (const code of Object.keys(s.depthChart ?? {})) if (!keep.has(code)) delete s.depthChart[code];
  // Every roster in this format comes out of the fantasy draft, so the whole
  // pool goes back into it — including anyone a real-rosters setup had
  // already placed on one of the teams being kept.
  for (const p of Object.values(s.players)) {
    if (p.retired) continue;
    p.nfl_team = "FA";
    p.free_agent = true;
    p.contract = null;
  }
  s.config.fantasyDraft = true;
  s.schedule = humansOnlySchedule(s);
  s.games = [];
}
