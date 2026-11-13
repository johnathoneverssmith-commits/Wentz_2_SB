/**
 * COMP-006 driver: plays a whole league through the real stage machine the way GMs press the buttons.
 *
 * - The league is built exactly like the earlier harnesses (createLeague, headless, no DB), with one change: it
 *   starts at `setup` with real rosters (fantasyDraft off), so the first stages played are the coaching draft and the
 *   year-one free-agency market, not only the in-season ones.
 * - Arms: `control` = every team CPU-run (the default). `skilled` = K seats are run by the scripted skilled GM; the
 *   other 28+ stay CPU. `idle` = the same K seats run by an absentee GM (the production autopilot's own choices).
 * - Every action goes through online/src/decide.ts, the functions behind the buttons.
 * - Stages the harness drives are listed in STAGE_LOG; stages it cannot exercise are listed in NOT_EXERCISED.
 */
import type { LeagueState, Player } from "@/domain";
import { TEAMS } from "@/data/teams";
import { MockSimulationService } from "@/sim/MockSimulationService";
import { createLeague, DEFAULT_CONFIG, capUsedOf } from "@/state/seed.ts";
import { syncAiGms } from "@/state/aiGms.ts";
import { emptyReveal } from "@/state/reveal.ts";
import { reconciliationIssues } from "@/state/reconciliation.ts";
import { rosterUnitScore } from "@/state/unitValue.ts";
import { onTheClock as faOnTheClock } from "@/state/freeAgencyEvent.ts";
import { coachingOnTheClock } from "@/state/coachingDraft.ts";
import { runAiPicks, planAutopicks } from "@/state/rules.ts";
import { nextYearCommitments } from "@/state/contracts.ts";
import { REGULAR_SEASON_WEEKS, PRESEASON_WEEKS, FIRST_BLOCK_LAST_WEEK } from "@/state/stageMachine.ts";
import { pendingFor } from "@/state/tradeDeadline.ts";
import {
  decideCoachingPick,
  decideContractMove,
  decideDeadlineTurn,
  decideDraftPick,
  decideFreeAgencyTurn,
  decideGamePlan,
  decideHoodedFigurePayment,
  decideRelease,
  decideReveal,
  decideRevealRound,
  decideRookieOutcome,
  decideSetDepth,
  decideStaffFix,
  decideTrainingCamp,
  runPendingCpuTurns,
} from "../../online/src/decide.js";
import { advanceIfReadyLocal, advanceStage, clearReadinessOnline } from "../../online/src/phases.js";
import * as K from "./skilled.js";
import { ALL_MODULES, type Ctx, type Ledger, type Module } from "./skilled.js";

export type Arm = "control" | "skilled" | "idle";

export interface RunSpec {
  seed: number;
  talent: number;
  arm: Arm;
  seasons: number;
  /** seats (team codes) run by the policy; ignored for `control` */
  seats: string[];
  mods: Module[];
}

/** The stages a pass of the driver visits, for the coverage report. */
export const STAGE_LOG = new Map<string, number>();

/** What this harness does not exercise, stated once and printed into every output file. */
export const NOT_EXERCISED = [
  "Hooded Figure offers: the skilled seats decline (payment 0) if they arrive; the CPU control never receives one",
  "Hot-seat firing/hiring: seats are censored from the first season in which a seat's GM changes team",
  "Restructures and practice-squad moves: not used by the skilled policy (cap relief is by release and trade)",
  "Cross-position depth-chart slots (a safety at corner): lineup is within-position only",
  "Per-opponent game-plan tailoring and the plan-preview tool (160 sims per look): plan is a roster-based tilt only",
  "Coaching-staff changes after the year-one coaching draft (no hiring window is routed in this build)",
  "Multiplayer collusion/fairness: seats never trade with each other; no human-vs-human interaction",
  "Instant signing / ad-hoc trades: refused by the server rules (decideSignFreeAgent / decideProposeTrade throw)",
  "Visual/UI affordances (what a human can *find* on screen); the policy reads the same fields, not the pixels",
];

export function pickSeats(seed: number, k: number): string[] {
  const codes = TEAMS.map((t) => t.code).sort();
  const step = Math.floor(codes.length / k);
  const off = seed % step;
  return Array.from({ length: k }, (_, i) => codes[(off + i * step) % codes.length]!);
}

export function buildLeague(spec: RunSpec): LeagueState {
  const s = createLeague(spec.seed, {
    ...DEFAULT_CONFIG,
    humanGmCount: 1,
    fantasyDraft: false,
    talentImpact: spec.talent >= 2 ? "extreme" : spec.talent >= 1.5 ? "amplified" : "realistic",
    // every round by hand, as a solo GM plays it
    draftHumanRounds: null,
    faHumanRounds: null,
  } as never);
  // identical CPU GM line-up in every arm: seat all 32 CPU GMs first, then (maybe) take seats away
  const template = { ...s.gms[0]! };
  s.gms = [];
  syncAiGms(s);
  const human = spec.arm !== "control";
  s.gms = spec.seats.map((code, i) => ({ ...template, id: i === 0 ? "gm_you" : `seat_${i}`, name: `Seat ${code}`, isHuman: human, teamCode: code }));
  if (human) for (const g of s.gms) s.teams[g.teamCode]!.controlledBy = { kind: "human", gmId: g.id };
  syncAiGms(s);
  s.reveal = emptyReveal();
  clearReadinessOnline(s);
  return s;
}

const humans = (s: LeagueState) => s.gms.filter((g) => g.isHuman && g.teamCode);
const actorOf = (s: LeagueState, team: string) => {
  const gm = s.gms.find((g) => g.isHuman && g.teamCode === team);
  return gm ? { userId: `u_${team}`, leagueId: "comp006", teamCode: team, gmId: gm.id } : null;
};

export interface SeatState {
  team: string;
  ledger: Ledger;
  /** season index (1-based) from which this seat stopped being the same team (hot-seat move), else null */
  censoredFrom: number | null;
}

export interface SeasonRow {
  season: number;
  teams: Record<
    string,
    {
      w: number; l: number; t: number; pf: number; pa: number;
      playoffs: boolean; round: string; champion: boolean;
      /** at the start of the regular season / at the playoffs */
      start: Strength; end: Strength;
    }
  >;
  champion: string | null;
}
export interface Strength {
  overall: number; unitScore: number; top24: number; qb: number; age: number;
  capUsed: number; capTotal: number; dead: number; nextCommit: number; rosterN: number;
}

function strength(s: LeagueState, team: string): Strength {
  const ps = Object.values(s.players).filter((p) => p.nfl_team === team && !p.retired && !p.free_agent);
  const byPos = K.ratingsByPos(ps);
  const top = [...ps].sort((a, b) => b.overall - a.overall).slice(0, 24);
  const qb = byPos.get("QB")?.[0] ?? 0;
  const t = s.teams[team]!;
  return {
    overall: t.ratings.overall,
    unitScore: rosterUnitScore((pos) => byPos.get(pos) ?? []),
    top24: top.reduce((a, p) => a + p.overall, 0) / Math.max(1, top.length),
    qb,
    age: top.reduce((a, p) => a + p.age, 0) / Math.max(1, top.length),
    capUsed: capUsedOf(s, team),
    capTotal: t.cap.total,
    dead: t.cap.dead ?? 0,
    nextCommit: nextYearCommitments(s, team),
    rosterN: ps.length,
  };
}

function furthestRounds(s: LeagueState): Record<string, string> {
  const order = ["WC", "DIV", "CONF", "SB"];
  const out: Record<string, string> = {};
  for (const m of s.bracket?.matchups ?? []) {
    for (const t of [m.highSeed?.code, m.lowSeed?.code]) {
      if (!t) continue;
      const cur = out[t];
      if (!cur || order.indexOf(m.round) > order.indexOf(cur)) out[t] = m.round;
    }
  }
  return out;
}

/** One league-run. Returns per-season rows for all 32 teams and each seat's ledger. */
export function playLeague(spec: RunSpec, onProgress?: (msg: string) => void): { rows: SeasonRow[]; seats: SeatState[]; engineCalls: number; log: string[] } {
  const s = buildLeague(spec);
  const mods = new Set<Module>(spec.mods.length ? spec.mods : ALL_MODULES);
  const seatSet = new Set(spec.arm === "control" ? [] : spec.seats);
  const seats: SeatState[] = spec.seats.map((team) => ({ team, ledger: {}, censoredFrom: null }));
  const ledgerOf = (team: string): Ledger => seats.find((x) => x.team === team)?.ledger ?? {};
  const ctx = (team: string): Ctx => ({ s, team, seats: seatSet, mods, ledger: ledgerOf(team) });
  const skilled = spec.arm === "skilled";
  const rows: SeasonRow[] = [];
  const log: string[] = [];
  const draftedByTeam = new Map<string, Map<string, number>>();
  let seasonIndex = 0;
  let startSnap: Record<string, Strength> | null = null;
  let guard = 0;

  const myTeams = (): string[] => humans(s).map((g) => g.teamCode);

  /** Press "ready" for every seat, the way readyUp does (including the legality gate at the free-agency summaries). */
  const press = (): void => {
    if (spec.arm !== "control") {
      for (const g of humans(s)) {
        if ((s.stage === "freeAgencySummary" || s.stage === "midseasonFreeAgencySummary") && reconciliationIssues(s, g.teamCode).length > 0) {
          if (skilled) {
            // cut one at a time, re-checking: each release changes the cap and the positional minimums
            for (let k = 0; k < 12 && reconciliationIssues(s, g.teamCode).some((i) => /cap/i.test(i.message)); k++) {
              const cut = K.capCuts(ctx(g.teamCode))[0];
              if (!cut) break;
              try { decideRelease(s, actorFor(g.teamCode), cut); K.bump(ledgerOf(g.teamCode), "cap.cuts"); } catch { break; }
            }
          }
          try { decideStaffFix(s, actorOf(s, g.teamCode)!); } catch (e) { log.push(`staffFix refused ${g.teamCode}: ${(e as Error).message}`); }
          K.bump(ledgerOf(g.teamCode), "cap.staffFix");
          if (reconciliationIssues(s, g.teamCode).length > 0) {
            // still illegal: restructure the biggest hits (what a GM does), then give up and record it
            const big = Object.values(s.players).filter((p) => p.nfl_team === g.teamCode && !p.retired && !p.free_agent).sort((a, b) => (b.contract?.cap_hit_by_year[0] ?? 0) - (a.contract?.cap_hit_by_year[0] ?? 0)).slice(0, 6);
            for (const p of big) {
              if (!reconciliationIssues(s, g.teamCode).some((i) => /cap/i.test(i.message))) break;
              try { decideContractMove(s, actorFor(g.teamCode), p.id, { kind: "restructure" }); K.bump(ledgerOf(g.teamCode), "cap.restructure"); } catch { /* not allowed */ }
            }
            if (reconciliationIssues(s, g.teamCode).length > 0) K.bump(ledgerOf(g.teamCode), "cap.stuckReconcile");
          }
        }
        s.readiness[g.id] = true;
      }
    }
    const before = s.stage;
    const out = advanceIfReadyLocal(s);
    if (out.stageMoved && (s.stage as string) === "trainingCampResults") advanceStage(s);
    if (before !== s.stage) STAGE_LOG.set(s.stage, (STAGE_LOG.get(s.stage) ?? 0) + 1);
  };

  const actorFor = (team: string) => actorOf(s, team)!;

  // ------------------------------------------------------------ outcome tallies (audit only; never read by the policy)
  const tallied = new Set<string>();
  const nm = (id: string | undefined): string => {
    const p = id ? s.players[id] : undefined;
    return p ? `${p.position}${p.overall}/${p.age}y` : (id ?? "?");
  };
  const assetStr = (a: { kind: string; playerId?: string | undefined; pick?: { year: number; round: number } | undefined }): string =>
    a.kind === "player" ? nm(a.playerId) : `pick${a.pick!.year}R${a.pick!.round}`;
  const tally = (): void => {
    if (spec.arm === "control") return;
    const seatTeams = new Set(myTeams());
    const d = s.tradeDeadline;
    if (d?.done && !tallied.has(`td${s.season}`)) {
      tallied.add(`td${s.season}`);
      for (const r of d.resolved) {
        if (r.outcome !== "accepted" || r.blocked) continue;
        const f = seatTeams.has(r.fromTeam), to = seatTeams.has(r.toTeam);
        if (!f && !to) continue;
        const seat = f ? r.fromTeam : r.toTeam;
        K.bump(ledgerOf(seat), "trade.executed");
        K.bump(ledgerOf(seat), f ? "trade.executedMine" : "trade.executedTheirs");
        if (log.length < 400) log.push(`S${s.season} TRADE ${r.fromTeam}->${r.toTeam} gives [${r.fromAssets.map(assetStr).join(", ")}] gets [${r.toAssets.map(assetStr).join(", ")}]`);
      }
    }
    const e = s.freeAgencyEvent;
    if (e?.complete && !tallied.has(`fa${s.season}${e.market ?? s.stage}`)) {
      tallied.add(`fa${s.season}${e.market ?? s.stage}`);
      for (const x of e.signed) {
        if (!seatTeams.has(x.teamCode)) continue;
        K.bump(ledgerOf(x.teamCode), "fa.signed");
        K.bump(ledgerOf(x.teamCode), "fa.signedSalary", x.salary);
        if (log.length < 400) log.push(`S${s.season} FA ${x.teamCode} signs ${nm(x.playerId)} $${x.salary}M x${x.years} (${e.market ?? s.stage})`);
      }
    }
  };

  // ------------------------------------------------------------ per-stage human work
  const work = (): void => {
    const stage = s.stage;
    const mine = spec.arm === "control" ? [] : myTeams();
    if (mine.length === 0) return;
    switch (stage) {
      case "coachingDraft": {
        let n = 0;
        while (s.stage === "coachingDraft" && n++ < 400) {
          const on = coachingOnTheClock(s);
          if (on && mine.includes(on)) {
            const pickId = skilled && mods.has("coaching") ? K.coachingPick(ctx(on)) : K.coachingPick(ctx(on));
            if (!pickId) break;
            decideCoachingPick(s, actorFor(on), pickId);
            K.bump(ledgerOf(on), "coach.picks");
          } else if (!runPendingCpuTurns(s)) break;
        }
        return;
      }
      case "freeAgency":
      case "midseasonFreeAgency": {
        let n = 0;
        while ((s.stage === "freeAgency" || s.stage === "midseasonFreeAgency") && s.freeAgencyEvent && !s.freeAgencyEvent.complete && n++ < 400) {
          const on = faOnTheClock(s);
          if (on && mine.includes(on)) {
            const mv = skilled && mods.has("fa") ? K.faTurn(ctx(on)) : { pass: true as const };
            decideFreeAgencyTurn(s, actorFor(on), "pass" in mv ? { pass: true } : { playerId: mv.playerId, salary: mv.salary, years: mv.years });
          } else if (!runPendingCpuTurns(s)) break;
        }
        return;
      }
      case "tradeDeadline": {
        let n = 0;
        while (s.stage === "tradeDeadline" && s.tradeDeadline && !s.tradeDeadline.done && n++ < 400) {
          let acted = false;
          for (const t of mine) {
            const duty = pendingFor(s, t);
            if (!duty) continue;
            const mv: { kind: string; [k: string]: unknown } =
              skilled ? (K.deadlineMove(ctx(t)) as never) : duty === "propose" ? { kind: "skip" } : { kind: "deny" };
            try {
              decideDeadlineTurn(s, actorFor(t), mv as never);
            } catch (e) {
              log.push(`deadline ${t} ${mv.kind} refused: ${(e as Error).message}`);
              K.bump(ledgerOf(t), "trade.refused");
              decideDeadlineTurn(s, actorFor(t), (duty === "propose" ? { kind: "skip" } : { kind: "deny" }) as never);
            }
            acted = true;
            break;
          }
          if (!acted && !runPendingCpuTurns(s)) break;
        }
        return;
      }
      case "offseasonDraft": {
        let n = 0;
        while (s.stage === "offseasonDraft" && s.draft && s.draft.currentPickIndex < s.draft.pickOrder.length && n++ < 600) {
          const t = s.draft.pickOrder[s.draft.currentPickIndex]!;
          if (mine.includes(t)) {
            const taken = new Set(s.draft.results.map((r) => r.selectedId));
            let dm = draftedByTeam.get(t);
            if (!dm) draftedByTeam.set(t, (dm = new Map()));
            let id: string;
            if (skilled && mods.has("draft")) {
              id = K.draftPick(ctx(t), taken as Set<string>, dm);
              const pr = s.draftClass.find((p) => p.id === id)!;
              dm.set(pr.position, (dm.get(pr.position) ?? 0) + 1);
              const l = ledgerOf(t);
              K.bump(l, "draft.pickRound" + Math.ceil(((s.draft.currentPickIndex + 1) / s.draft.pickOrder.length) * 7));
            } else {
              id = planAutopicks(s)[0]!;
            }
            decideDraftPick(s, actorFor(t), id);
          } else {
            runAiPicks(s);
            if (!(s.stage === "offseasonDraft" && s.draft && s.draft.currentPickIndex < s.draft.pickOrder.length)) break;
            if (!mine.includes(s.draft.pickOrder[s.draft.currentPickIndex]!)) runPendingCpuTurns(s);
          }
        }
        return;
      }
      case "offseasonDraftSummary": {
        for (const t of mine) {
          for (const r of s.draft?.results ?? []) {
            if (r.teamCode !== t || !r.selectedId) continue;
            const pr = s.draftClass.find((d) => d.id === r.selectedId);
            if (!pr || s.rookieOutcomes[pr.id]) continue;
            const sign = skilled && mods.has("draft") ? K.rookieShouldSign(ctx(t), pr) : true;
            try { decideRookieOutcome(s, actorFor(t), pr.id, !sign); K.bump(ledgerOf(t), sign ? "rookie.signed" : "rookie.released"); } catch { /* already settled */ }
          }
          if (skilled && mods.has("cap")) {
            for (const id of K.trimBench(ctx(t))) {
              try { decideRelease(s, actorFor(t), id); K.bump(ledgerOf(t), "cap.benchRelease"); } catch { /* refused */ }
            }
          }
        }
        return;
      }
      case "trainingCamp": {
        for (const t of mine) {
          if (s.trainingCamp?.plans[t]?.submitted) continue;
          if (skilled && mods.has("camp")) {
            try { decideTrainingCamp(s, actorFor(t), K.campPlan(ctx(t))); K.bump(ledgerOf(t), "camp.run"); } catch (e) { log.push(`camp ${t}: ${(e as Error).message}`); }
          }
        }
        return;
      }
      case "hoodedFigureEncounter": {
        for (const t of mine) { try { decideHoodedFigurePayment(s, actorFor(t), 0); K.bump(ledgerOf(t), "figure.declined"); } catch { /* none */ } }
        return;
      }
      case "offseasonDepthChart":
      case "midseasonDepthChart":
      case "preseason":
      case "offseasonRetirement":
      case "tradeDeadlineSummary": {
        for (const t of mine) {
          if (!skilled) continue;
          if (stage === "offseasonDepthChart" || stage === "offseasonRetirement") {
            if (mods.has("contracts")) {
              for (const a of K.contractActions(ctx(t))) {
                try { decideContractMove(s, actorFor(t), a.playerId, a.move as never); K.bump(ledgerOf(t), "contract." + a.move.kind); } catch { K.bump(ledgerOf(t), "contract.refused"); }
              }
            }
          }
          if ((stage === "offseasonDepthChart" || stage === "midseasonDepthChart") && mods.has("lineup")) {
            for (const o of K.depthOrders(ctx(t))) decideSetDepth(s, actorFor(t), o.position as never, o.ids);
            K.bump(ledgerOf(t), "lineup.sets");
          }
          if ((stage === "offseasonDepthChart" || stage === "midseasonDepthChart" || stage === "preseason") && mods.has("plan")) {
            decideGamePlan(s, actorFor(t), K.gamePlan(ctx(t)));
            K.bump(ledgerOf(t), "plan.sets");
          }
        }
        return;
      }
      case "playoffs": {
        for (const t of mine) {
          if (skilled && mods.has("plan") && !s.readiness[s.gms.find((g) => g.teamCode === t)!.id]) {
            decideGamePlan(s, actorFor(t), K.gamePlan(ctx(t)));
          }
        }
        return;
      }
      default:
        return;
    }
  };

  // ------------------------------------------------------------ main loop
  const recordSeason = (): void => {
    const rs = furthestRounds(s);
    const champ = s.bracket?.champion ?? null;
    const row: SeasonRow = { season: s.season, teams: {}, champion: champ };
    for (const code of Object.keys(s.teams)) {
      const t = s.teams[code]!;
      row.teams[code] = {
        w: t.wins, l: t.losses, t: t.ties, pf: t.pointsFor, pa: t.pointsAgainst,
        playoffs: !!rs[code], round: rs[code] ?? "none", champion: champ === code,
        start: startSnap?.[code] ?? strength(s, code), end: strength(s, code),
      };
    }
    rows.push(row);
  };

  let recorded = -1;
  let lastKey = "";
  let stuck = 0;
  const targetSeasons = spec.seasons;
  while (guard++ < 20000) {
    const stage = s.stage;
    // snapshot strength when the regular season opens, and the season's result when the playoffs end
    if (stage === "regularSeason" && !s.tradeDeadline && (!startSnap || (startSnap as never as { _s?: number })._s !== s.season)) {
      startSnap = Object.fromEntries(Object.keys(s.teams).map((c) => [c, strength(s, c)]));
      (startSnap as never as { _s: number })._s = s.season;
    }
    if (stage === "playoffs" && s.bracket?.champion && recorded !== s.season) {
      recordSeason();
      recorded = s.season;
      seasonIndex++;
      onProgress?.(`seed ${spec.seed} ${spec.arm} t${spec.talent}: season ${seasonIndex}/${targetSeasons} done (champ ${s.bracket.champion})`);
      if (seasonIndex >= targetSeasons) break;
    }
    // reveal what a GM must "watch" to move on (the checkpoint doesn't need it, but the screens do it)
    tally();
    work();
    tally();
    // seats: detect GM moving to another team (hot seat)
    if (spec.arm !== "control") {
      for (const sd of seats) {
        if (sd.censoredFrom === null && !s.gms.some((g) => g.isHuman && g.teamCode === sd.team)) sd.censoredFrom = seasonIndex + 1;
      }
    }
    const key = `${s.stage}|${s.week}|${s.season}|${s.draft?.currentPickIndex ?? ""}|${s.freeAgencyEvent ? s.freeAgencyEvent.round + "." + s.freeAgencyEvent.turnIndex : ""}|${s.bracket?.currentRound ?? ""}|${s.games.length}`;
    press();
    const nk = `${s.stage}|${s.week}|${s.season}|${s.draft?.currentPickIndex ?? ""}|${s.freeAgencyEvent ? s.freeAgencyEvent.round + "." + s.freeAgencyEvent.turnIndex : ""}|${s.bracket?.currentRound ?? ""}|${s.games.length}`;
    if (nk === key && nk === lastKey) {
      if (++stuck > 3) {
        // a stage that needs a reveal/step before the gate opens: do what the screen does
        try {
          if (s.stage === "preseason") for (const g of humans(s)) decideReveal(s, actorFor(g.teamCode), PRESEASON_WEEKS);
          else if (s.stage === "regularSeason") for (const g of humans(s)) decideReveal(s, actorFor(g.teamCode), s.week <= FIRST_BLOCK_LAST_WEEK && !s.tradeDeadline ? FIRST_BLOCK_LAST_WEEK : REGULAR_SEASON_WEEKS);
          else if (s.stage === "playoffs") for (const g of humans(s)) { try { decideRevealRound(s, actorFor(g.teamCode)); } catch { /* nothing to watch */ } }
        } catch (e) { log.push(`reveal ${s.stage}: ${(e as Error).message}`); }
        if (stuck > 12) throw new Error(`driver stuck in ${s.stage} week ${s.week} season ${s.season}: ${log.slice(-3).join(" | ")}`);
      }
    } else stuck = 0;
    lastKey = nk;
    // a reveal is cheap and a real GM does it: keep the seats' markers current so nothing gates on them
    if (spec.arm !== "control" && (s.stage === "preseason" || s.stage === "regularSeason") && stuck === 0) {
      // (done lazily above only when stuck; the gate does not need it)
    }
  }
  if (rows.length < targetSeasons) throw new Error(`only ${rows.length}/${targetSeasons} seasons completed (guard ${guard})`);
  return { rows, seats, engineCalls: 0, log };
}
export type { Player };
