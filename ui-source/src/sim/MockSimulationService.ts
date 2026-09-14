/**
 * Seeded, in-browser stand-in for the real engine. Produces plausible — not
 * calibrated — rosters, schedules, box scores, standings and playoff results.
 * Everything is deterministic in the seed so a session replays identically and
 * a later swap to the real engine is comparable.
 */
import {
  ROUND_ORDER,
  type BracketMatchup,
  type BracketState,
  type Coach,
  type CoachRole,
  type DraftProspect,
  type GameResult,
  type InjuryEvent,
  type LeagueState,
  type PlayerGameLine,
  type Player,
  type PlayoffRound,
  type Position,
  type ScheduledGame,
  type ScoringPlay,
  type SeasonOutcome,
  type TeamGameTotals,
  type TradeAsset,
  POSITIONS,
  projectionLabel,
} from "@/domain";
import { TEAMS } from "@/data/teams";

import { fullPersonName, personName, school } from "./names.ts";
import { Rng } from "./rng.ts";
import {
  POSITION_PRIOR,
  RETIREMENT_AGE,
  ROSTER_TEMPLATE,
} from "./roster-template.ts";
import { AGE_BY_POSITION, POSITION_BY_ROUND } from "./draft-history.ts";
import { expectedRookieOverall, rookieOverallSpread } from "./draft-outcomes.ts";
import { futureDiscount } from "@/state/draftPicks.ts";
import {
  DEFENSE_SCHEMES,
  OFFENSE_SCHEMES,
} from "@/domain";
import type {
  RetirementOutcome,
  SimulationService,
  TradeEvaluation,
} from "./SimulationService.ts";

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Equivalent retirement-age *years* an injury type typically costs a career,
 * before severity scaling. Grounded in recent sports-medicine findings
 * (preferred over older sources per the design brief — medical/surgical care
 * has measurably improved outcomes over the last decade):
 *  - Concussion: the largest single-injury effect. Recent-era teams and
 *    players have ended careers early on a documented head-injury history
 *    (Luke Kuechly retiring at 28 in 2019, Andrew Luck the same year) even
 *    when the player was otherwise still productive — this is a durability/
 *    risk-tolerance effect as much as a physical one.
 *  - Knee (stands in for ACL-pattern tears, the dominant "knee" injury):
 *    recent reviews report 82-92% return-to-play, but post-reconstruction
 *    NFL players still show the shortest average post-surgical career
 *    length among major pro sports (~26 months) and a documented
 *    performance decline relative to matched controls — real, but well
 *    short of career-ending for most.
 *  - Shoulder/ankle/hamstring: recoverable soft-tissue/joint injuries with
 *    little documented effect on career length except at high severity.
 * Multiple entries compound with diminishing returns (each additional
 * injury, ranked by its own severity, counts for less) — durability erodes
 * with repeated injuries of any kind, but the effect isn't purely additive.
 */
const INJURY_TYPE_AGE_YEARS: Record<string, number> = {
  concussion: 3.5,
  knee: 2,
  shoulder: 1,
  ankle: 0.8,
  hamstring: 0.5,
};
const INJURY_SEVERITY_MULT: Record<string, number> = {
  significant: 1.3,
  moderate: 0.7,
  minor: 0.3,
};
export function injuryAgeReduction(history: Player["injury_history"]): number {
  if (history.length === 0) return 0;
  const perInjury = history
    .map((h) => (INJURY_TYPE_AGE_YEARS[h.type] ?? 0.8) * (INJURY_SEVERITY_MULT[h.severity] ?? 0.7))
    .sort((a, b) => b - a);
  return perInjury.reduce((total, effect, i) => total + effect * Math.pow(0.6, i), 0);
}
/** Deep clone that works on immer drafts (structuredClone chokes on the proxy). */
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/**
 * Season-over-season `overall` drift (OQ-4), given a player's *new* age
 * (post-birthday-equivalent, i.e. already incremented for the season about
 * to start) relative to their own `dev_age_threshold`/`decline_age_threshold`
 * (set once at player creation - see `RETIREMENT_AGE`/dev-age generation
 * above). Three phases:
 *  - developing (age < dev threshold): growth, biggest while furthest from
 *    the threshold (the common "year 2/3 leap", tapering as a player
 *    approaches their prime).
 *  - prime (dev <= age < decline): a small random walk around flat.
 *  - decline (age >= decline threshold): loss that accelerates the further
 *    past the threshold a player is.
 * Same v0 caveat as the engine's own `AGING_CURVES`
 * (`src/model/positions.ts`): a plausible shape, not fit to real
 * year-over-year rating deltas (no reliable public dataset of that for a
 * heuristic 0-99 rating scale) - tracked as OQ-4 in docs/decisions.md.
 */
export function agingDelta(rng: Rng, age: number, devAge: number, declineAge: number): number {
  if (age < devAge) {
    const yearsToGo = Math.max(1, devAge - age);
    const growth = clamp(rng.normal(3, 1.5), 0, 7);
    return Math.round(yearsToGo >= 3 ? growth : growth * 0.6);
  }
  if (age < declineAge) {
    return Math.round(clamp(rng.normal(0, 1.2), -2, 2));
  }
  const yearsPast = age - declineAge + 1;
  const loss = clamp(rng.normal(1.5 + yearsPast * 0.8, 1.5), 1, 14);
  return -Math.round(loss);
}

let PID = 0;
const nextPid = () => `p_${String(++PID).padStart(5, "0")}`;

export class MockSimulationService implements SimulationService {
  generateInitialPool(seed: number, mode: "fantasyPool" | "realRosters"): Player[] {
    const rng = new Rng(seed ^ 0x1111);
    const players: Player[] = [];
    // team strength offsets so the league isn't flat
    const teamOffset = new Map(TEAMS.map((t, i) => [t.code, new Rng(seed ^ (i * 7919)).float(-6, 6)]));

    for (const team of TEAMS) {
      const off = teamOffset.get(team.code)!;
      for (const slot of ROSTER_TEMPLATE) {
        const depth = [...Array(slot.count).keys()];
        for (const d of depth) {
          const starterBoost = d < slot.starters ? 6 : d === slot.starters ? 0 : -6 - d * 2;
          const base = POSITION_PRIOR[slot.pos] + off + starterBoost + rng.normal(0, 4);
          const overall = clamp(Math.round(base), 52, 99);
          players.push(this.buildPlayer(rng, slot.pos, overall, team.code, mode));
        }
      }
    }
    return players;
  }

  private buildPlayer(
    rng: Rng,
    pos: Position,
    overall: number,
    team: string,
    _mode: "fantasyPool" | "realRosters",
  ): Player {
    const age = clamp(Math.round(22 + rng.normal(4, 3)), 21, 38);
    const yearsPro = clamp(age - 22 + rng.int(-1, 1), 0, 17);
    const devAge = 24 + rng.int(-1, 2);
    const declineAge = Math.max(devAge, RETIREMENT_AGE[pos] - rng.int(2, 6));

    const attrKeys = ATTR_KEYS[pos];
    const attributes: Record<string, number> = {};
    for (const k of attrKeys) {
      attributes[k] = clamp(Math.round(overall + rng.normal(0, 6)), 40, 99);
    }
    attributes.speed = clamp(Math.round(SPEED_BASE[pos] + rng.normal(0, 4)), 45, 99);
    attributes.strength = clamp(Math.round(STRENGTH_BASE[pos] + rng.normal(0, 5)), 45, 99);
    attributes.awareness = clamp(Math.round(overall + rng.normal(0, 5)), 40, 99);

    const capHit = round1(contractValueFor(overall, pos) * rng.float(0.7, 1.3));
    // staggered so roughly a fifth of the league reaches free agency each year
    const years = rng.int(2, 5);
    const injured = rng.bool(0.06);

    return {
      id: nextPid(),
      name: personName(rng),
      position: pos,
      age,
      nfl_team: team,
      years_pro: yearsPro,
      overall,
      attributes,
      scheme_tags: [rng.pick(OFFENSE_SCHEMES), rng.pick(DEFENSE_SCHEMES)].slice(0, rng.int(1, 2)),
      dev_age_threshold: devAge,
      decline_age_threshold: declineAge,
      injury_history:
        rng.bool(0.3)
          ? [
              {
                season: 2020 + rng.int(0, 5),
                type: rng.pick(["hamstring", "ankle", "knee", "shoulder", "concussion"]),
                severity: rng.pick(["minor", "moderate", "significant"]),
                weeks_out: rng.int(1, 10),
              },
            ]
          : [],
      contract: {
        team_id: team,
        years_remaining: years,
        total_value: round1(capHit * years),
        guaranteed: round1(capHit * years * rng.float(0.3, 0.8)),
        cap_hit_by_year: [...Array(years)].map((_, i) => round1(capHit * (1 + i * 0.08))),
        signing_bonus: round1(capHit * rng.float(0.2, 0.6)),
      },
      free_agent: false,
      injury_status: injured
        ? {
            status: rng.pick(["questionable", "doubtful", "out"]),
            weeks_out_est: [rng.int(1, 2), rng.int(2, 6)],
            description: rng.pick(["hamstring", "ankle", "knee sprain", "shoulder"]),
          }
        : null,
      retired: false,
      retirement_status: "active",
      season_stats: { gamesPlayed: 0 },
      scheme_fit: clamp(Math.round(60 + rng.normal(0, 15)), 20, 99),
    };
  }

  generateCoachMarket(seed: number): Coach[] {
    const rng = new Rng(seed ^ 0x2222);
    const out: Coach[] = [];
    let cid = 0;
    const make = (role: CoachRole, team: string | null): Coach => {
      const c: Coach = {
        id: `c_${++cid}`,
        name: fullPersonName(rng),
        role,
        team,
        contract: team ? { yearsRemaining: rng.int(1, 4), annualValue: round1(rng.float(2, 9)) } : null,
      };
      if (role === "HC") {
        c.discipline = rng.int(55, 95);
        c.gameManagement = rng.int(55, 95);
        c.aggressiveness = rng.int(40, 95);
      } else {
        c.scheme = role === "OC" ? rng.pick(OFFENSE_SCHEMES) : rng.pick(DEFENSE_SCHEMES);
        c.playCallIq = rng.int(55, 95);
        if (role === "OC") c.tendencyPassRate = rng.int(48, 68);
        else c.tendencyBlitzRate = rng.int(18, 42);
      }
      return c;
    };
    // one filled staff per team + an open market
    for (const t of TEAMS) {
      out.push(make("HC", t.code), make("OC", t.code), make("DC", t.code));
    }
    for (let i = 0; i < 8; i++) out.push(make("HC", null));
    for (let i = 0; i < 10; i++) out.push(make("OC", null));
    for (let i = 0; i < 10; i++) out.push(make("DC", null));
    return out;
  }

  generateSchedule(seed: number, teamCodes: string[]): ScheduledGame[] {
    const rng = new Rng(seed ^ 0x3333);
    const games: ScheduledGame[] = [];

    // preseason: 3 weeks, everyone plays, no byes
    for (let w = 1; w <= 3; w++) {
      const shuffled = rng.shuffle(teamCodes);
      for (let i = 0; i + 1 < shuffled.length; i += 2) {
        games.push({ week: w, phase: "PRE", homeTeam: shuffled[i]!, awayTeam: shuffled[i + 1]! });
      }
    }

    // regular season: 18 weeks; bye weeks 6–13, 4 teams per bye week
    const byeWeek = new Map(teamCodes.map((c, i) => [c, 6 + (i % 8)]));
    for (let w = 1; w <= 18; w++) {
      const playing = rng.shuffle(teamCodes.filter((c) => byeWeek.get(c) !== w));
      for (let i = 0; i + 1 < playing.length; i += 2) {
        const home = w % 2 === 0 ? playing[i]! : playing[i + 1]!;
        const away = w % 2 === 0 ? playing[i + 1]! : playing[i]!;
        games.push({ week: w, phase: "REG", homeTeam: home, awayTeam: away });
      }
    }
    return games;
  }

  generateDraftClass(seed: number, year: number): DraftProspect[] {
    const rng = new Rng(seed ^ (0x4444 + year));
    const n = 224; // 7 rounds × 32
    const notes = [
      "Explosive first step but the tape is streaky against top competition.",
      "Polished technician; questions about the athletic ceiling at the next level.",
      "High-motor player whose production outpaced his testing numbers.",
      "Tools are obvious — the consistency and processing speed are not.",
      "Scheme-specific fit who could be a star in the right system or a backup in the wrong one.",
      "Dominated a weak conference; the projection depends entirely on who you ask.",
      "Injury history clouds an otherwise first-round grade.",
      "Late riser whose senior tape looks nothing like his junior tape.",
    ];
    const out: DraftProspect[] = [];
    for (let i = 0; i < n; i++) {
      // the slot this prospect nominally fills, pre-jitter - real draft-class
      // position mix (2018-2026 PFR data) is round-dependent (see
      // draft-history.ts), e.g. almost no kickers/punters in rounds 1-2.
      const slotRound = clamp(Math.ceil((i + 1) / 32), 1, 7);
      const roundDist = POSITION_BY_ROUND[slotRound]!;
      const pos = rng.weighted(POSITIONS, POSITIONS.map((p) => roundDist[p]));
      // a prospect's *projected* slot wobbles around its board position
      const projPick = clamp(Math.round(i + 1 + rng.normal(0, 8)), 1, 260);
      const projectedRound = clamp(Math.ceil(projPick / 32), 1, 7);
      // The college grade tracks where the board *thinks* he goes; it's a
      // college-production number, which is why it runs high.
      const collegeOverall = clamp(Math.round(92 - projPick * 0.14 + rng.normal(0, 4)), 55, 96);
      // What he actually is as a rookie comes off the measured curve in
      // `draft-outcomes.ts` — 3,562 real picks, 2006-2019, by weighted career
      // Approximate Value — not the reasoned-at guess this used to be. The
      // spread widens down the board the way the real data does: a top-ten
      // pick is a fairly known quantity and a seventh-rounder is a lottery
      // ticket, which is the entire reason scouting is a job.
      const boardSlot = i + 1;
      const trueOverall = clamp(
        Math.round(
          expectedRookieOverall(boardSlot) + rng.normal(0, rookieOverallSpread(boardSlot)),
        ),
        40,
        92,
      );
      const ageDist = AGE_BY_POSITION[pos];
      out.push({
        id: `d${year}_${i + 1}`,
        name: personName(rng),
        position: pos,
        school: school(rng),
        age: clamp(Math.round(rng.normal(ageDist.mean, ageDist.stdev)), 20, 26),
        heightIn: 68 + rng.int(0, 10),
        weightLb: 185 + rng.int(0, 130),
        fortyTime: pos === "K" || pos === "P" ? null : round1(4.3 + rng.float(0, 1.1)),
        classYear: rng.pick(["Junior", "Senior", "Senior", "Sophomore"]),
        collegeOverall,
        projectedRound,
        projectedRange: projectionLabel(projPick),
        scoutingNote: rng.pick(notes),
        trueOverall,
      });
    }
    return out;
  }

  simulateWeek(state: LeagueState, week: number, phase: "PRE" | "REG"): GameResult[] {
    const rng = new Rng((state.season * 1_000_003) ^ (week * 9176) ^ (phase === "PRE" ? 1 : 2));
    const slate = state.schedule.filter((g) => g.week === week && g.phase === phase);
    return slate.map((g, i) =>
      this.simGame(new Rng(rng.int(1, 2 ** 30) + i), state, g.homeTeam, g.awayTeam, week, phase),
    );
  }

  private teamOverall(state: LeagueState, code: string): number {
    return state.teams[code]?.ratings.overall ?? 75;
  }

  private simGame(
    rng: Rng,
    state: LeagueState,
    home: string,
    away: string,
    week: number,
    phase: GameResult["phase"],
  ): GameResult {
    const hOvr = this.teamOverall(state, home);
    const aOvr = this.teamOverall(state, away);
    const edge = (hOvr - aOvr) * 0.5 + 2.2; // home-field
    const hPts = clamp(Math.round(rng.normal(22 + edge * 0.5, 10)), 0, 59);
    const aPts = clamp(Math.round(rng.normal(22 - edge * 0.5, 10)), 0, 59);
    const [homeScore, awayScore] =
      hPts === aPts ? [hPts + (rng.bool() ? 3 : 0), aPts] : [hPts, aPts];

    const totals = {
      home: this.teamTotals(rng, homeScore),
      away: this.teamTotals(rng, awayScore),
    };
    const playerLines = {
      home: this.teamLines(rng, state, home, homeScore),
      away: this.teamLines(rng, state, away, awayScore),
    };
    return {
      id: `${state.season}-${phase}-${week}-${home}-${away}`,
      week,
      phase,
      homeTeam: home,
      awayTeam: away,
      played: true,
      homeScore,
      awayScore,
      totals,
      scoringPlays: this.scoringPlays(rng, home, away, homeScore, awayScore),
      playerLines,
      injuries: [...this.injuriesFor(rng, state, home), ...this.injuriesFor(rng, state, away)],
    };
  }

  /**
   * A rough stand-in for the engine's per-play injury hazard, so the fallback
   * path has injuries too. Without it the hub's Injuries tab and the whole
   * injury-history input to retirement went dark whenever the adapter wasn't
   * running — which is the standalone build's normal state.
   */
  private injuriesFor(rng: Rng, state: LeagueState, team: string): InjuryEvent[] {
    // ~0.55 per team-game, which is the right order for a 53-man roster
    if (rng.float(0, 1) > 0.42) return [];
    const roster = Object.values(state.players).filter(
      (p) => p.nfl_team === team && !p.retired && !p.injury_status,
    );
    const p = roster[rng.int(0, Math.max(0, roster.length - 1))];
    if (!p) return [];
    const severity = rng.weighted(
      ["minor", "moderate", "significant", "severe", "season"] as const,
      [50, 28, 14, 6, 2],
    );
    const weeks: Record<string, [number, number]> = {
      minor: [1, 1], moderate: [2, 4], significant: [4, 8], severe: [8, 14], season: [17, 17],
    };
    const bodyPart = rng.pick(["hamstring", "ankle", "knee", "shoulder", "concussion", "groin"]);
    return [
      {
        team,
        playerId: p.id,
        player: p.name,
        position: p.position,
        slot: p.position,
        quarter: rng.int(1, 4),
        clock: "0:00",
        bodyPart,
        suspectedType: bodyPart,
        severity,
        projectedWeeks: weeks[severity]!,
        mechanism: "contact",
        onPlay: "",
        narrative: `${p.name} left the game with a ${bodyPart} injury.`,
      },
    ];
  }

  private teamTotals(rng: Rng, points: number): TeamGameTotals {
    const pass = clamp(Math.round(rng.normal(230, 55)), 90, 430);
    const rush = clamp(Math.round(rng.normal(110, 35)), 20, 240);
    const q = [0, 0, 0, 0];
    let left = points;
    for (let i = 0; i < 4 && left > 0; i++) {
      const s = Math.min(left, rng.pick([0, 0, 3, 7, 7, 10, 14]));
      q[i] = s;
      left -= s;
    }
    if (left > 0) q[3] += left;
    return {
      points,
      totalYards: pass + rush,
      passYards: pass,
      rushYards: rush,
      plays: clamp(Math.round(rng.normal(63, 7)), 45, 85),
      thirdDownMade: rng.int(3, 9),
      thirdDownAtt: rng.int(10, 16),
      topSeconds: clamp(Math.round(rng.normal(1800, 220)), 1200, 2400),
      penalties: rng.int(2, 9),
      penaltyYards: rng.int(15, 85),
      turnovers: rng.int(0, 4),
      byQuarter: q,
    };
  }

  private starters(state: LeagueState, code: string, pos: Position, n: number): Player[] {
    return Object.values(state.players)
      .filter((p) => p.nfl_team === code && p.position === pos && !p.retired)
      .sort((a, b) => b.overall - a.overall)
      .slice(0, n);
  }

  private teamLines(rng: Rng, state: LeagueState, code: string, points: number): PlayerGameLine[] {
    const lines: PlayerGameLine[] = [];
    const tds = Math.floor(points / 7);
    const [qb] = this.starters(state, code, "QB", 1);
    const rbs = this.starters(state, code, "RB", 2);
    const wrs = this.starters(state, code, "WR", 3);
    const tes = this.starters(state, code, "TE", 1);
    const [k] = this.starters(state, code, "K", 1);

    const passYds = clamp(Math.round(rng.normal(240, 60)), 90, 430);
    const att = rng.int(26, 42);
    const passTd = clamp(rng.int(0, tds), 0, 4);
    if (qb) {
      lines.push({
        playerId: qb.id, name: qb.name, position: "QB",
        passCmp: Math.round(att * rng.float(0.55, 0.72)), passAtt: att,
        passYds, passTd, passInt: rng.int(0, 2),
        rushAtt: rng.int(1, 5), rushYds: rng.int(-2, 28), rushTd: 0,
      });
    }
    let rushTdLeft = Math.max(0, tds - passTd);
    for (const rb of rbs) {
      const a = rng.int(6, 20);
      const rtd = rushTdLeft > 0 && rng.bool(0.6) ? 1 : 0;
      rushTdLeft -= rtd;
      lines.push({
        playerId: rb.id, name: rb.name, position: "RB",
        rushAtt: a, rushYds: clamp(Math.round(a * rng.float(2.8, 5.2)), -3, 180), rushTd: rtd,
        rec: rng.int(0, 5), recYds: rng.int(0, 45), recTd: 0,
      });
    }
    let recTdLeft = passTd;
    for (const wr of [...wrs, ...tes]) {
      const r = rng.int(1, 9);
      const rtd = recTdLeft > 0 && rng.bool(0.5) ? 1 : 0;
      recTdLeft -= rtd;
      lines.push({
        playerId: wr.id, name: wr.name, position: wr.position,
        rec: r, recYds: clamp(Math.round(r * rng.float(8, 17)), 0, 190), recTd: rtd,
      });
    }
    if (k) {
      const fga = rng.int(1, 4);
      lines.push({
        playerId: k.id, name: k.name, position: "K",
        fgm: rng.int(0, fga), fga, xpm: Math.max(0, tds - 0), xpa: tds,
      });
    }
    // a few defenders
    for (const pos of ["EDGE", "ILB", "CB", "S"] as Position[]) {
      for (const d of this.starters(state, code, pos, 1)) {
        lines.push({
          playerId: d.id, name: d.name, position: pos,
          tackles: rng.int(2, 11),
          sacks: pos === "EDGE" ? rng.pick([0, 0, 1, 1, 2]) : rng.pick([0, 0, 0, 1]),
          defInt: rng.pick([0, 0, 0, 1]),
          passDef: rng.int(0, 3),
        });
      }
    }
    return lines;
  }

  private scoringPlays(
    rng: Rng, home: string, away: string, hs: number, as: number,
  ): ScoringPlay[] {
    const plays: ScoringPlay[] = [];
    let h = 0;
    let a = 0;
    const steps: Array<{ team: string; pts: number }> = [];
    const build = (total: number, team: string) => {
      let left = total;
      while (left > 0) {
        const p = left >= 7 && rng.bool(0.7) ? 7 : left >= 3 ? 3 : left;
        steps.push({ team, pts: p });
        left -= p;
      }
    };
    build(hs, home);
    build(as, away);
    for (const s of rng.shuffle(steps)) {
      if (s.team === home) h += s.pts;
      else a += s.pts;
      const kind = s.pts === 7 ? "TD" : s.pts === 3 ? "FG" : "score";
      plays.push({
        quarter: clamp(Math.ceil((plays.length + 1) / Math.max(1, Math.ceil(steps.length / 4))), 1, 4),
        team: s.team,
        description:
          kind === "TD"
            ? `${personName(rng)} ${rng.int(1, 45)} yd TD ${rng.bool() ? "pass" : "run"}`
            : kind === "FG"
              ? `${personName(rng)} ${rng.int(22, 54)} yd FG`
              : "Safety",
        homeScore: h,
        awayScore: a,
      });
    }
    return plays;
  }

  seedBracket(state: LeagueState): BracketState {
    const bySeed = (conf: "AFC" | "NFC") =>
      TEAMS.filter((t) => t.conference === conf)
        .map((t) => t.code)
        .sort((x, y) => {
          const a = state.teams[x]!;
          const b = state.teams[y]!;
          return (
            b.wins - a.wins ||
            b.pointsFor - b.pointsAgainst - (a.pointsFor - a.pointsAgainst)
          );
        })
        .slice(0, 7);
    const seeds = { AFC: bySeed("AFC"), NFC: bySeed("NFC") };
    return {
      currentRound: "WC",
      seeds,
      matchups: [...wcMatchups("AFC", seeds.AFC, state), ...wcMatchups("NFC", seeds.NFC, state)],
      champion: null,
    };
  }

  simulatePlayoffRound(state: LeagueState, round: PlayoffRound): BracketState {
    const b = clone(state.bracket!) as BracketState;
    const rng = new Rng((state.season * 31) ^ ROUND_ORDER.indexOf(round));
    const live = b.matchups.filter((m) => m.round === round && m.winner == null);
    for (const m of live) {
      if (!m.highSeed || !m.lowSeed) {
        // #1-seed bye
        m.winner = m.highSeed?.code ?? m.lowSeed?.code ?? null;
        continue;
      }
      const hi = this.teamOverall(state, m.highSeed.code);
      const lo = this.teamOverall(state, m.lowSeed.code);
      const pHigh = clamp(0.5 + (hi - lo) * 0.02 + 0.04, 0.1, 0.9);
      m.favoredWinProb = Math.round(pHigh * 100);
      const highWins = rng.bool(pHigh);
      const winScore = rng.int(20, 34);
      const loseScore = rng.int(10, winScore - 1);
      m.homeScore = highWins ? winScore : loseScore;
      m.awayScore = highWins ? loseScore : winScore;
      m.winner = highWins ? m.highSeed.code : m.lowSeed.code;
    }
    // advance
    const next = ROUND_ORDER[ROUND_ORDER.indexOf(round) + 1] as PlayoffRound | undefined;
    if (round === "SB") {
      b.champion = b.matchups.find((m) => m.round === "SB")?.winner ?? null;
    } else if (next) {
      b.currentRound = next;
      b.matchups.push(...buildNextRound(next, b, state));
    }
    return b;
  }

  evaluateTrade(
    state: LeagueState,
    _fromTeam: string,
    toTeam: string,
    fromAssets: TradeAsset[],
    toAssets: TradeAsset[],
  ): TradeEvaluation {
    const val = (a: TradeAsset) => {
      if (a.kind === "player") {
        const p = state.players[a.playerId ?? ""];
        const base = Math.pow(clamp(p?.overall ?? 60, 40, 99) - 40, 1.7) / 12;
        return base * (p ? (POSITION_VALUE[p.position] ?? 1) : 1);
      }
      const round = a.pick?.round ?? 4;
      const raw = PICK_VALUE_BY_ROUND[round] ?? PICK_VALUE_BY_ROUND[7]!;
      // and a pick two drafts away is worth less than the same pick this year
      return a.pick ? raw * futureDiscount(a.pick, state.season) : raw;
    };
    // fromAssets: what the proposer (fromTeam, usually the viewer) gives up —
    // toTeam (the AI being asked to accept) receives these.
    // toAssets: what toTeam gives up in return.
    const out = fromAssets.reduce((s, a) => s + val(a), 0);
    const inn = toAssets.reduce((s, a) => s + val(a), 0);
    // kept as pure value math, positive = good for the proposer — this is
    // the number the trade screen displays ("AI value delta ... for you"),
    // so it should read as a plain value comparison, not something the need
    // adjustment below (which only drives the AI's actual decision) muddies.
    const delta = round1(inn - out);

    // OQ-9: the AI's real interest in a trade isn't just raw value — a
    // player who fills an actual hole on toTeam's roster is worth more to
    // them than his overall alone says, and a player leaving a position
    // toTeam is already thin at costs them more than his overall says.
    const needAt = (team: string, pos: Position | undefined, exclude: ReadonlySet<string>): number => {
      if (!pos) return 0;
      const best = Object.values(state.players)
        .filter((p) => p.nfl_team === team && p.position === pos && !p.retired && !exclude.has(p.id))
        .reduce((m, p) => Math.max(m, p.overall), 0);
      return Math.max(1, 78 - (best || 40));
    };
    // what toTeam is receiving: need measured on their roster as it stands now
    const needGained = fromAssets.reduce(
      (s, a) => s + (a.kind === "player" ? needAt(toTeam, state.players[a.playerId ?? ""]?.position, new Set()) : 0),
      0,
    );
    // what toTeam is giving away: need measured on their roster *after* every
    // departing player leaves — losing your only starter at a position should
    // read as a real cost even if he's individually a good player.
    const departingIds = new Set(toAssets.flatMap((a) => (a.kind === "player" && a.playerId ? [a.playerId] : [])));
    const needLost = toAssets.reduce(
      (s, a) => s + (a.kind === "player" ? needAt(toTeam, state.players[a.playerId ?? ""]?.position, departingIds) : 0),
      0,
    );

    return {
      valueDelta: delta,
      // acceptLikelihood is the AI's (toTeam's) own willingness — falls as the
      // deal favors the proposer more (-delta/40), rises when the incoming
      // players address a real need, falls when the outgoing ones leave one.
      acceptLikelihood: clamp(0.5 - delta / 40 + (needGained - needLost) / 60, 0.02, 0.98),
    };
  }

  computeSchemeFit(player: Player, oc: Coach | null, dc: Coach | null): number {
    const tags = new Set(player.scheme_tags);
    let fit = 62;
    if (oc?.scheme && tags.has(oc.scheme)) fit += 18;
    if (dc?.scheme && tags.has(dc.scheme)) fit += 18;
    return clamp(Math.round(fit + (player.overall - 75) * 0.2), 20, 99);
  }

  retirementOutcomes(seed: number, players: Player[]): RetirementOutcome[] {
    const rng = new Rng(seed ^ 0x5555);
    const out: RetirementOutcome[] = [];
    for (const p of players) {
      const baseNorm = RETIREMENT_AGE[p.position];
      const reduction = injuryAgeReduction(p.injury_history);
      const norm = baseNorm - reduction;
      const over = p.age - norm;
      const pRetire = clamp(0.02 + Math.max(0, over) * 0.16, 0, 0.95);
      if (p.age >= norm - 2 || p.injury_history.length >= 2) {
        const retiring = rng.bool(pRetire);
        out.push({
          playerId: p.id,
          decision: retiring ? "retiring" : "returning",
          reason: retiring
            ? `Age ${p.age} vs ${p.position} norm ${baseNorm}${
                reduction >= 0.5 ? ` (effective ${norm.toFixed(1)} after injury history)` : ""
              }${p.injury_history.length ? `, ${p.injury_history.length} prior injuries` : ""}`
            : `Age ${p.age}, wants another year`,
        });
      }
    }
    return out;
  }


  finalizeSeasonOutcomes(state: LeagueState): SeasonOutcome[] {
    const bracket = state.bracket;
    return state.gms
      .filter((g) => g.isHuman && state.teams[g.teamCode])
      .map((g) => {
        const t = state.teams[g.teamCode]!;
        const madePlayoffs =
          !!bracket &&
          (bracket.seeds.AFC.includes(g.teamCode) || bracket.seeds.NFC.includes(g.teamCode));
        const seed = madePlayoffs
          ? [...bracket!.seeds.AFC, ...bracket!.seeds.NFC].indexOf(g.teamCode) % 7 + 1
          : 0;
        let furthest: SeasonOutcome["furthestRound"] = "none";
        let elimMargin: number | null = null;
        const rivalsEliminated: string[] = [];
        if (madePlayoffs && bracket) {
          for (const r of ROUND_ORDER) {
            const m = bracket.matchups.find(
              (x) =>
                x.round === r &&
                (x.highSeed?.code === g.teamCode || x.lowSeed?.code === g.teamCode),
            );
            if (!m || m.winner == null) break;
            if (m.winner === g.teamCode) {
              furthest = r;
              const opp = m.highSeed?.code === g.teamCode ? m.lowSeed?.code : m.highSeed?.code;
              if (opp && state.gms.some((x) => x.isHuman && x.teamCode === opp)) {
                rivalsEliminated.push(opp);
              }
            } else {
              furthest = r;
              elimMargin = Math.abs((m.homeScore ?? 0) - (m.awayScore ?? 0));
              break;
            }
          }
        }
        return {
          season: state.season,
          gmId: g.id,
          teamCode: g.teamCode,
          madePlayoffs,
          seed,
          furthestRound: furthest,
          wonSuperBowl: bracket?.champion === g.teamCode,
          regularSeasonRecord: { wins: t.wins, losses: t.losses, ties: t.ties },
          eliminationMargin: bracket?.champion === g.teamCode ? null : elimMargin,
          pointDifferential: t.pointsFor - t.pointsAgainst,
          rivalsEliminated,
        };
      });
  }
}

/* ---- bracket helpers -------------------------------------------------- */

function wcMatchups(conf: "AFC" | "NFC", seeds: string[], state: LeagueState): BracketMatchup[] {
  // 1-seed bye; 2v7, 3v6, 4v5
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

function favProb(state: LeagueState, a: string, b: string): number {
  const oa = state.teams[a]?.ratings.overall ?? 75;
  const ob = state.teams[b]?.ratings.overall ?? 75;
  return clamp(Math.round((0.5 + (oa - ob) * 0.02) * 100), 10, 90);
}

function buildNextRound(round: PlayoffRound, b: BracketState, state: LeagueState): BracketMatchup[] {
  if (round === "SB") {
    const afc = b.matchups.filter((m) => m.round === "CONF" && m.conference === "AFC")[0]?.winner;
    const nfc = b.matchups.filter((m) => m.round === "CONF" && m.conference === "NFC")[0]?.winner;
    return [
      {
        round: "SB",
        conference: "SB",
        highSeed: afc ? { code: afc, seed: 0 } : null,
        lowSeed: nfc ? { code: nfc, seed: 0 } : null,
        favoredWinProb: afc && nfc ? favProb(state, afc, nfc) : 50,
        homeScore: null,
        awayScore: null,
        winner: null,
      },
    ];
  }
  const out: BracketMatchup[] = [];
  for (const conf of ["AFC", "NFC"] as const) {
    const prev = ROUND_ORDER[ROUND_ORDER.indexOf(round) - 1] as PlayoffRound;
    const winners = b.matchups
      .filter((m) => m.round === prev && m.conference === conf && m.winner)
      .map((m) => ({ code: m.winner!, seed: seedOf(b, conf, m.winner!) }))
      .sort((x, y) => x.seed - y.seed);
    for (let i = 0; i < Math.floor(winners.length / 2); i++) {
      const hi = winners[i]!;
      const lo = winners[winners.length - 1 - i]!;
      out.push({
        round,
        conference: conf,
        highSeed: { code: hi.code, seed: hi.seed },
        lowSeed: { code: lo.code, seed: lo.seed },
        favoredWinProb: favProb(state, hi.code, lo.code),
        homeScore: null,
        awayScore: null,
        winner: null,
      });
    }
  }
  return out;
}

function seedOf(b: BracketState, conf: "AFC" | "NFC", code: string): number {
  return b.seeds[conf].indexOf(code) + 1;
}

/* ---- attribute key tables (mirror engine schema) -------------------- */

const ATTR_KEYS: Record<Position, string[]> = {
  QB: ["throw_power", "throw_accuracy_short", "throw_accuracy_mid", "throw_accuracy_deep", "play_action", "scrambling", "clutch"],
  RB: ["carrying", "break_tackle", "ball_carrier_vision", "juke_move", "catching", "yac"],
  WR: ["catching", "route_running_short", "route_running_mid", "route_running_deep", "release", "catch_in_traffic", "yac"],
  TE: ["catching", "route_running_short", "route_running_mid", "run_block", "pass_block", "catch_in_traffic"],
  OT: ["pass_block", "run_block", "pass_block_power", "pass_block_finesse", "anchor"],
  OG: ["pass_block", "run_block", "pass_block_power", "pass_block_finesse", "anchor"],
  C: ["pass_block", "run_block", "snap_accuracy", "line_calls", "anchor"],
  EDGE: ["power_moves", "finesse_moves", "block_shedding", "pursuit", "tackle", "run_defense", "hit_power"],
  DT: ["power_moves", "finesse_moves", "block_shedding", "pursuit", "tackle", "run_defense"],
  ILB: ["tackle", "block_shedding", "pursuit", "play_recognition", "zone_coverage", "man_coverage", "hit_power", "blitz"],
  OLB: ["tackle", "block_shedding", "pursuit", "play_recognition", "zone_coverage", "blitz"],
  CB: ["man_coverage", "zone_coverage", "press", "play_recognition", "pursuit", "tackle"],
  S: ["zone_coverage", "man_coverage", "tackle", "play_recognition", "pursuit", "hit_power"],
  K: ["kick_power", "kick_accuracy", "clutch"],
  P: ["punt_power", "punt_accuracy", "hang_time", "coffin_corner"],
};

const SPEED_BASE: Record<Position, number> = {
  QB: 78, RB: 90, WR: 92, TE: 80, OT: 62, OG: 60, C: 60,
  EDGE: 84, DT: 72, ILB: 84, OLB: 84, CB: 92, S: 89, K: 55, P: 55,
};
const STRENGTH_BASE: Record<Position, number> = {
  QB: 66, RB: 78, WR: 68, TE: 80, OT: 92, OG: 93, C: 90,
  EDGE: 86, DT: 93, ILB: 84, OLB: 82, CB: 68, S: 74, K: 55, P: 55,
};

/**
 * Positional value multiplier (OQ-6-adjacent) — the real NFL market pays
 * wildly different money for the same `overall` at different positions
 * (2026 reference points: Mahomes-tier QB deals ~$45-50M/yr; Parsons/Micah-
 * tier EDGE and Smith-Njigba-tier WR both into the $40s; top tackles
 * (Sewell, Slater) ~$28-28.5M; RB is the position the market has most
 * visibly devalued this decade). Not a precise econometric fit — no public
 * per-position APY-vs-overall dataset to calibrate against the same way
 * player *ratings* have real stats behind them — but a real, sourced
 * hierarchy beats the previous "every position worth the same" formula.
 * Centred on 1.0 so `contractValueFor`'s existing overall-only curve is the
 * baseline for an average-value position.
 */
/**
 * Draft-pick trade value by round — real per-round *average*, scaled down
 * to the player-value formula's rough magnitude (round 1 ≈ an elite
 * ~90-overall starter). Derived from the Jimmy Johnson chart (the league's
 * long-standing common-language chart for pick trades, still the most
 * widely referenced despite predating modern analytics) — averaged over
 * each round's 32 picks (1: 3000/2: 2600/.../32: 590/33: 580/.../
 * 224: ~1.6, drafttek.com's maintained table) since `DraftPickAsset` only
 * carries a round, not an exact slot. The real chart is heavily convex —
 * round 1 is worth ~2.8x round 2, not the ~1.17x a flat per-round formula
 * implied before — which is the actual, well-documented shape of how NFL
 * teams value draft capital, not just this codebase's old guess.
 */
export const pickTradeValue = (round: number): number =>
  PICK_VALUE_BY_ROUND[round] ?? PICK_VALUE_BY_ROUND[7]!;

const PICK_VALUE_BY_ROUND: Record<number, number> = {
  1: 82.7,
  2: 29.7,
  3: 13.4,
  4: 5.1,
  5: 2.4,
  6: 1.4,
  7: 0.5,
};

export const POSITION_VALUE: Record<Position, number> = {
  QB: 2.2,
  EDGE: 1.35,
  WR: 1.3,
  OT: 1.3,
  CB: 1.15,
  DT: 1.05,
  S: 0.95,
  ILB: 0.9,
  OLB: 0.9,
  TE: 0.85,
  OG: 0.85,
  C: 0.8,
  RB: 0.7,
  K: 0.4,
  P: 0.35,
};

/** $M/year, roughly convex in overall, scaled by position value if given —
 *  also used by store.ts's AI bidding (both for players and, without a
 *  position, for coach salaries off their own skill rating). */
export function contractValueFor(overall: number, position?: Position): number {
  const posMult = position ? (POSITION_VALUE[position] ?? 1) : 1;
  return round1((0.9 + Math.pow(Math.max(0, overall - 55) / 10, 2.2)) * posMult);
}
