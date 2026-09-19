/**
 * §15 validation experiment for the AI GM Season Strategy system
 * (06_AI_GM_SEASON_STRATEGY_SYSTEM_V1.md). Runs a batch of complete fantasy
 * drafts with 29 AI teams (one human seat, never picked from) and reports,
 * by strategy: first five positional picks, roster completeness, mean
 * overall (roster/offense/defense), average age, positional pick counts,
 * kicker/punter draft round, and duplicate-investment count.
 *
 * Headless and pure — uses `createLeague`/`beginDraft`/`completeDraft`
 * directly, no store, no UI, no network.
 *
 *   npx tsx scripts/ai_strategy_validation.ts [--drafts 50] [--seed 1]
 */
import { createLeague, DEFAULT_CONFIG } from "../src/state/seed.ts";
import { beginDraft, completeDraft, isAiTeam } from "../src/state/rules.ts";
import { strategyFor, type AiSeasonStrategy, AI_SEASON_STRATEGIES } from "../src/state/aiStrategy.ts";
import type { LeagueState, Player, Position } from "../src/domain/index.ts";

function option(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? undefined : process.argv[i + 1];
}
const drafts = Number(option("drafts") ?? 50);
const rootSeed = Number(option("seed") ?? 1);

interface TeamReport {
  strategy: AiSeasonStrategy;
  firstFive: Position[];
  rosterCount: number;
  meanOverall: number;
  meanOffenseOverall: number;
  meanDefenseOverall: number;
  meanAge: number;
  countsByPos: Record<string, number>;
  kickerRound: number | null;
  punterRound: number | null;
  duplicateInvestments: number;
}

const OFFENSE_POS = new Set(["QB", "RB", "WR", "TE", "OT", "OG", "C"]);
const DEFENSE_POS = new Set(["EDGE", "DT", "ILB", "OLB", "CB", "S"]);
// "duplicate high-investment position" = a position stacked 3+ deep at
// 75+ overall — a rough proxy for "kept drafting a position it already had".

function report(s: LeagueState, teamCode: string, strategy: AiSeasonStrategy): TeamReport {
  const picks = (s.draft?.results ?? []).filter((r) => r.teamCode === teamCode);
  const firstFive = picks.slice(0, 5).map((r) => r.selectedPosition!).filter(Boolean);
  const roster = Object.values(s.players).filter((p) => p.nfl_team === teamCode && !p.retired);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const countsByPos: Record<string, number> = {};
  for (const p of roster) countsByPos[p.position] = (countsByPos[p.position] ?? 0) + 1;

  const roundOf = (pos: Position): number | null => {
    const r = picks.find((x) => x.selectedPosition === pos);
    return r?.round ?? null;
  };

  let duplicateInvestments = 0;
  for (const [pos, list] of Object.entries(
    roster.reduce<Record<string, Player[]>>((acc, p) => {
      (acc[p.position] ??= []).push(p);
      return acc;
    }, {}),
  )) {
    const strong = list.filter((p) => p.overall >= 75).length;
    if (strong >= 3) duplicateInvestments++;
    void pos;
  }

  return {
    strategy,
    firstFive,
    rosterCount: roster.length,
    meanOverall: mean(roster.map((p) => p.overall)),
    meanOffenseOverall: mean(roster.filter((p) => OFFENSE_POS.has(p.position)).map((p) => p.overall)),
    meanDefenseOverall: mean(roster.filter((p) => DEFENSE_POS.has(p.position)).map((p) => p.overall)),
    meanAge: mean(roster.map((p) => p.age)),
    countsByPos,
    kickerRound: roundOf("K"),
    punterRound: roundOf("P"),
    duplicateInvestments,
  };
}

const byStrategy = new Map<AiSeasonStrategy, TeamReport[]>();
for (const strategy of AI_SEASON_STRATEGIES) byStrategy.set(strategy, []);

for (let i = 0; i < drafts; i++) {
  const seed = rootSeed + i * 97;
  const s = createLeague(seed, DEFAULT_CONFIG);
  // createLeague always seeds season 2026; strategyFor is keyed on
  // teamCode+season (§2), so leaving it fixed would replay the exact same
  // 32-team strategy assignment every iteration and just re-sample it with
  // different player pools. Varying the season per run is what actually
  // exercises "different seasons produce different strategy assignments"
  // (§14.3) and gives a balanced sample across all eight strategies.
  s.season = 2026 + i;
  beginDraft(s, "fantasy");
  completeDraft(s);
  for (const teamCode of Object.keys(s.teams)) {
    if (!isAiTeam(s, teamCode)) continue;
    const strategy = strategyFor(teamCode, s.season);
    byStrategy.get(strategy)!.push(report(s, teamCode, strategy));
  }
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const fmt = (n: number) => n.toFixed(1);

console.log(`AI GM Season Strategy validation — ${drafts} fantasy drafts, root seed ${rootSeed}\n`);
for (const strategy of AI_SEASON_STRATEGIES) {
  const rows = byStrategy.get(strategy)!;
  if (rows.length === 0) {
    console.log(`${strategy}: 0 team-drafts observed (widen --drafts)\n`);
    continue;
  }
  const posCounts: Record<string, number> = {};
  for (const r of rows) for (const [pos, n] of Object.entries(r.countsByPos)) posCounts[pos] = (posCounts[pos] ?? 0) + n;
  const firstPickPos: Record<string, number> = {};
  for (const r of rows) {
    const p = r.firstFive[0];
    if (p) firstPickPos[p] = (firstPickPos[p] ?? 0) + 1;
  }
  console.log(`## ${strategy}  (n=${rows.length} team-drafts)`);
  console.log(`  mean roster OVR:    ${fmt(mean(rows.map((r) => r.meanOverall)))}`);
  console.log(`  mean offense OVR:   ${fmt(mean(rows.map((r) => r.meanOffenseOverall)))}`);
  console.log(`  mean defense OVR:   ${fmt(mean(rows.map((r) => r.meanDefenseOverall)))}`);
  console.log(`  mean age:           ${fmt(mean(rows.map((r) => r.meanAge)))}`);
  console.log(`  mean roster count:  ${fmt(mean(rows.map((r) => r.rosterCount)))}`);
  console.log(`  first pick position histogram: ${JSON.stringify(firstPickPos)}`);
  console.log(
    `  drafted by position: ${Object.entries(posCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([p, n]) => `${p}:${n}`)
      .join(" ")}`,
  );
  console.log(`  mean K round: ${fmt(mean(rows.map((r) => r.kickerRound).filter((x): x is number => x !== null)))}`);
  console.log(`  mean P round: ${fmt(mean(rows.map((r) => r.punterRound).filter((x): x is number => x !== null)))}`);
  console.log(
    `  drafts with a 3+-deep 75-OVR position (rough duplicate-investment proxy): ${rows.filter((r) => r.duplicateInvestments > 0).length}/${rows.length}`,
  );
  console.log("");
}

// success criteria (§15): every declared strategy appears, and no strategy
// leaves a team without a roster at all (a pathological/unusable result).
const missing = AI_SEASON_STRATEGIES.filter((s) => (byStrategy.get(s) ?? []).length === 0);
const empty = [...byStrategy.values()].flat().filter((r) => r.rosterCount === 0);
console.log(`strategies observed: ${AI_SEASON_STRATEGIES.length - missing.length}/${AI_SEASON_STRATEGIES.length}`);
console.log(`team-drafts with an empty roster: ${empty.length}`);
if (missing.length > 0) console.log(`MISSING (widen --drafts or --seed spread): ${missing.join(", ")}`);
