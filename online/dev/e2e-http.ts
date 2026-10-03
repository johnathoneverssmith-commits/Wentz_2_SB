/**
 * End-to-end multiplayer run against a live league server — the real HTTP
 * routes, database and serialization, not the in-process decide functions.
 *
 * Two (or more) accounts register, one creates a league, the others join by
 * invite code, everyone claims a team, and each GM then takes their own turns
 * through the same endpoints the screens call — draft picks, coaching picks,
 * free-agency turns, deadline answers, camp plans, reveals, ready-ups — for
 * as many seasons as asked. It records every failed request, the slowest
 * calls, and a set of online-only checks: box scores and season stats on the
 * games a GM can see, awards and league history written at season's end,
 * a GM behind on reveals not seeing stats from weeks they haven't watched,
 * no server-only fields leaking to a client.
 *
 *   npm run online:db & npm run online:local
 *   npx tsx --tsconfig online/tsconfig.json online/dev/e2e-http.ts [--seasons 2] [--humans 2] [--format nfl|humansOnly] [--fantasy]
 */
import type { LeagueState } from "@/domain";
import { bracketRounds } from "@/domain";
import { availableCoaches, coachingOnTheClock, vacantRoles } from "@/state/coachingDraft.ts";
import { extensionAsk } from "@/state/contracts.ts";
import { onTheClock as faOnTheClock } from "@/state/freeAgencyEvent.ts";
import { seasonShape } from "@/state/leagueFormat.ts";
import { revealedRounds, revealedWeek, stepOf } from "@/state/reveal.ts";
import { currentBlock } from "@/state/revealBlocks.ts";
import { bestAvailable, standingAsk } from "@/state/rules.ts";
import { pendingFor } from "@/state/tradeDeadline.ts";

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1]! : fallback;
};
const API = process.env.LEAGUE_API ?? "http://localhost:8788";
const SEASONS = Number(arg("seasons", "2"));
const HUMANS = Number(arg("humans", "2"));
const FORMAT = arg("format", "nfl");
const FANTASY = process.argv.includes("--fantasy") || FORMAT === "humansOnly";
// --browser: the first GM is left to a person in the browser (the harness
// prints its sign-in name) and the harness plays the others, waiting on them
let BROWSER = process.argv.includes("--browser");
// --handoff <stage>: play every GM until the league reaches <stage>, then
// leave the first GM to a person (implies --browser from then on)
const HANDOFF = arg("handoff", "");
// --handoff-season <year>: only hand off at <stage> in this season or later
const HANDOFF_SEASON = Number(arg("handoff-season", "0"));
const TEAMS = ["GB", "KC", "PIT", "SF", "BUF", "DAL"];

interface User {
  name: string;
  cookie: string;
  team: string;
  gmId: string;
}

const failures: string[] = [];
const slow: { ms: number; what: string }[] = [];
const checks: string[] = [];
const check = (ok: boolean, what: string) => {
  checks.push(`${ok ? "PASS" : "FAIL"} ${what}`);
  if (!ok) failures.push(`check failed: ${what}`);
};

async function call<T>(u: User | null, method: "GET" | "POST", path: string, body?: unknown): Promise<T | null> {
  const t0 = performance.now();
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { ...(u ? { cookie: u.cookie } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const ms = performance.now() - t0;
  slow.push({ ms, what: `${method} ${path.replace(/[0-9a-f-]{36}/g, ":id")}` });
  const text = await res.text();
  if (u && res.headers.get("set-cookie")) u.cookie = res.headers.get("set-cookie")!.split(";")[0]!;
  if (!res.ok) {
    // a refusal the screens also get (e.g. "not your turn") is not a failure
    const msg = text.slice(0, 160);
    if (res.status >= 500) failures.push(`${res.status} ${method} ${path}: ${msg}`);
    return null;
  }
  return (text ? JSON.parse(text) : {}) as T;
}

async function register(name: string): Promise<User> {
  const u: User = { name, cookie: "", team: "", gmId: "" };
  const res = await fetch(`${API}/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, password: PASSWORD }),
  });
  u.cookie = res.headers.get("set-cookie")!.split(";")[0]!;
  return u;
}

const stateOf = async (u: User, leagueId: string) =>
  (await call<{ state: LeagueState; you: { gmId: string } | null }>(u, "GET", `/leagues/${leagueId}`))!;

/** What this GM does at this stage, through the API. Returns true if it acted. */
async function act(u: User, leagueId: string, s: LeagueState): Promise<void> {
  const a = (path: string, body: unknown) => call(u, "POST", `/leagues/${leagueId}/actions/${path}`, body);
  switch (s.stage) {
    case "fantasyDraft":
    case "offseasonDraft": {
      const d = s.draft;
      if (d && d.pickOrder[d.currentPickIndex] === u.team) {
        const pick = bestAvailable(s);
        if (pick) await a("draft/pick", { selectedId: pick });
      }
      return;
    }
    case "coachingDraft": {
      if (coachingOnTheClock(s) !== u.team) return;
      const open = vacantRoles(s, u.team);
      const c = availableCoaches(s).find((x) => open.includes(x.role));
      if (c) await a("coach-draft", { coachId: c.id });
      return;
    }
    case "freeAgency":
    case "midseasonFreeAgency":
      if (faOnTheClock(s) === u.team) await a("fa-turn", { pass: true });
      return;
    case "tradeDeadline": {
      const duty = pendingFor(s, u.team);
      if (duty) await a("deadline", { move: { kind: duty === "propose" ? "skip" : "deny" } });
      return;
    }
    case "trainingCamp":
      if (!s.trainingCamp?.plans[u.team]?.submitted) {
        await a("training-camp", { plan: { offensiveFocus: "QB", defensiveFocus: "DL", submitted: true } });
      }
      return;
    case "preseason":
    case "regularSeason": {
      const shape = seasonShape(s);
      const phase = s.stage === "preseason" ? "PRE" : "REG";
      // the block the client itself would show — the same question the hub asks
      const last = currentBlock(s)?.lastWeek ?? (s.stage === "preseason" ? shape.preseasonWeeks : shape.deadlineWeek);
      if (revealedWeek(s, u.gmId, phase) < last) await a("reveal", { through: last });
      return;
    }
    case "playoffs": {
      const rounds = s.bracket ? bracketRounds(s.bracket).length : 0;
      if (revealedRounds(s, u.gmId).length < rounds) await a("reveal-round", {});
      return;
    }
    case "offseasonDraftSummary":
      // once: re-sending it every poll bumped the league version constantly
      if (stepOf(s, u.gmId) !== "rookieSignings") await a("step", { step: "rookieSignings" });
      for (const r of s.draft?.results ?? []) {
        if (r.teamCode === u.team && r.selectedId && !s.rookieOutcomes[r.selectedId]) {
          await a("rookie", { prospectId: r.selectedId, released: false });
        }
      }
      return;
    default:
      return;
  }
}

// --resume signs in to accounts made elsewhere (an older server, a browser)
const PASSWORD = process.env.E2E_PASSWORD ?? "password123";

async function login(name: string): Promise<User> {
  const res = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, password: PASSWORD }),
  });
  return { name, cookie: res.headers.get("set-cookie")!.split(";")[0]!, team: "", gmId: "" };
}

async function main() {
  const t0 = performance.now();
  const users: User[] = [];
  let leagueId: string;
  // --resume <leagueId> <name,name,...>: pick an existing league back up (a
  // restarted server, a browser GM mid-season) instead of starting one
  const resume = arg("resume", "");
  if (resume) {
    leagueId = resume;
    for (const name of arg("users", "").split(",")) {
      const u = await login(name);
      const view = await call<{ you: { gmId: string; teamCode: string } | null }>(u, "GET", `/leagues/${leagueId}`);
      u.team = view!.you!.teamCode;
      u.gmId = view!.you!.gmId;
      users.push(u);
    }
  } else {
    for (let i = 0; i < HUMANS; i++) users.push(await register(`qa_${Date.now() % 1e7}_${i}`));
    const created = await call<{ leagueId: string; inviteCode: string }>(users[0]!, "POST", "/leagues", {
      name: "QA league",
      humanSlots: HUMANS,
      config: { leagueFormat: FORMAT, fantasyDraft: FANTASY },
    });
    if (!created) throw new Error("could not create a league");
    leagueId = created.leagueId;
    if (BROWSER) console.log(`browser GM: sign in as ${users[0]!.name} (harness test password); league ${leagueId}`);
    const invite = await call<{ openTeams: string[] }>(users[1]!, "GET", `/invites/${created.inviteCode}`);
    check(!!invite && invite.openTeams.length > 0, "invite lookup lists open teams");
    for (let i = 0; i < HUMANS; i++) {
      const claim = await call<{ teamCode: string; gmId: string }>(users[i]!, "POST", `/leagues/${leagueId}/claim`, {
        teamCode: TEAMS[i],
      });
      if (!claim) throw new Error(`claim failed for ${TEAMS[i]}`);
      users[i]!.team = claim.teamCode;
      users[i]!.gmId = claim.gmId;
    }
  }

  let seasonsDone = 0;
  let lastStage = "";
  let sameStage = 0;
  let extended = false;
  let yearOneFaChecked = false;
  const preseasonChecked = new Set<number>();
  let signedInSeason = false;
  let rewindChecked = false;
  const path: string[] = [];

  for (let step = 0; step < (BROWSER ? 1e6 : 4000) && seasonsDone < SEASONS; step++) {
    const views = await Promise.all(users.map((u) => stateOf(u, leagueId)));
    const s = views[0]!.state;
    if (s.stage !== lastStage) {
      path.push(`${s.season}:${s.stage}`);
      if (lastStage === "playoffs") seasonsDone++;
      lastStage = s.stage;
      sameStage = 0;
    } else if (++sameStage > (BROWSER ? 1e6 : 60)) {
      failures.push(`stuck at ${s.stage} (season ${s.season})`);
      break;
    }

    if (HANDOFF && !BROWSER && s.stage === HANDOFF && s.season >= HANDOFF_SEASON) {
      BROWSER = true;
      console.log(`handing off at ${s.stage}: sign in as ${users[0]!.name} (harness test password); league ${leagueId}`);
    }

    // ---- online-only checks, taken where they mean something -------------
    check(views.every((v) => !("statLedger" in v.state)), "server-only statLedger never reaches a client");
    // the draft's one secret: a prospect's true rating, until his pick resolves
    check(
      views.every((v) =>
        (v.state.draftClass ?? []).every((pr) => v.state.rookieOutcomes?.[pr.id] || pr.trueOverall === 0),
      ),
      "no unresolved prospect's true rating reaches a client",
    );
    if (s.stage === "regularSeason" && !rewindChecked) {
      // one GM watches ahead, the other doesn't: the laggard must not see the
      // leader's weeks in the stats
      // in --browser mode the first GM is a person: act only as the bots
      const ahead = BROWSER ? users[1]! : users[0]!;
      const behind = BROWSER ? users[0]! : users[1]!;
      await call(ahead, "POST", `/leagues/${leagueId}/actions/reveal`, { through: 3 });
      const va = (await stateOf(ahead, leagueId)).state;
      const vb = (await stateOf(behind, leagueId)).state;
      const yds = (v: LeagueState) => Object.values(v.players).reduce((n, p) => n + (p.season_stats?.passYds ?? 0), 0);
      const wins = (v: LeagueState) => Object.values(v.teams).reduce((n, t) => n + t.wins, 0);
      if (revealedWeek(vb, behind.gmId, "REG") < 3) {
        check(yds(va) > yds(vb), `a GM behind on reveals sees fewer stats (${yds(va)} vs ${yds(vb)} pass yds)`);
        check(wins(va) > wins(vb), `a GM behind on reveals sees fewer results (${wins(va)} vs ${wins(vb)} wins)`);
        rewindChecked = true;
      }
    }
    if (process.env.E2E_DEBUG && (s.stage === "fantasyDraft" || s.stage === "fantasyDraftSummary" || s.stage === "coachingDraft")) {
      const signedNow = Object.values(s.players).filter((p) => !p.free_agent && !p.retired).length;
      console.log(`[debug] ${s.stage} pick ${s.draft?.currentPickIndex}/${s.draft?.pickOrder.length} results ${s.draft?.results.length} signed ${signedNow} players ${Object.keys(s.players).length}`);
    }
    if (FANTASY && s.stage === "trainingCamp" && !yearOneFaChecked) {
      // a fantasy draft fills every roster, so year one has no market: the
      // coaching summary goes straight to camp, with 53 on every team and the
      // undrafted left free for the season
      const free = Object.values(s.players).filter((p) => p.free_agent && !p.retired);
      check(free.length > 0 && free.every((p) => !p.nfl_team || p.nfl_team === "FA"), `the undrafted stay free agents through year one (${free.length} players)`);
      const sizes = Object.keys(s.teams).map((c) => Object.values(s.players).filter((p) => p.nfl_team === c && !p.retired).length);
      const signed = Object.values(s.players).filter((p) => !p.free_agent && !p.retired).length;
      check(Math.max(...sizes) === 53 && Math.min(...sizes) === 53, `the draft filled every roster to 53 entering training camp (${Math.min(...sizes)}-${Math.max(...sizes)}, ${signed} signed, teams ${Object.keys(s.teams).slice(0, 3).join(",")})`);
      yearOneFaChecked = true;
    }
    if (s.stage === "regularSeason" && s.tradeDeadline) {
      // each GM's own copy (unwatched games redacted) must still know it is
      // in the second half — it once offered "Advance to Trade Deadline" again
      const shape = seasonShape(s);
      check(
        views.every((v) => (currentBlock(v.state)?.firstWeek ?? 0) > shape.deadlineWeek),
        `season ${s.season}: every GM's client knows the second half has begun`,
      );
    }
    if (s.stage === "preseason" && !preseasonChecked.has(s.season)) {
      // nobody has watched a preseason game yet, so nobody can have seen
      // anyone get hurt in one (the whole block is already simulated)
      const unwatched = views.filter((v) => revealedWeek(v.state, v.you?.gmId ?? "", "PRE") === 0);
      if (unwatched.length) {
        const hurt = Object.values(unwatched[0]!.state.players).filter((p) => p.injury_status).length;
        check(hurt === 0, `season ${s.season}: no injuries shown from unwatched preseason games (${hurt})`);
      }
      // whatever the offseason did, every team takes the field with a squad
      const sizes = Object.keys(s.teams).map((c) => Object.values(s.players).filter((p) => p.nfl_team === c && !p.retired && !p.free_agent).length);
      check(Math.min(...sizes) >= 45 && Math.max(...sizes) <= 53, `season ${s.season}: every roster legal at the preseason (${Math.min(...sizes)}-${Math.max(...sizes)})`);
      preseasonChecked.add(s.season);
    }
    if (s.stage === "regularSeason" && !signedInSeason) {
      // an in-season signing at the player's asking price, and a lowball refused
      const me = users[users.length - 1]!;
      const fa = Object.values(s.players)
        .filter((p) => p.free_agent && !p.retired && p.overall >= 60)
        .sort((x, y) => y.overall - x.overall)[0];
      if (fa) {
        const low = await call(me, "POST", `/leagues/${leagueId}/actions/sign`, {
          playerId: fa.id,
          offer: { teamCode: me.team, baseSalary: 1, signingBonus: 0, years: 1, guaranteed: 0 },
        });
        check(low === null, "a lowball in-season signing is refused online");
        signedInSeason = true;
      }
    }
    if (s.stage === "regularSeason" && !extended) {
      const me = users[1]!;
      const p = Object.values(s.players).find((x) => x.nfl_team === me.team && x.contract && x.contract.years_remaining <= 2 && x.overall >= 70);
      if (p) {
        const r = await call(me, "POST", `/leagues/${leagueId}/actions/contract`, {
          playerId: p.id,
          move: { kind: "extend", ...extensionAsk(p) },
        });
        checks.push(`${r ? "PASS" : "INFO"} extension at the player's ask (${p.name})`);
        extended = true;
      }
    }
    if (s.stage === "endOfSeasonAnnounce" || s.stage === "endOfSeasonConsolation") {
      const season = s.season;
      check((s.awards ?? []).some((x) => x.season === season && x.award === "MVP"), `season ${season}: awards written online`);
      check((s.champions ?? []).some((x) => x.season === season), `season ${season}: champion recorded online`);
      check((s.teamSeasons ?? []).some((x) => x.season === season), `season ${season}: team seasons recorded online`);
      const withStats = Object.values(s.players).filter((p) => (p.season_stats?.gamesPlayed ?? 0) > 0).length;
      // ~22 players a team get into a game; a humans-only league has few teams
      const teams = Object.keys(s.teams).length;
      check(withStats > teams * 15, `season ${season}: season stats online (${withStats} players, ${teams} teams)`);
      const reg = s.games.filter((g) => g.phase === "REG" && g.played);
      check(reg.length > 0 && reg.every((g) => !!g.totals), `season ${season}: every played game has a box score online`);
    }

    // ---- everyone takes their turn, then readies up ----------------------
    const bots = BROWSER ? users.slice(1) : users;
    for (const u of bots) await act(u, leagueId, views[users.indexOf(u)]!.state);
    const after = (await stateOf(users[0]!, leagueId)).state;
    if (after.stage === s.stage) {
      // a summary only takes the check-in of a legal roster: let the staff
      // square it up first, as a GM presses the button to
      if (after.stage === "freeAgencySummary" || after.stage === "midseasonFreeAgencySummary") {
        for (const u of bots) await call(u, "POST", `/leagues/${leagueId}/actions/staff-fix`, {});
      }
      for (const u of bots) await call(u, "POST", `/leagues/${leagueId}/actions/ready`, { ready: true });
    }
    if (BROWSER) await new Promise((r) => setTimeout(r, 1500));
  }

  slow.sort((x, y) => y.ms - x.ms);
  const minutes = ((performance.now() - t0) / 60000).toFixed(1);
  console.log(`\n=== e2e: ${SEASONS} season(s), ${HUMANS} humans, format ${FORMAT}${FANTASY ? " (fantasy)" : ""}, ${minutes} min ===`);
  console.log(`stages: ${path.length}; last: ${path.at(-1)}`);
  console.log(`path: ${path.join(" > ")}`);
  console.log(`slowest calls:\n${slow.slice(0, 8).map((x) => `  ${Math.round(x.ms)}ms ${x.what}`).join("\n")}`);
  const uniq = [...new Set(checks)];
  console.log(`checks:\n${uniq.map((c) => `  ${c}`).join("\n")}`);
  console.log(failures.length ? `FAILURES (${failures.length}):\n${[...new Set(failures)].map((f) => `  ${f}`).join("\n")}` : "no failures");
  process.exit(failures.length ? 1 : 0);
}

await main();
