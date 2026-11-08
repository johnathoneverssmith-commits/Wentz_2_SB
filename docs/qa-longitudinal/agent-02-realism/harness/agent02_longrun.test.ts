/**
 * Agent 02 (Simulation Realism) accelerated long run. READ-ONLY w.r.t. gameplay: it only drives the existing
 * online phase machine (real engine games via online/src/blocks.ts) and records what happened.
 *
 * Copy to online/test/_agent02_longrun.test.ts (underscore = excluded from CI) and run:
 *   A02=1 A02_SEED=7001 A02_SEASONS=20 A02_TALENT=amplified A02_OUT=/path/out.jsonl \
 *     npx vitest run --root online test/_agent02_longrun.test.ts
 */
import { describe, it } from "vitest";
import { appendFileSync, writeFileSync } from "node:fs";

import type { LeagueState } from "@/domain";
import { MockSimulationService } from "@/sim/MockSimulationService";
import { createLeague, DEFAULT_CONFIG, fillRosterGaps, recomputeTeamRatings } from "@/state/seed.ts";
import { beginDraft, completeDraft } from "@/state/rules.ts";
import { emptyReveal } from "@/state/reveal.ts";
import { autopilotAbsent, isTurnStage, readyUpLocal } from "../src/phases.js";

const ON = !!process.env.A02;
const SEED = Number(process.env.A02_SEED ?? 7001);
const SEASONS = Number(process.env.A02_SEASONS ?? 20);
const TALENT = (process.env.A02_TALENT ?? "amplified") as "realistic" | "amplified" | "extreme";
const OUT = process.env.A02_OUT ?? `/tmp/a02_${SEED}.jsonl`;
const HUMAN = "KC";
const sim = new MockSimulationService();

function build(): LeagueState {
  const s = createLeague(SEED, { ...DEFAULT_CONFIG, humanGmCount: 1, talentImpact: TALENT });
  s.gms[0]!.teamCode = HUMAN;
  s.gms[0]!.isHuman = true;
  for (let i = 1; i < s.gms.length; i++) s.gms[i]!.isHuman = false;
  beginDraft(s, "fantasy");
  completeDraft(s);
  fillRosterGaps(s);
  recomputeTeamRatings(s);
  s.schedule = sim.generateSchedule(s.season, Object.keys(s.teams));
  s.stage = "preseason";
  s.week = 1;
  s.reveal = emptyReveal();
  return s;
}

const log = (o: unknown) => appendFileSync(OUT, JSON.stringify(o) + "\n");

function playerSnap(s: LeagueState, tag: string) {
  const rows: unknown[] = [];
  for (const p of Object.values(s.players)) {
    rows.push([p.id, p.position, p.age, p.overall, p.nfl_team, p.retired ? 1 : 0, p.free_agent ? 1 : 0, (p as any).potential ?? null, p.contract?.salary ?? null]);
  }
  log({ kind: "players", tag, season: s.season, stage: s.stage, cols: ["id", "pos", "age", "ovr", "team", "retired", "fa", "pot", "salary"], rows });
}

const TOT = ["points", "totalYards", "passYards", "rushYards", "plays", "thirdDownMade", "thirdDownAtt", "topSeconds", "penalties", "penaltyYards", "turnovers", "passAtt", "passComp", "sacksAllowed", "qbHits", "intThrown", "fumblesLost", "krTd", "prTd", "kickPoints"] as const;

function seasonCapture(s: LeagueState) {
  const games = s.games
    .filter((g) => g.played)
    .map((g) => [g.phase, g.week, g.homeTeam, g.awayTeam, g.homeScore, g.awayScore, g.weather ?? "", (g.injuries ?? []).length,
      g.totals ? TOT.map((k) => (g.totals!.home as any)[k] ?? null) : null,
      g.totals ? TOT.map((k) => (g.totals!.away as any)[k] ?? null) : null,
      g.totals ? g.totals.home.byQuarter : null, g.totals ? g.totals.away.byQuarter : null]);
  const inj: unknown[] = [];
  for (const g of s.games) for (const e of g.injuries ?? []) inj.push([g.phase, g.week, e.team, e.playerId, e.position, e.severity, e.projectedWeeks, e.bodyPart]);
  const stats: unknown[] = [];
  for (const p of Object.values(s.players)) {
    const st = (p as any).season_stats;
    if (st && st.gamesPlayed) stats.push([p.id, p.position, p.age, p.overall, p.nfl_team, st]);
  }
  const standings = (s as any).standings ?? null;
  log({ kind: "season", season: s.season, cols: TOT, games, inj, stats, standings, bracket: s.bracket, champion: s.bracket?.champion });
}

function drive(s: LeagueState): void {
  let captured = -1;
  const start = s.season;
  let guard = 0;
  while (s.season < start + SEASONS || s.stage !== "preseason") {
    if (guard++ > 4000) throw new Error(`stuck in ${s.stage} s${s.season} w${s.week}`);
    if (s.bracket?.champion && captured !== s.season) {
      seasonCapture(s);
      playerSnap(s, "post-playoffs");
      captured = s.season;
    }
    if (s.stage === "preseason" && s.week === 1 && !(s as any).__snap?.[s.season]) {
      ((s as any).__snap ??= {})[s.season] = 1;
      playerSnap(s, "preseason");
      log({ kind: "preseason", season: s.season });
      if (s.season >= start + SEASONS) break;
    }
    // the single human GM (KC) is on the server's own autopilot for turn-based events (draft picks etc.)
    if (isTurnStage(s.stage)) autopilotAbsent(s);
    for (const g of s.gms) if (g.isHuman) s.readiness[g.id] = true;
    const before = `${s.stage}|${s.week}|${s.season}|${s.bracket?.matchups.filter((m) => m.winner).length}`;
    readyUpLocal(s);
    if (before === `${s.stage}|${s.week}|${s.season}|${s.bracket?.matchups.filter((m) => m.winner).length}`) {
      if (guard > 3900) throw new Error(`no movement in ${s.stage}`);
    }
  }
}

describe.skipIf(!ON)("agent02 long run", () => {
  it("runs", { timeout: 24 * 3_600_000 }, () => {
    writeFileSync(OUT, "");
    log({ kind: "config", seed: SEED, seasons: SEASONS, talent: TALENT, human: HUMAN, config: { ...DEFAULT_CONFIG, humanGmCount: 1, talentImpact: TALENT } });
    const s = build();
    drive(s);
    log({ kind: "done", season: s.season });
  });
});
