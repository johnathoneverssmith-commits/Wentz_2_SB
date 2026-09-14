/**
 * The service the store actually uses. Real-backs what the engine genuinely
 * supports today via `HttpSimulationService` — falling back to
 * `MockSimulationService` if the adapter (`npm run server` in
 * `nfl-franchise-sim`) isn't reachable, so the UI (including the standalone
 * single-file build) keeps working either way, just without real fidelity
 * when the adapter is down:
 * - `generateInitialPool` (in "realRosters" mode), `generateSchedule`,
 *   `simulateWeek` — async, one HTTP round-trip each.
 * - `computeSchemeFit` — stays synchronous (it's called inline in a render
 *   loop): the league-mean scheme-fit baseline is fetched once, cached, and
 *   used for real tag-overlap math once available; until then (or if the
 *   adapter never answers) it falls back to Mock's heuristic. Coach scheme
 *   ids (`west_coast`, `four_three`, …) match the engine's vocabulary
 *   exactly — see `domain/coach.ts` — so this works whether the coach is
 *   Mock- or engine-generated.
 *
 * - `generateCoachMarket` — async too: the real 32 current staffs (real
 *   2026 HC/OC/DC names) plus a free-agent pool sampled from that same
 *   ratings distribution (`staff-market.ts`), with names generated
 *   client-side (via Mock's `names.ts`) for the generated half only.
 *
 * - `seedBracket` / `simulatePlayoffRound` — real standings + a real,
 *   round-by-round-simulated playoff bracket (`nfl-franchise-sim`'s
 *   `standings.ts`/`playoffs.ts`), stateless on the adapter side: each round
 *   is replayed from the same seed up through the rounds already played (the
 *   per-round RNG seed is a fixed offset, so replaying reproduces the exact
 *   same earlier results), so there's no server-side bracket to keep in sync.
 *
 * Everything else delegates straight to `MockSimulationService`, unchanged:
 * `generateDraftClass` / `evaluateTrade` / `retirementOutcomes` /
 * `finalizeSeasonOutcomes` — no calibrated engine model yet (see `NOTES.md`).
 */
import { TEAMS } from "@/data/teams";
import type {
  BracketMatchup,
  BracketState,
  Coach,
  CoachRole,
  DefenseScheme,
  DraftProspect,
  GameResult,
  LeagueState,
  OffenseScheme,
  Player,
  PlayoffRound,
  ScheduledGame,
  TradeAsset,
} from "@/domain";
import { ROUND_ORDER } from "@/domain";

import {
  HttpSimulationService,
  type RawCoachCandidate,
  type RawConferenceSeeding,
  type SchemeFitBaseline,
} from "./HttpSimulationService.ts";
import { availableRoster } from "@/state/injuries.ts";

import { MockSimulationService } from "./MockSimulationService.ts";
import { fullPersonName } from "./names.ts";
import { Rng } from "./rng.ts";
import { winProbability, type Venue } from "./win-probability.ts";
import type { RetirementOutcome, SimulationService, TradeEvaluation } from "./SimulationService.ts";

// mirrors nfl-franchise-sim/src/engine/staff.ts's OFF_SCHEME_TAGS/DEF_SCHEME_TAGS
const OFF_SCHEME_TAGS: Record<string, readonly string[]> = {
  west_coast: ["west_coast", "play_action", "move_te", "zone_run", "outside_zone"],
  vertical: ["vertical", "spread", "play_action", "downhill"],
  spread: ["spread", "rpo", "zone_run", "outside_zone", "west_coast"],
  power_run: ["power_run", "gap_scheme", "inline", "downhill", "pass_pro"],
  zone_run: ["zone_run", "outside_zone", "west_coast", "move_te"],
  pro_style: ["play_action", "inline", "move_te", "power_run", "west_coast"],
};
const DEF_SCHEME_TAGS: Record<string, readonly string[]> = {
  four_three: ["base_4_3", "one_gap", "penetrate", "attack", "wide_9"],
  three_four: ["base_3_4", "two_gap", "contain", "nose"],
  multiple: ["nickel", "cover_3", "split_safety", "robber", "move_te"],
  cover_3: ["cover_3", "single_high", "zone", "robber"],
  cover_2: ["cover_2", "split_safety", "zone"],
  man_press: ["man_press", "cover_man", "cover_1", "nickel"],
};
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

// stable per season, reused across every round of that postseason so the
// stateless-replay adapter reproduces the same earlier rounds every call.
const playoffSeed = (state: LeagueState): number => state.season * 1_000_003 + 777;

/**
 * Pre-game favourite, from team ratings.
 *
 * The engine doesn't expose a win probability — only the result of playing
 * the game — so this is the curve fitted to 47,616 of its games, which is as
 * close to asking it as you can get without playing this one a thousand
 * times. Same curve the Mock and the team hub quote.
 */
function favProb(state: LeagueState, a: string, b: string, venue: Venue = "home"): number {
  const oa = state.teams[a]?.ratings.overall ?? 75;
  const ob = state.teams[b]?.ratings.overall ?? 75;
  return winProbability(oa, ob, venue);
}

/** Wild Card round pairing (1-seed bye; 2v7, 3v6, 4v5) — pure, no RNG. */
function wcMatchupsFor(conf: "AFC" | "NFC", seeds: string[], state: LeagueState): BracketMatchup[] {
  const pair = (hi: number, lo: number): BracketMatchup => ({
    round: "WC",
    conference: conf,
    highSeed: { code: seeds[hi - 1]!, seed: hi },
    lowSeed: { code: seeds[lo - 1]!, seed: lo },
    favoredWinProb: favProb(state, seeds[hi - 1]!, seeds[lo - 1]!),
    homeScore: null,
    awayScore: null,
    winner: null,
  });
  return [
    {
      round: "WC",
      conference: conf,
      highSeed: { code: seeds[0]!, seed: 1 },
      lowSeed: null,
      favoredWinProb: 100,
      homeScore: null,
      awayScore: null,
      winner: seeds[0]!, // bye auto-advances
    },
    pair(2, 7),
    pair(3, 6),
    pair(4, 5),
  ];
}

const engConfToUi = (c: string): "AFC" | "NFC" | "SB" => (c === "NFL" ? "SB" : (c as "AFC" | "NFC"));

/**
 * How long to stop calling the adapter after it refuses a connection.
 *
 * Without this, every single call retried: a season is ~20 `simulateWeek`
 * round-trips, so playing with no adapter running (the standalone build's
 * normal state) filled the console with hundreds of identical
 * ERR_CONNECTION_REFUSED lines and made anything else in there unreadable.
 * Short enough that starting `npm run server` mid-session is picked up
 * without a reload.
 */
const ADAPTER_RETRY_MS = 30_000;

export class HybridSimulationService implements SimulationService {
  private readonly http = new HttpSimulationService();
  private readonly mock = new MockSimulationService();
  private baseline: SchemeFitBaseline | null = null;
  private baselineRequested = false;
  /** epoch ms before which the adapter is assumed still unreachable */
  private adapterDownUntil = 0;

  /** Runs `real` against the adapter, falling back to Mock — and remembers a
   *  refusal for `ADAPTER_RETRY_MS` instead of retrying on the next call. */
  private async viaAdapter<T>(real: () => Promise<T>, fallback: () => T | Promise<T>): Promise<T> {
    if (Date.now() < this.adapterDownUntil) return fallback();
    try {
      const out = await real();
      this.adapterDownUntil = 0;
      return out;
    } catch {
      this.adapterDownUntil = Date.now() + ADAPTER_RETRY_MS;
      return fallback();
    }
  }

  async generateInitialPool(seed: number, mode: "fantasyPool" | "realRosters"): Promise<Player[]> {
    if (mode === "fantasyPool") return this.mock.generateInitialPool(seed, mode);
    return this.viaAdapter(
      () => this.http.generateInitialPool(),
      () => this.mock.generateInitialPool(seed, mode),
    );
  }

  async generateCoachMarket(seed: number): Promise<Coach[]> {
    return this.viaAdapter(async () => {
      const { real, generated } = await this.http.generateCoachMarket(seed);
      const rng = new Rng(seed ^ 0x2222);
      let cid = 0;
      const toCoach = (c: RawCoachCandidate): Coach => {
        const id = `c_${++cid}`;
        const name = c.name ?? fullPersonName(rng);
        const base = { id, name, role: c.role as CoachRole, team: null, contract: null };
        if (c.role === "HC") {
          return {
            ...base,
            gameManagement: c.gameManagement,
            discipline: c.discipline,
            // engine aggression is ~[-1,1], centred on the authored mean (~0.17);
            // UI aggressiveness is a 0-99 scale centred on 50.
            aggressiveness: clamp(Math.round(50 + (c.aggression ?? 0) * 100), 1, 99),
          };
        }
        if (c.role === "OC") {
          return {
            ...base,
            scheme: c.scheme as OffenseScheme,
            playCallIq: c.rating,
            // engine passBias ~[-1,1] -> UI's 0-100 pass-rate share, centred ~58
            // (matches Mock's own 48-68 range at passBias's authored extremes).
            tendencyPassRate: clamp(Math.round(58 + (c.passBias ?? 0) * 50), 0, 100),
          };
        }
        return {
          ...base,
          scheme: c.scheme as DefenseScheme,
          playCallIq: c.rating,
          // engine blitzBias ~[-1,1] -> UI's 0-100 blitz-rate share, centred ~30
          // — deliberately allowed to exceed Mock's old 18-42 band: a coach
          // like Brian Flores should read as a real outlier, not clamped flat.
          tendencyBlitzRate: clamp(Math.round(30 + (c.blitzBias ?? 0) * 50), 0, 100),
        };
      };
      return [...real, ...generated].map(toCoach);
    }, () => this.mock.generateCoachMarket(seed));
  }

  async generateSchedule(seed: number, teamCodes: string[]): Promise<ScheduledGame[]> {
    // preseason has no real-engine model — keep Mock's synthetic 3 weeks,
    // splice in the real regular season underneath it.
    const preseason = this.mock.generateSchedule(seed, teamCodes).filter((g) => g.phase === "PRE");
    return this.viaAdapter(
      async () => [...preseason, ...(await this.http.generateSchedule())],
      () => this.mock.generateSchedule(seed, teamCodes),
    );
  }

  generateDraftClass(seed: number, year: number): DraftProspect[] {
    return this.mock.generateDraftClass(seed, year);
  }

  async simulateWeek(state: LeagueState, week: number, phase: "PRE" | "REG"): Promise<GameResult[]> {
    const slate = state.schedule.filter((g) => g.week === week && g.phase === phase);
    if (slate.length === 0) return [];
    return this.viaAdapter(async () => {
      const rosters: Record<string, Player[]> = {};
      for (const t of TEAMS) {
        // an injury has to cost the team the player, or it's just a label on
        // a hub tab — `availableRoster` sits out whoever is out
        rosters[t.code] = availableRoster(
          Object.values(state.players).filter((p) => p.nfl_team === t.code && !p.retired),
        );
      }
      const viewerTeam = state.gms.find((g) => g.id === state.viewerGmId)?.teamCode;
      const viewerGame = slate.find((g) => g.homeTeam === viewerTeam || g.awayTeam === viewerTeam);
      return await this.http.simulateWeek(
        (state.season * 1_000_003) ^ (week * 9176) ^ (phase === "PRE" ? 1 : 2),
        state.season,
        week,
        phase,
        slate,
        rosters,
        viewerGame ? { homeTeam: viewerGame.homeTeam, awayTeam: viewerGame.awayTeam } : null,
        // a GM's depth chart is the only lineup instruction the game takes;
        // the engine sorts by rating unless it's given one
        state.depthChart ?? {},
      );
    }, () => this.mock.simulateWeek(state, week, phase));
  }

  async seedBracket(state: LeagueState): Promise<BracketState> {
    return this.viaAdapter(async () => {
      const regGames = state.games
        .filter((g) => g.phase === "REG" && g.played)
        .map((g) => ({ home: g.homeTeam, away: g.awayTeam, homeScore: g.homeScore, awayScore: g.awayScore }));
      const seeding = await this.http.seedPlayoffs(regGames);
      const matchups = [
        ...wcMatchupsFor("AFC", seeding.AFC.seeds, state),
        ...wcMatchupsFor("NFC", seeding.NFC.seeds, state),
      ];
      return {
        currentRound: "WC",
        seeds: { AFC: seeding.AFC.seeds, NFC: seeding.NFC.seeds },
        matchups,
        champion: null,
      };
    }, () => this.mock.seedBracket(state));
  }

  async simulatePlayoffRound(state: LeagueState, round: PlayoffRound): Promise<BracketState> {
    const bracket = state.bracket;
    if (!bracket) return this.mock.simulatePlayoffRound(state, round);
    return this.viaAdapter(async () => {
      const asRaw = (seeds: string[]): RawConferenceSeeding => ({ seeds, divisionWinners: [], wildCards: [] });
      const roundsPlayed = ROUND_ORDER.indexOf(round);
      const result = await this.http.playoffRound(
        playoffSeed(state),
        { AFC: asRaw(bracket.seeds.AFC), NFC: asRaw(bracket.seeds.NFC) },
        roundsPlayed,
      );

      const matchups = bracket.matchups.map((m) => ({ ...m }));
      for (const g of result.games) {
        const m = matchups.find(
          (x) => x.round === round && x.highSeed?.code === g.home && x.lowSeed?.code === g.away,
        );
        if (m) {
          m.homeScore = g.homeScore;
          m.awayScore = g.awayScore;
          m.winner = g.winner;
        }
      }

      let currentRound = round;
      let champion = bracket.champion;
      if (result.done) {
        champion = result.champion;
      } else if (result.nextRoundPreview) {
        const nextRound = ROUND_ORDER[roundsPlayed + 1]!;
        currentRound = nextRound;
        for (const p of result.nextRoundPreview) {
          matchups.push({
            round: nextRound,
            conference: engConfToUi(p.conference),
            highSeed: { code: p.home, seed: p.homeSeed },
            lowSeed: { code: p.away, seed: p.awaySeed },
            favoredWinProb: favProb(state, p.home, p.away, nextRound === "SB" ? "neutral" : "home"),
            homeScore: null,
            awayScore: null,
            winner: null,
          });
        }
      }
      return { ...bracket, matchups, currentRound, champion };
    }, () => this.mock.simulatePlayoffRound(state, round));
  }

  evaluateTrade(
    state: LeagueState,
    fromTeam: string,
    toTeam: string,
    fromAssets: TradeAsset[],
    toAssets: TradeAsset[],
  ): TradeEvaluation {
    return this.mock.evaluateTrade(state, fromTeam, toTeam, fromAssets, toAssets);
  }

  computeSchemeFit(player: Player, oc: Coach | null, dc: Coach | null): number {
    if (!this.baselineRequested && Date.now() >= this.adapterDownUntil) {
      this.baselineRequested = true;
      this.http
        .schemeFitBaseline()
        .then((b) => {
          this.baseline = b;
        })
        .catch(() => {
          this.adapterDownUntil = Date.now() + ADAPTER_RETRY_MS;
          this.baselineRequested = false; // try again after the cooldown
        });
    }
    if (!this.baseline) return this.mock.computeSchemeFit(player, oc, dc);

    const tags = new Set(player.scheme_tags);
    const dev = (
      scheme: string | undefined,
      table: Record<string, readonly string[]>,
      baselineMap: Record<string, number>,
    ): number => {
      if (!scheme) return 0;
      const list = table[scheme];
      if (!list) return 0;
      const matched = list.some((t) => tags.has(t)) ? 1 : 0;
      return matched - (baselineMap[scheme] ?? 0.4);
    };
    const fit =
      62 +
      dev(oc?.scheme, OFF_SCHEME_TAGS, this.baseline.off) * 40 +
      dev(dc?.scheme, DEF_SCHEME_TAGS, this.baseline.def) * 40 +
      (player.overall - 75) * 0.2;
    return clamp(Math.round(fit), 20, 99);
  }

  retirementOutcomes(seed: number, players: Player[]): RetirementOutcome[] {
    return this.mock.retirementOutcomes(seed, players);
  }

  finalizeSeasonOutcomes(state: LeagueState) {
    return this.mock.finalizeSeasonOutcomes(state);
  }
}
