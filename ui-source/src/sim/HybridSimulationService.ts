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
 * Everything else delegates straight to `MockSimulationService`, unchanged:
 * - `generateDraftClass` / `evaluateTrade` / `retirementOutcomes` /
 *   `finalizeSeasonOutcomes` — no calibrated engine model yet (see `NOTES.md`).
 * - `seedBracket` / `simulatePlayoffRound` — the engine has real
 *   standings/playoffs logic, but mapping this UI's `BracketState`/`TeamState`
 *   onto it is more plumbing than this pass covers. Flagged as a follow-up,
 *   not silently dropped.
 */
import { TEAMS } from "@/data/teams";
import type {
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

import { HttpSimulationService, type RawCoachCandidate, type SchemeFitBaseline } from "./HttpSimulationService.ts";
import { MockSimulationService } from "./MockSimulationService.ts";
import { fullPersonName } from "./names.ts";
import { Rng } from "./rng.ts";
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

export class HybridSimulationService implements SimulationService {
  private readonly http = new HttpSimulationService();
  private readonly mock = new MockSimulationService();
  private baseline: SchemeFitBaseline | null = null;
  private baselineRequested = false;

  async generateInitialPool(seed: number, mode: "fantasyPool" | "realRosters"): Promise<Player[]> {
    if (mode === "fantasyPool") return this.mock.generateInitialPool(seed, mode);
    try {
      return await this.http.generateInitialPool();
    } catch {
      return this.mock.generateInitialPool(seed, mode);
    }
  }

  async generateCoachMarket(seed: number): Promise<Coach[]> {
    try {
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
    } catch {
      return this.mock.generateCoachMarket(seed);
    }
  }

  async generateSchedule(seed: number, teamCodes: string[]): Promise<ScheduledGame[]> {
    // preseason has no real-engine model — keep Mock's synthetic 3 weeks,
    // splice in the real regular season underneath it.
    const preseason = this.mock.generateSchedule(seed, teamCodes).filter((g) => g.phase === "PRE");
    try {
      const reg = await this.http.generateSchedule();
      return [...preseason, ...reg];
    } catch {
      return this.mock.generateSchedule(seed, teamCodes);
    }
  }

  generateDraftClass(seed: number, year: number): DraftProspect[] {
    return this.mock.generateDraftClass(seed, year);
  }

  async simulateWeek(state: LeagueState, week: number, phase: "PRE" | "REG"): Promise<GameResult[]> {
    const slate = state.schedule.filter((g) => g.week === week && g.phase === phase);
    if (slate.length === 0) return [];
    try {
      const rosters: Record<string, Player[]> = {};
      for (const t of TEAMS) {
        rosters[t.code] = Object.values(state.players).filter(
          (p) => p.nfl_team === t.code && !p.retired,
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
      );
    } catch {
      return this.mock.simulateWeek(state, week, phase);
    }
  }

  simulatePlayoffRound(state: LeagueState, round: PlayoffRound): BracketState {
    return this.mock.simulatePlayoffRound(state, round);
  }

  seedBracket(state: LeagueState): BracketState {
    return this.mock.seedBracket(state);
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
    if (!this.baselineRequested) {
      this.baselineRequested = true;
      this.http
        .schemeFitBaseline()
        .then((b) => {
          this.baseline = b;
        })
        .catch(() => {
          /* stay on Mock's heuristic */
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
