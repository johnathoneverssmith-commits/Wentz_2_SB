/** Headless franchise diagnostic runner. Uses the same store actions as the UI. */
import { createHash } from "node:crypto";
import { createWriteStream, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { LeagueState, Player, Stage } from "../src/domain/index.ts";
import { DEFAULT_CONFIG } from "../src/state/seed.ts";
import { ROSTER_SIZE } from "../src/sim/roster-template.ts";

// The store's browser save is kept in memory. Disable the optional HTTP adapter
// so a running development server cannot change which simulator this run uses.
const saved = new Map<string, string>();
Object.assign(globalThis, {
  fetch: () => Promise.reject(new TypeError("headless mock mode")),
});
// The mock data loader caches a pool and normally returns shallow copies.
// Clone the returned data in this process so one league cannot mutate nested
// player data used to seed the next league.
const { MockSimulationService } = await import("../src/sim/MockSimulationService.ts");
const originalPool = MockSimulationService.prototype.generateInitialPool;
MockSimulationService.prototype.generateInitialPool = function(seed, mode) {
  return structuredClone(originalPool.call(this, seed, mode));
};
const { useStore } = await import("../src/state/store.ts");
Object.assign(globalThis, {
  window: { localStorage: {
    getItem: (k: string) => saved.get(k) ?? null,
    setItem: (k: string, v: string) => { saved.set(k, v); },
    removeItem: (k: string) => { saved.delete(k); },
  } },
});
type State = ReturnType<typeof useStore.getState>;
const state = (): State => useStore.getState();

function option(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? undefined : process.argv[i + 1];
}
function positiveInt(name: string, fallback: number): number {
  const raw = option(name);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 1) throw new Error(`--${name} needs a positive integer`);
  return n;
}
const mode = option("mode") ?? "smoke";
if (!["smoke", "standard", "deep"].includes(mode)) throw new Error("--mode must be smoke, standard, or deep");
const defaults = mode === "deep" ? [100, 20] : mode === "standard" ? [25, 10] : [1, 3];
const leagues = positiveInt("leagues", defaults[0]!);
const seasons = positiveInt("seasons", defaults[1]!);
const rootSeed = positiveInt("seed", 12345);
const leagueMode = option("league-mode") ?? "cpu_only";
if (!["cpu_only", "scripted_human"].includes(leagueMode)) throw new Error("--league-mode must be cpu_only or scripted_human");
if (process.argv.includes("--strategies") || process.argv.includes("--hooded-figure")) {
  throw new Error("This franchise store does not expose AI strategy or Hooded Figure state");
}
const difficulty = option("difficulty") ?? "normal";
if (!["easy", "normal", "hard", "impossible"].includes(difficulty)) throw new Error("Unsupported difficulty");
const replay = !process.argv.includes("--no-replay") && (process.argv.includes("--replay") || mode === "smoke");
const output = option("output") ?? join("..", "artifacts", "franchise_validation");
mkdirSync(output, { recursive: true });
const started = performance.now();
const runId = `${rootSeed}-${leagues}-${seasons}-${leagueMode}`;

const columns = {
  team_seasons: ["run_id","league_index","league_seed","season","team_code","human_or_cpu","ai_difficulty","wins","losses","ties","win_pct","points_for","points_against","point_diff","made_playoffs","playoff_round_reached","won_championship","team_ovr","offense_ovr","defense_ovr","special_teams_ovr","roster_mean_ovr","roster_mean_age","qb_best_ovr","rb_best_ovr","wr_top3_mean_ovr","te_best_ovr","ol_starter_mean_ovr","edge_top2_mean_ovr","dt_top2_mean_ovr","lb_starter_mean_ovr","cb_top3_mean_ovr","s_top2_mean_ovr","k_ovr","p_ovr","injuries_count","weeks_lost_to_injury","salary_cap","payroll","cap_space","roster_size","rookies_on_roster","retirements","fa_signings","trades_completed"],
  player_years: ["run_id","league_index","season","player_id","team_code","position","age","overall_start","overall_end","overall_delta","development_phase","retired","contract_years_remaining","free_agent_at_year_end"],
  transactions: ["run_id","league_index","season","phase","transaction_type","team_code","other_team_code","player_id","position","player_ovr","salary","years"],
  draft_picks: ["run_id","league_index","season","draft_type","pick_number","round","team_code","player_id","position","visible_ovr_at_selection"],
  league_years: ["run_id","league_index","league_seed","season","mean_team_ovr","mean_player_ovr","mean_payroll","mean_cap_space","trades_completed","fa_signings","retirements","rookies_entering","count_90_plus","count_80_89","count_70_79","count_below_70"],
  checkpoints: ["run_id","league_index","league_seed","season","phase","week","sha256"],
};
type Table = keyof typeof columns;
const streams = Object.fromEntries(Object.entries(columns).map(([name, cols]) => {
  const stream = createWriteStream(join(output, `${name}.csv`));
  stream.write(cols.join(",") + "\n");
  return [name, stream];
})) as Record<Table, ReturnType<typeof createWriteStream>>;
const failures = createWriteStream(join(output, "failures.jsonl"));
function csv(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}
function row(table: Table, values: Record<string, unknown>): void {
  streams[table].write(columns[table].map(k => csv(values[k])).join(",") + "\n");
}
let failureCount = 0;
let completed = 0;
let replayResult = "not_requested";
const warningCounts = new Map<string, number>();
const yearStats: Array<{ league: number; season: number; meanOvr: number; meanPayroll: number; meanCapSpace: number; fa: number; trades: number }> = [];
const faBySeason = new Map<string, number>();
function warn(message: string): void { warningCounts.set(message, (warningCounts.get(message) ?? 0) + 1); }
function failure(league: number, seed: number, phase: string, invariant: string, snapshot: unknown, err?: unknown): void {
  failureCount++;
  failures.write(JSON.stringify({ seed, league, season: state().season, phase, invariant, snapshot,
    stack: err instanceof Error ? err.stack : undefined,
    replay_command: `npm run franchise:stress -- --leagues 1 --seasons ${seasons} --seed ${seed} --league-mode ${leagueMode} --replay`,
  }) + "\n");
}
function leagueSeed(index: number): number { return (rootSeed + Math.imul(index, 104729)) >>> 0 || 1; }
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => [k, stable(v)]));
  return value;
}
function checksum(s: LeagueState): string {
  const { readiness: _readiness, stageDeadlineAt: _deadline, returnTo: _returnTo, ...durable } = s;
  void _readiness; void _deadline; void _returnTo;
  return createHash("sha256").update(JSON.stringify(stable(durable))).digest("hex");
}
function roster(s: LeagueState, team: string): Player[] {
  return Object.values(s.players).filter(p => !p.retired && !p.free_agent && p.nfl_team === team);
}
function topMeanOvr(players: Player[], positions: string[], n: number): number | undefined {
  const pool = players.filter(p => positions.includes(p.position)).map(p => p.overall).sort((a,b) => b-a).slice(0, n);
  return pool.length ? pool.reduce((a,b) => a+b, 0) / pool.length : undefined;
}
/** How far this team's postseason run went, or "none"/"eliminated_<round>". */
function playoffRoundReached(s: LeagueState, team: string): string {
  if (!s.bracket) return "none";
  const played = s.bracket.matchups.filter(m => (m.highSeed?.code === team || m.lowSeed?.code === team) && m.winner);
  if (played.length === 0) return "none";
  if (s.bracket.champion === team) return "won_sb";
  const last = played[played.length - 1]!;
  return last.winner === team ? last.round : `eliminated_${last.round}`;
}
/**
 * This team's injury_history entries for one season, across whoever is on
 * the roster at the season-end snapshot this runs from. A player hurt and
 * then released, traded, or retired before that snapshot is missed — the
 * store doesn't record which team an injury happened on, only the season —
 * so this undercounts rather than measuring exactly, which is preferable to
 * guessing at the team.
 */
function injuriesThisSeason(players: Player[], season: number) {
  return players.flatMap(p => p.injury_history.filter(h => h.season === season));
}
function validate(s: LeagueState, li: number, seed: number, phase: string): void {
  const ids = new Set<string>();
  for (const [id, p] of Object.entries(s.players)) {
    if (ids.has(p.id) || id !== p.id) failure(li, seed, phase, "duplicate_or_mismatched_player_id", { id, playerId: p.id });
    ids.add(p.id);
    if (!p.free_agent && !p.retired && !s.teams[p.nfl_team]) failure(li, seed, phase, "missing_owner_team", { id, team: p.nfl_team });
    if (p.contract && (!Number.isFinite(p.contract.total_value) || p.contract.years_remaining < 0 || p.contract.cap_hit_by_year.some(x => !Number.isFinite(x)))) failure(li, seed, phase, "invalid_contract", { id, contract: p.contract });
  }
  for (const [code, team] of Object.entries(s.teams)) {
    const players = roster(s, code);
    if (![team.cap.total, team.cap.used, team.cap.dead].every(Number.isFinite)) failure(li, seed, phase, "nonfinite_cap", { code, cap: team.cap });
    const contractTotal = players.reduce((n,p) => n + (p.contract?.cap_hit_by_year[0] ?? 0), 0);
    if (Math.abs(contractTotal - team.cap.used) > 0.11) failure(li, seed, phase, "cap_ledger_mismatch", { code, used: team.cap.used, contractTotal });
    if (players.length < 0 || (phase === "preseason" && players.length !== ROSTER_SIZE)) failure(li, seed, phase, "roster_size", { code, size: players.length });
    for (const list of Object.values(s.depthChart[code] ?? {})) for (const id of list ?? []) {
      if (!players.some(p => p.id === id)) failure(li, seed, phase, "depth_chart_unrostered", { code, id });
    }
    if (phase === "preseason" && !["QB","K","P","C","OT"].every(pos => players.some(p => p.position === pos))) failure(li, seed, phase, "missing_required_position", { code });
  }
  if (s.draft) {
    const picked = s.draft.results.map(r => r.selectedId).filter(Boolean);
    if (new Set(picked).size !== picked.length) failure(li, seed, phase, "duplicate_draft_selection", { picks: picked.length });
    if (s.draft.results.some(r => !s.teams[r.teamCode])) failure(li, seed, phase, "draft_pick_missing_team", {});
  }
  if (s.freeAgencyEvent) {
    const signedIds = s.freeAgencyEvent.signed.map(x => x.playerId);
    if (new Set(signedIds).size !== signedIds.length) failure(li, seed, phase, "duplicate_fa_signing", { signedIds });
    for (const x of s.freeAgencyEvent.signed) {
      if (s.players[x.playerId]?.free_agent) failure(li, seed, phase, "signed_player_still_free_agent", { playerId: x.playerId });
    }
  }
  const scheduleKeys = s.schedule.map(g => `${g.phase}:${g.week}:${g.homeTeam}:${g.awayTeam}`);
  if (new Set(scheduleKeys).size !== scheduleKeys.length) failure(li, seed, phase, "duplicate_schedule_entry", { count: scheduleKeys.length });
  if (s.bracket?.champion && !s.teams[s.bracket.champion]) failure(li, seed, phase, "invalid_champion", { champion: s.bracket.champion });
}
function checkpoint(li: number, seed: number, trace: string[]): void {
  const s = state();
  const phase = s.stage;
  const hash = checksum(s);
  trace.push(`${s.season}:${phase}:${s.week}:${hash}`);
  row("checkpoints", { run_id: runId, league_index: li, league_seed: seed, season: s.season, phase, week: s.week, sha256: hash });
  validate(s, li, seed, phase);
}
function setViewer(team: string): void {
  const gm = state().gms.find(g => g.teamCode === team);
  if (gm) useStore.setState({ viewerGmId: gm.id });
}
function ready(): void {
  for (const gm of state().gms) if (gm.isHuman) state().setReady(gm.id, true);
}
async function act(stage: Stage): Promise<void> {
  let s = state();
  switch (stage) {
    case "setup":
      for (const gm of s.gms) if (!gm.teamCode) s.pickTeam(gm.id, Object.keys(s.teams).find(c => !s.gms.some(g => g.teamCode === c))!);
      break;
    case "fantasyDraft":
    case "offseasonDraft":
      s.startDraft(stage === "fantasyDraft" ? "fantasy" : "rookie");
      s.autopickRemaining();
      break;
    case "coachingDraft": {
      let guard = 500;
      while (state().coachingDraft && state().coachingDraft!.currentPickIndex < state().coachingDraft!.pickOrder.length && guard-- > 0) {
        s = state();
        const board = s.coachingDraft!;
        const team = board.pickOrder[board.currentPickIndex]!;
        setViewer(team);
        const taken = new Set(Object.values(s.coaches).filter(c => c.team === team).map(c => c.role));
        const coach = Object.values(s.coaches).filter(c => c.team === null && !taken.has(c.role)).sort((a,b) => (b.overall ?? 0) - (a.overall ?? 0) || a.id.localeCompare(b.id))[0];
        if (!coach || !state().draftCoach(coach.id).ok) throw new Error(`coaching draft stalled at ${team}`);
      }
      break;
    }
    case "freeAgency":
    case "midseasonFreeAgency": {
      let guard = 600;
      while (state().freeAgencyEvent && !state().freeAgencyEvent!.complete && guard-- > 0) {
        s = state();
        const e = s.freeAgencyEvent!;
        const team = e.order[e.turnIndex];
        if (!team) break;
        setViewer(team);
        const result = state().freeAgencyTurn({ pass: true });
        if (!result.ok) throw new Error(`FA stalled: ${result.reason}`);
      }
      break;
    }
    case "tradeDeadline": {
      let guard = 130;
      while (state().tradeDeadline && !state().tradeDeadline!.done && guard-- > 0) {
        s = state();
        const d = s.tradeDeadline!;
        const team = d.active ? (d.active.awaiting === "recipient" ? d.active.toTeam : d.active.fromTeam) : d.order[d.index];
        if (!team) break;
        setViewer(team);
        const result = state().deadlineTurn(d.active ? { kind: "deny" } : { kind: "skip" });
        if (!result.ok) throw new Error(`deadline stalled: ${result.reason}`);
      }
      break;
    }
    case "coachingHiring":
    case "offseasonFreeAgency": {
      const subject = stage === "coachingHiring" ? "coaches" : "players";
      s.startBidding(subject);
      for (let i = 0; i < 6; i++) state().advanceBiddingDay(subject);
      break;
    }
    case "offseasonSignings":
      for (const pick of s.draft?.results ?? []) if (pick.selectedId && s.gms.some(g => g.teamCode === pick.teamCode)) state().signRookie(pick.selectedId, pick.teamCode);
      break;
    case "preseason":
    case "regularSeason":
    case "playoffs":
      await s.simulateGameDay();
      break;
    default: break;
  }
}
function emitSeason(li: number, seed: number, start: Map<string, Player>, season: number): void {
  const s = state();
  const teams = Object.values(s.teams);
  const active = Object.values(s.players).filter(p => !p.retired && !p.free_agent);
  const mean = (nums: number[]) => nums.length ? nums.reduce((a,b) => a+b, 0) / nums.length : 0;
  const faCount = (team: string) => faBySeason.get(`${li}:${season}:${team}`) ?? 0;
  const trades = s.trades.filter(t => t.status === "accepted");
  // retired this season, on the team they were on when the season started —
  // `start` is the roster snapshot `runLeague` took before this season's
  // first stage ran, so a player who retired mid-season is counted against
  // the team that lost him rather than "free agent", which he never was
  const retirementsFor = (team: string) =>
    [...start.values()].filter(p => p.nfl_team === team && s.players[p.id]?.retired).length;
  for (const t of teams) {
    const people = roster(s, t.code);
    row("team_seasons", { run_id: runId, league_index: li, league_seed: seed, season, team_code: t.code,
      human_or_cpu: t.controlledBy.kind, ai_difficulty: s.config.difficulty,
      wins: t.wins, losses: t.losses, ties: t.ties, win_pct: (t.wins + .5*t.ties) / Math.max(1,t.wins+t.losses+t.ties),
      points_for: t.pointsFor, points_against: t.pointsAgainst, point_diff: t.pointsFor-t.pointsAgainst,
      made_playoffs: t.playoffSeed > 0, playoff_round_reached: playoffRoundReached(s, t.code), won_championship: s.bracket?.champion === t.code,
      team_ovr: t.ratings.overall, offense_ovr: t.ratings.offense, defense_ovr: t.ratings.defense, special_teams_ovr: t.ratings.specialTeams,
      roster_mean_ovr: mean(people.map(p => p.overall)), roster_mean_age: mean(people.map(p => p.age)),
      qb_best_ovr: topMeanOvr(people, ["QB"], 1), rb_best_ovr: topMeanOvr(people, ["RB"], 1),
      wr_top3_mean_ovr: topMeanOvr(people, ["WR"], 3), te_best_ovr: topMeanOvr(people, ["TE"], 1),
      ol_starter_mean_ovr: topMeanOvr(people, ["OT","OG","C"], 5),
      edge_top2_mean_ovr: topMeanOvr(people, ["EDGE"], 2), dt_top2_mean_ovr: topMeanOvr(people, ["DT"], 2),
      lb_starter_mean_ovr: topMeanOvr(people, ["ILB","OLB"], 3),
      cb_top3_mean_ovr: topMeanOvr(people, ["CB"], 3), s_top2_mean_ovr: topMeanOvr(people, ["S"], 2),
      k_ovr: topMeanOvr(people, ["K"], 1), p_ovr: topMeanOvr(people, ["P"], 1),
      injuries_count: injuriesThisSeason(people, season).length,
      weeks_lost_to_injury: injuriesThisSeason(people, season).reduce((n,h) => n + h.weeks_out, 0),
      salary_cap: t.cap.total, payroll: t.cap.used, cap_space: t.cap.total-t.cap.used, roster_size: people.length,
      rookies_on_roster: people.filter(p => p.years_pro === 0).length,
      retirements: retirementsFor(t.code),
      fa_signings: faCount(t.code),
      trades_completed: trades.filter(x => x.fromTeam === t.code || x.toTeam === t.code).length });
  }
  for (const p of Object.values(s.players)) {
    const old = start.get(p.id);
    if (!old && p.retired) continue;
    const phase = p.age < p.dev_age_threshold ? "developing" : p.age >= p.decline_age_threshold ? "declining" : "prime";
    row("player_years", { run_id: runId, league_index: li, season, player_id: p.id, team_code: p.nfl_team, position: p.position,
      age: p.age, overall_start: old?.overall, overall_end: p.overall, overall_delta: old ? p.overall-old.overall : undefined,
      development_phase: phase, retired: p.retired, contract_years_remaining: p.contract?.years_remaining, free_agent_at_year_end: p.free_agent });
  }
  for (const x of trades) row("transactions", { run_id: runId, league_index: li, season, phase: "trade", transaction_type: "trade", team_code: x.fromTeam, other_team_code: x.toTeam });
  const meanOvr = mean(active.map(p => p.overall));
  const meanPayroll = mean(teams.map(t => t.cap.used));
  const meanCapSpace = mean(teams.map(t => t.cap.total-t.cap.used));
  const totalFa = teams.reduce((n,t) => n + faCount(t.code), 0);
  const baseline = yearStats.find(y => y.league === li)?.meanOvr;
  const yearNumber = yearStats.filter(y => y.league === li).length + 1;
  if (baseline !== undefined && ((yearNumber === 5 && Math.abs(meanOvr-baseline) > 1.5) || (yearNumber === 10 && Math.abs(meanOvr-baseline) > 2.5))) {
    warn(`Talent mean changed ${Math.abs(meanOvr-baseline).toFixed(2)} OVR by year ${yearNumber}`);
  }
  yearStats.push({ league: li, season, meanOvr, meanPayroll, meanCapSpace, fa: totalFa, trades: trades.length });
  const totalRetirements = teams.reduce((n,t) => n + retirementsFor(t.code), 0);
  const rookiesEntering = active.filter(p => p.years_pro === 0).length;
  row("league_years", { run_id: runId, league_index: li, league_seed: seed, season,
    mean_team_ovr: mean(teams.map(t => t.ratings.overall)), mean_player_ovr: meanOvr,
    mean_payroll: meanPayroll, mean_cap_space: meanCapSpace,
    trades_completed: trades.length, fa_signings: totalFa,
    retirements: totalRetirements, rookies_entering: rookiesEntering,
    count_90_plus: active.filter(p => p.overall >= 90).length,
    count_80_89: active.filter(p => p.overall >= 80 && p.overall < 90).length,
    count_70_79: active.filter(p => p.overall >= 70 && p.overall < 80).length,
    count_below_70: active.filter(p => p.overall < 70).length });
  if (teams.filter(t => t.cap.used > t.cap.total).length > teams.length * .2) warn("More than 20% of teams are over cap");
}
async function runLeague(li: number, seed: number, emit = true): Promise<string[]> {
  await state().newLeague(seed, { ...DEFAULT_CONFIG, humanGmCount: leagueMode === "scripted_human" ? 3 : 1, difficulty: difficulty as typeof DEFAULT_CONFIG.difficulty });
  if (leagueMode === "cpu_only") {
    const gm = state().gms[0]!;
    state().pickTeam(gm.id, Object.keys(state().teams)[0]!);
    useStore.setState(s => ({ gms: s.gms.map(g => ({ ...g, isHuman: false })), teams: Object.fromEntries(Object.entries(s.teams).map(([k,t]) => [k, { ...t, controlledBy: { kind: "ai" as const } }])) }));
  }
  const trace: string[] = [];
  let lastSeason = state().season;
  let start = new Map(Object.entries(state().players));
  let finishedSeasons = 0;
  let guard = seasons * 90 + 45;
  while (completed < Number.MAX_SAFE_INTEGER && guard-- > 0) {
    const before = state();
    const stage = before.stage;
    if (emit) checkpoint(li, seed, trace); else trace.push(`${before.season}:${stage}:${before.week}:${checksum(before)}`);
    await act(stage);
    if ((stage === "freeAgency" || stage === "midseasonFreeAgency") && state().freeAgencyEvent?.complete) {
      for (const x of state().freeAgencyEvent!.signed) {
        const key = `${li}:${before.season}:${x.teamCode}`;
        faBySeason.set(key, (faBySeason.get(key) ?? 0) + 1);
        row("transactions", { run_id: runId, league_index: li, season: before.season, phase: stage, transaction_type: "signing", team_code: x.teamCode,
          player_id: x.playerId, position: state().players[x.playerId]?.position, player_ovr: state().players[x.playerId]?.overall, salary: x.salary, years: x.years });
      }
    }
    ready();
    if (["preseason","regularSeason","playoffs"].includes(stage)) await state().finishGameDay();
    else {
      const moved = await state().tryAdvance();
      if (!moved.moved) throw new Error(`Stage ${stage} refused to advance`);
    }
    const after = state();
    if (stage === "fantasyDraft" || stage === "offseasonDraft") {
      const d = after.draft;
      if (emit && d) for (const pick of d.results) row("draft_picks", { run_id: runId, league_index: li, season: before.season,
        draft_type: d.mode, pick_number: pick.pickNumber, round: pick.round, team_code: pick.teamCode,
        player_id: pick.selectedId, position: pick.selectedPosition,
        visible_ovr_at_selection: d.mode === "fantasy" && pick.selectedId ? after.players[pick.selectedId]?.overall : undefined });
    }
    if (stage === "playoffs" && after.stage === "endOfSeasonAnnounce" && after.bracket?.champion) {
      if (emit) { emitSeason(li, seed, start, lastSeason); completed++; }
      finishedSeasons++;
      if (finishedSeasons >= seasons) return trace;
    }
    if (after.season !== lastSeason) {
      lastSeason = after.season;
      start = new Map(Object.entries(after.players));
    }
  }
  throw new Error(`Season flow did not complete within ${seasons * 90 + 45} steps; stopped at ${state().stage}`);
}

const gitRevision = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout?.trim() || "unknown";
writeFileSync(join(output, "run_config.json"), JSON.stringify({ root_seed: rootSeed, leagues, seasons, league_mode: leagueMode,
  ai_difficulty: difficulty, simulation_backend: "headless_mock", replay, engine_version: gitRevision, command: process.argv.join(" ") }, null, 2));
for (let li = 0; li < leagues; li++) {
  const seed = leagueSeed(li);
  try {
    const trace = await runLeague(li, seed);
    if (replay && li === 0) {
      const replayOutput = join(output, "replay");
      const tsxCli = fileURLToPath(import.meta.resolve("tsx/cli"));
      const child = spawnSync(process.execPath, [tsxCli, "--tsconfig", "tsconfig.app.json", process.argv[1]!, "--mode", mode, "--leagues", "1", "--seasons", String(seasons), "--seed", String(seed), "--league-mode", leagueMode, "--difficulty", difficulty, "--no-replay", "--output", replayOutput], { encoding: "utf8", timeout: 1800000 });
      const replayFile = join(replayOutput, "checkpoints.csv");
      const { readFileSync } = await import("node:fs");
      const again = child.status === 0 ? readFileSync(replayFile, "utf8").trim().split(/\r?\n/).slice(1).map(line => { const p = line.split(","); return `${p[3]}:${p[4]}:${p[5]}:${p[6]}`; }) : [];
      replayResult = JSON.stringify(trace) === JSON.stringify(again) ? "identical" : "mismatch";
      if (replayResult !== "identical") failure(li, seed, "replay", "determinism", { first: trace, second: again, child_error: child.stderr?.slice(-2000) });
    }
    console.log(`League ${li + 1}/${leagues}: ${seasons} seasons complete`);
  } catch (err) {
    failure(li, seed, state().stage, "exception_or_progression", { stage: state().stage, week: state().week }, err);
    console.error(`League ${li + 1} failed:`, err);
  }
}
const runtime = ((performance.now() - started) / 1000).toFixed(1);
const firstYear = yearStats.find(y => y.league === 0);
const lastYear = yearStats.filter(y => y.league === 0).at(-1);
const summary = `# Franchise validation\n\n- Command: \`${process.argv.join(" ")}\`\n- Root seed: ${rootSeed}\n- Leagues requested: ${leagues}\n- Team seasons completed: ${completed}\n- Runtime: ${runtime}s\n- Invariant failures and crashes: ${failureCount}\n- Deterministic replay: ${replayResult}\n- Backend: headless mock\n\n## Trends\n- Mean player OVR: ${firstYear?.meanOvr.toFixed(2) ?? "n/a"} to ${lastYear?.meanOvr.toFixed(2) ?? "n/a"}\n- Mean payroll ($M): ${firstYear?.meanPayroll.toFixed(2) ?? "n/a"} to ${lastYear?.meanPayroll.toFixed(2) ?? "n/a"}\n- Mean cap space ($M): ${firstYear?.meanCapSpace.toFixed(2) ?? "n/a"} to ${lastYear?.meanCapSpace.toFixed(2) ?? "n/a"}\n- Recorded FA signings: ${yearStats.reduce((n,y) => n+y.fa,0)}\n- Recorded trades: ${yearStats.reduce((n,y) => n+y.trades,0)}\n\n## Alerts\n${[...warningCounts].map(([x,n]) => `- ${x}: ${n}`).join("\n") || "- None"}\n\n## Limits\n- The simulation adapter is disabled for a reproducible headless run.\n- The scripted policy passes on free agency and deadline trades; those rates need a separate active policy.\n- Strategy settings and Hooded Figure state are not exposed by this franchise store.\n`;
writeFileSync(join(output, "summary.md"), summary);
await Promise.all([...Object.values(streams), failures].map(s => new Promise<void>(resolve => s.end(resolve))));
console.log(summary);
if (failureCount || replayResult === "mismatch") process.exitCode = 1;
