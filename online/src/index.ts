/**
 * The online league server.
 *
 * Distinct from `server/index.ts`, which stays what it always was: a
 * stateless dev adapter that exposes the engine as pure functions, with
 * permissive CORS and no auth, for a single-player client on the same
 * machine. This one owns leagues — it has a database, accounts, and the
 * authority to say no.
 *
 * Run it with `npm run online` (and `npm run online:migrate` once).
 */
import { deferBlockJobs } from "./blockJobs.js";
import { createServer } from "node:http";

import {
  actorFor,
  contractMove,
  draftCoach,
  freeAgencyTurn,
  submitHoodedFigurePayment,
  submitTrainingCamp,
  revealThrough,
  hireCoach,
  settleRookie,
  settleRookies,
  makeDraftPick,
  placeBid,
  proposeTrade,
  releasePlayer,
  releasePlayers,
  respondToTrade,
  withdrawTrade,
  setDepthOrder,
  setDepthOrders,
  signFreeAgent,
  deadlineTurn,
  revealRound,
  stepForward,
  toggleDraftTarget,
} from "./actions.js";
import {
  changePassword,
  franchiseOf,
  isCommissioner,
  issueResetCode,
  login,
  redeemResetCode,
  register,
  signSession,
} from "./auth.js";
import { regenerateBroadcast } from "./blocks.js";
import { ActionError, migrate, pool, readLeague, withLeague } from "./db.js";
import {
  clearSessionCookie,
  get,
  handle,
  post,
  requireUser,
  setSessionCookie,
  type Ctx,
} from "./http.js";
import { feed, inboxFor } from "./inbox.js";
import {
  claimTeam,
  createOnlineLeague,
  leagueByInvite,
  leaguesFor,
  archiveLeague,
  leaveLeague,
  openTeams,
  transferCommissioner,
  vacateSeat,
} from "./leagues.js";
import { forceAdvance, readyUp, sweep, timeLeft, waitingOn } from "./phases.js";
import { clearAttempts, retryAfterSeconds, tooManyAttempts } from "./throttle.js";
import { simulateWeekForLeague } from "./simulate.js";
import type { LeagueState } from "@/domain";
import { cleanConfigPatch, isInSeason } from "@/state/rules.ts";
import { redactedGames, revealedWeek, visibleBracket, visibleGames } from "@/state/reveal.ts";
import { redactHoodedFigureFor } from "@/state/hoodedFigure.ts";
import { recomputeStandings, rewindSeasonStats } from "@/state/standings.ts";
import { rewindInjuries } from "@/state/injuries.ts";
import { openStream, pruneWatchers } from "./stream.js";

const serverStartedAt = new Date().toISOString();

/* ---- deployment identity --------------------------------------------- */

/**
 * Public and deliberately free of secrets. This is the authoritative answer
 * to "which commit is Render actually running?" and lets the release verifier
 * catch a stale API independently of the static UI.
 */
get("/version", async () => ({
  service: "online-api",
  commit: process.env.RENDER_GIT_COMMIT ?? process.env.GIT_COMMIT ?? "unknown",
  branch: process.env.RENDER_GIT_BRANCH ?? process.env.GIT_BRANCH ?? "unknown",
  serviceId: process.env.RENDER_SERVICE_ID ?? null,
  startedAt: serverStartedAt,
}));

/** Body fields, checked at the door so a handler can trust what it reads. */
function field<T>(ctx: Ctx, name: string, kind: "string" | "number" | "boolean" | "object"): T {
  const body = (ctx.body ?? {}) as Record<string, unknown>;
  const v = body[name];
  if (typeof v !== kind || v === null) {
    throw new ActionError(`\`${name}\` is required and must be a ${kind}.`);
  }
  return v as T;
}
function optional<T>(ctx: Ctx, name: string): T | undefined {
  const body = (ctx.body ?? {}) as Record<string, unknown>;
  return body[name] as T | undefined;
}

/* ---- accounts -------------------------------------------------------- */

/**
 * Who is making this attempt, for throttling purposes.
 *
 * Address *and* name together: keyed on the name alone, anyone could lock a
 * GM out of their own league by guessing at their name from the outside,
 * which turns a brake into a weapon.
 */
function attemptKey(ctx: Ctx, name: string): string {
  const fwd = ctx.req.headers["x-forwarded-for"];
  const addr =
    (Array.isArray(fwd) ? fwd[0] : fwd)?.split(",")[0]?.trim() ||
    ctx.req.socket.remoteAddress ||
    "unknown";
  return `${addr}|${name.trim().toLowerCase()}`;
}

post("/auth/register", async (ctx) => {
  const name = field<string>(ctx, "name", "string");
  const key = attemptKey(ctx, name);
  if (tooManyAttempts(key)) {
    ctx.res.setHeader("Retry-After", String(retryAfterSeconds(key)));
    throw new ActionError("Too many attempts. Try again in a little while.", 429);
  }
  const user = await register(name, field(ctx, "password", "string"));
  clearAttempts(key);
  setSessionCookie(ctx.res, signSession(user.id));
  return { user };
});

post("/auth/login", async (ctx) => {
  const name = field<string>(ctx, "name", "string");
  const key = attemptKey(ctx, name);
  if (tooManyAttempts(key)) {
    ctx.res.setHeader("Retry-After", String(retryAfterSeconds(key)));
    throw new ActionError("Too many attempts. Try again in a little while.", 429);
  }
  const user = await login(name, field(ctx, "password", "string"));
  if (!user) throw new ActionError("That name and password don't match.", 401);
  // a correct password means this was never an attack
  clearAttempts(key);
  setSessionCookie(ctx.res, signSession(user.id));
  return { user };
});

// Every session issued before the change is signed out; this one gets a
// fresh cookie so the GM changing it stays signed in here.
post("/auth/password", async (ctx) => {
  const user = requireUser(ctx);
  const key = attemptKey(ctx, user.name);
  if (tooManyAttempts(key)) {
    ctx.res.setHeader("Retry-After", String(retryAfterSeconds(key)));
    throw new ActionError("Too many attempts. Try again in a little while.", 429);
  }
  await changePassword(user, field(ctx, "current", "string"), field(ctx, "password", "string"));
  clearAttempts(key);
  setSessionCookie(ctx.res, signSession(user.id));
  return { ok: true };
});

// A code from the commissioner, for a GM who can't sign in. Throttled like a
// login: the code is the password until it's spent.
post("/auth/reset", async (ctx) => {
  const name = field<string>(ctx, "name", "string");
  const key = attemptKey(ctx, name);
  if (tooManyAttempts(key)) {
    ctx.res.setHeader("Retry-After", String(retryAfterSeconds(key)));
    throw new ActionError("Too many attempts. Try again in a little while.", 429);
  }
  const user = await redeemResetCode(name, field(ctx, "code", "string"), field(ctx, "password", "string"));
  if (!user) throw new ActionError("That name and reset code don't match, or the code has expired.", 401);
  clearAttempts(key);
  setSessionCookie(ctx.res, signSession(user.id));
  return { user };
});

post("/auth/logout", async (ctx) => {
  clearSessionCookie(ctx.res);
  return { ok: true };
});

get("/auth/me", async (ctx) => ({ user: ctx.user }));

/* ---- leagues --------------------------------------------------------- */

get("/leagues", async (ctx) => ({ leagues: await leaguesFor(requireUser(ctx).id) }));

post("/leagues", async (ctx) => {
  const user = requireUser(ctx);
  return createOnlineLeague(user.id, {
    name: field(ctx, "name", "string"),
    humanSlots: optional<number>(ctx, "humanSlots"),
    config: optional(ctx, "config"),
    phaseTimeoutHours: optional<number>(ctx, "phaseTimeoutHours"),
    pickTimeoutHours: optional<number>(ctx, "pickTimeoutHours"),
  });
});

get("/invites/:code", async (ctx) => {
  const league = await leagueByInvite(ctx.params.code!);
  if (!league) throw new ActionError("That invite code doesn't match a league.", 404);
  return { league, openTeams: await openTeams(league.id) };
});

/**
 * Which teams are still free in a league you're already in.
 *
 * The invite lookup answers this for someone joining from outside. A
 * commissioner who just created a league is *inside* it with no team yet, and
 * had no way to ask.
 */
get("/leagues/:id/teams", async (ctx) => {
  const user = requireUser(ctx);
  // A franchise row is the usual proof of membership, but the commissioner
  // who has not claimed yet has no such row — and they are the exact case
  // this route was added for, so asking only about franchises answered 403
  // to the one person it was meant to serve.
  const member =
    (await franchiseOf(ctx.params.id!, user.id)) !== null ||
    (await isCommissioner(ctx.params.id!, user.id));
  if (!member) {
    throw new ActionError("You're not in that league.", 403);
  }
  return { openTeams: await openTeams(ctx.params.id!) };
});

post("/leagues/:id/claim", async (ctx) => {
  const user = requireUser(ctx);
  return claimTeam(ctx.params.id!, user.id, field(ctx, "teamCode", "string"));
});

/**
 * The whole league, for a client that wants to render it.
 *
 * Handing over the entire `LeagueState` is the deliberate choice: the client
 * already knows how to render exactly this object, and hiding parts of it
 * would mean inventing a second, smaller shape and keeping the two in step.
 * The only thing genuinely secret in a league is a sealed free-agency bid,
 * and those are stripped below.
 */
get("/leagues/:id", async (ctx) => {
  const user = requireUser(ctx);
  // A poll that already holds the current version: say so from one row,
  // rather than loading, redacting and sending the whole league again.
  const have = ctx.url.searchParams.get("have");
  if (have) {
    const row = await pool.query<{ version: string; phase_ends_at: Date | null }>(
      `SELECT version, phase_ends_at FROM league_state WHERE league_id = $1`,
      [ctx.params.id!],
    );
    const current = row.rows[0];
    if (
      current &&
      current.version === have &&
      ((await franchiseOf(ctx.params.id!, user.id)) || (await isCommissioner(ctx.params.id!, user.id)))
    ) {
      return {
        unchanged: true,
        version: current.version,
        msLeft: current.phase_ends_at ? Math.max(0, current.phase_ends_at.getTime() - Date.now()) : null,
      };
    }
  }
  const loaded = await readLeague(ctx.params.id!);
  if (!loaded) throw new ActionError("No such league.", 404);
  const franchise = await franchiseOf(ctx.params.id!, user.id);
  const commissioner = await isCommissioner(ctx.params.id!, user.id);
  // `/leagues/:id/stream` and `/leagues/:id/teams` already refuse a
  // non-member; this route — the one that hands back the whole document —
  // did not, and had no test to notice. The league id is an unguessable
  // UUID today, which is the only thing that made that safe in practice
  // rather than in principle: anyone who ever saw one (a pasted link, a
  // support request, a referrer header) could otherwise read a league they
  // have never been invited to for as long as it exists.
  if (!franchise && !commissioner) {
    throw new ActionError("You're not in that league.", 403);
  }

  const state = structuredClone(loaded.state);
  // A live window's bids are sealed until the day resolves; showing another
  // team's offer would turn an auction into a staring contest.
  for (const fa of [state.freeAgency, state.coachingHire]) {
    if (!fa) continue;
    for (const [id, bids] of Object.entries(fa.bids)) {
      fa.bids[id] = bids.filter((b) => b.teamCode === franchise?.teamCode);
    }
  }

  // Change 12: draft stars are private. They live on the shared draft object
  // because the board reads them there, but the league document goes to
  // everybody — so another GM's targets are stripped on the way out rather
  // than merely not rendered.
  if (state.draftTargets) {
    state.draftTargets =
      franchise && state.draftTargets[franchise.gmId]
        ? { [franchise.gmId]: state.draftTargets[franchise.gmId]! }
        : {};
  }
  // the figure's hidden price points, and other GMs' bargains before the reveal
  redactHoodedFigureFor(state, franchise?.teamCode ?? null);
  if (state.draft?.targetsByGm && franchise) {
    state.draft.targetsByGm = Object.fromEntries(
      Object.entries(state.draft.targetsByGm).filter(([gmId]) => gmId === franchise.gmId),
    );
  }

  // A block is simulated once, for every game at once, the moment the
  // checkpoint runs — every result already sits in `state.games` (and, in
  // the postseason, `state.bracket`) whether or not anyone has watched that
  // far. `structuredClone` above copies the whole thing as-is, so without
  // this every GM's own client request was the spoiler: next week's scores
  // and the eventual champion were sitting in the JSON the moment the page
  // loaded, regardless of what the UI chose to render from it. A
  // commissioner who has not claimed a team yet has no `gmId` of their own
  // to reveal against, so they see nothing revealed either — the same as
  // anyone else who has not watched it.
  // the injury report as of this GM's watched week — replayed from the full
  // games, so before they're redacted
  if (state.injuryLedger) {
    rewindInjuries(state, revealedWeek(state, franchise?.gmId ?? "", state.injuryLedger.phase));
  }
  delete state.injuryLedger;
  state.games = redactedGames(state, franchise?.gmId ?? "");
  if (state.bracket) state.bracket = visibleBracket(state.bracket, state, franchise?.gmId ?? "");
  // Standings and stats as of what this GM has watched. Team records and
  // season stats are written when a block is simulated, whole, before anyone
  // watches it — so the standings, the leaderboards and the MVP race used to
  // show results from weeks this GM had not reached.
  if (isInSeason(state.stage) || state.stage === "tradeDeadline" || state.stage.startsWith("midseason")) {
    recomputeStandings(state);
    rewindSeasonStats(state, revealedWeek(state, franchise?.gmId ?? "", "REG"));
  }
  delete state.statLedger;
  // An offer still waiting on an answer is between the two teams in it; once
  // it's answered it's league news. Every GM's pending offers used to ride
  // along in every download.
  {
    const mine = franchise?.teamCode;
    state.trades = state.trades.filter((t) => t.status !== "offered" || t.fromTeam === mine || t.toTeam === mine);
  }
  // Camp: each GM reads their own plan and results. Everyone's went out to
  // everyone — ~120KB a pull, and another GM's camp focus with it.
  if (state.trainingCamp) {
    const mine = franchise?.teamCode;
    state.trainingCamp = {
      ...state.trainingCamp,
      plans: mine && state.trainingCamp.plans[mine] ? { [mine]: state.trainingCamp.plans[mine]! } : {},
      results: mine && state.trainingCamp.results[mine] ? { [mine]: state.trainingCamp.results[mine]! } : {},
    };
  }
  // Players who retired in an earlier season are only history now — a name,
  // a career, a place in the records. Their ratings, contract and injury
  // log went out with every pull anyway, a few hundred more each year: ~10%
  // of the download two seasons in, and growing. This season's retirees keep
  // everything (the retirement review still shows them).
  // (Nothing reads a retired player's ratings at all — the review uses his
  // overall, age, contract and injury count — so those go for this season's
  // retirees too: a few hundred players' attributes, ~8% of a pull.)
  for (const p of Object.values(state.players)) {
    if (!p.retired) continue;
    p.attributes = {} as typeof p.attributes;
    p.scheme_tags = [];
    if ((p.retired_season ?? state.season) >= state.season) continue;
    p.injury_history = [];
    p.contract = null;
  }
  // A prospect's true rating is the draft's one hidden fact: it shows only
  // once the pick is signed or released. It went out with every pull for
  // all 320 prospects, so any GM with the developer tools open could read
  // the busts off the board before drafting.
  // The coaching draft's board and results are only read by its own room;
  // afterwards they rode along with every pull for the life of the league.
  if (state.stage !== "coachingDraft" && state.stage !== "coachingDraftSummary") state.coachingDraft = null;
  state.draftClass = (state.draftClass ?? []).map((pr) =>
    state.rookieOutcomes?.[pr.id] ? pr : { ...pr, trueOverall: 0 },
  );

  return {
    league: { id: loaded.league.id, name: loaded.league.name },
    state,
    version: loaded.version,
    you: franchise?.teamCode.startsWith("unclaimed:") ? null : franchise,
    isCommissioner: commissioner,
    // so whoever is waiting on the rest of the league can chase them from
    // inside it, rather than going back out to the lobby for the code
    inviteCode: commissioner ? loaded.league.inviteCode : null,
    msLeft: timeLeft(loaded),
    waitingOn: waitingOn(loaded.state),
  };
});

/**
 * Play-by-play for one game, rebuilt on request.
 *
 * Gated on the asking GM having revealed it: the league document holds every
 * game of the block, so an ungated endpoint would hand out next week's result
 * to anyone who could guess an id.
 */
get("/leagues/:id/games/:gameId/broadcast", async (ctx) => {
  const user = requireUser(ctx);
  const loaded = await readLeague(ctx.params.id!);
  if (!loaded) throw new ActionError("No such league.", 404);
  const franchise = await franchiseOf(ctx.params.id!, user.id);
  if (!franchise) throw new ActionError("You're not in this league.", 403);

  const gameId = ctx.params.gameId!;
  const seen = visibleGames(loaded.state, franchise.gmId);
  if (!seen.some((g) => g.id === gameId)) {
    throw new ActionError("You haven't watched that game yet.", 403);
  }
  const broadcast = regenerateBroadcast(loaded.state, gameId);
  if (!broadcast) throw new ActionError("No such game.", 404);
  return { broadcast };
});

get("/leagues/:id/feed", async (ctx) => {
  const user = requireUser(ctx);
  // same gap as `/leagues/:id` had: this is a member-only feed of what
  // happened in the league, and nothing here checked membership before now.
  if (!(await franchiseOf(ctx.params.id!, user.id)) && !(await isCommissioner(ctx.params.id!, user.id))) {
    throw new ActionError("You're not in that league.", 403);
  }
  const since = Number(ctx.url.searchParams.get("since") ?? 0);
  return { events: await feed(ctx.params.id!, Number.isFinite(since) ? since : 0) };
});

get("/inbox", async (ctx) => ({ leagues: await inboxFor(requireUser(ctx).id) }));

/**
 * The league, as it happens.
 *
 * An open tab holds this and hears about a trade offer or a draft clock
 * without asking. The frames are small on purpose — a version and the
 * one-line summaries — and the client pulls the league itself only when the
 * version it's holding has gone stale. See `stream.ts`.
 *
 * The response is hijacked: `openStream` writes the headers and keeps the
 * socket, so the router's usual "serialise the return value as JSON" step
 * sees `headersSent` and leaves it alone.
 */
get("/leagues/:id/stream", async (ctx) => {
  const user = requireUser(ctx);
  const leagueId = ctx.params.id!;
  if (!(await franchiseOf(leagueId, user.id))) {
    throw new ActionError("You're not in that league.", 403);
  }
  await openStream(ctx.res, leagueId, user.id, (fn) => {
    ctx.req.on("aborted", fn);
    ctx.res.on("error", fn);
  });
  return undefined;
});

/* ---- actions --------------------------------------------------------- */

/** Every action resolves the caller's franchise first; none of them trust the body. */
async function actor(ctx: Ctx) {
  const user = requireUser(ctx);
  return actorFor(ctx.params.id!, user.id);
}
const version = (ctx: Ctx) => optional<string>(ctx, "version");

post("/leagues/:id/actions/sign", async (ctx) =>
  signFreeAgent(await actor(ctx), field(ctx, "playerId", "string"), field(ctx, "offer", "object"), version(ctx)),
);

post("/leagues/:id/actions/bid", async (ctx) =>
  placeBid(
    await actor(ctx),
    (optional<string>(ctx, "subject") ?? "players") as "players" | "coaches",
    field(ctx, "targetId", "string"),
    field(ctx, "offer", "object"),
    version(ctx),
  ),
);

post("/leagues/:id/actions/trade/propose", async (ctx) =>
  proposeTrade(
    await actor(ctx),
    field(ctx, "toTeam", "string"),
    (optional<string[]>(ctx, "give") ?? []),
    (optional<string[]>(ctx, "get") ?? []),
    version(ctx),
  ),
);

post("/leagues/:id/actions/trade/withdraw", async (ctx) =>
  withdrawTrade(await actor(ctx), field(ctx, "tradeId", "string")),
);

post("/leagues/:id/actions/trade/respond", async (ctx) =>
  respondToTrade(
    await actor(ctx),
    field(ctx, "tradeId", "string"),
    field(ctx, "accept", "boolean"),
    version(ctx),
  ),
);

post("/leagues/:id/actions/draft/pick", async (ctx) =>
  makeDraftPick(await actor(ctx), field(ctx, "selectedId", "string"), version(ctx)),
);

post("/leagues/:id/actions/rookie", async (ctx) =>
  settleRookie(
    await actor(ctx),
    field(ctx, "prospectId", "string"),
    optional<boolean>(ctx, "released") ?? false,
    version(ctx),
  ),
);

post("/leagues/:id/actions/reveal", async (ctx) => {
  const a = await actor(ctx);
  return revealThrough(a, field(ctx, "through", "number"), version(ctx));
});

post("/leagues/:id/actions/draft-target", async (ctx) => {
  const a = await actor(ctx);
  return toggleDraftTarget(a, field(ctx, "prospectId", "string"));
});

post("/leagues/:id/actions/step", async (ctx) => {
  const a = await actor(ctx);
  return stepForward(a, field(ctx, "step", "string"), version(ctx));
});

post("/leagues/:id/actions/reveal-round", async (ctx) => {
  const a = await actor(ctx);
  return revealRound(a, version(ctx));
});

post("/leagues/:id/actions/deadline", async (ctx) => {
  const a = await actor(ctx);
  return deadlineTurn(a, field(ctx, "move", "object"), version(ctx));
});

post("/leagues/:id/actions/training-camp", async (ctx) => {
  const a = await actor(ctx);
  return submitTrainingCamp(a, field(ctx, "plan", "object"), version(ctx));
});

post("/leagues/:id/actions/hooded-figure", async (ctx) => {
  const a = await actor(ctx);
  return submitHoodedFigurePayment(a, field(ctx, "payment", "number"), version(ctx));
});

post("/leagues/:id/actions/fa-turn", async (ctx) => {
  const a = await actor(ctx);
  return freeAgencyTurn(
    a,
    {
      playerId: optional<string>(ctx, "playerId"),
      salary: optional<number>(ctx, "salary"),
      years: optional<number>(ctx, "years"),
      pass: optional<boolean>(ctx, "pass"),
    },
    version(ctx),
  );
});

post("/leagues/:id/actions/coach-draft", async (ctx) =>
  draftCoach(await actor(ctx), field(ctx, "coachId", "string"), version(ctx)),
);

post("/leagues/:id/actions/coach", async (ctx) =>
  hireCoach(await actor(ctx), field(ctx, "coachId", "string"), version(ctx)),
);

post("/leagues/:id/actions/depth", async (ctx) =>
  setDepthOrder(
    await actor(ctx),
    field(ctx, "position", "string"),
    optional<string[]>(ctx, "playerIds") ?? [],
  ),
);

post("/leagues/:id/actions/release", async (ctx) =>
  releasePlayer(await actor(ctx), field(ctx, "playerId", "string"), version(ctx)),
);

post("/leagues/:id/actions/rookies", async (ctx) =>
  settleRookies(await actor(ctx), field(ctx, "prospectIds", "object"), optional<boolean>(ctx, "released") ?? false),
);

post("/leagues/:id/actions/releases", async (ctx) =>
  releasePlayers(await actor(ctx), field(ctx, "playerIds", "object")),
);

post("/leagues/:id/actions/depths", async (ctx) =>
  setDepthOrders(await actor(ctx), field(ctx, "orders", "object")),
);

post("/leagues/:id/actions/contract", async (ctx) =>
  contractMove(
    await actor(ctx),
    field(ctx, "playerId", "string"),
    field(ctx, "move", "object"),
    version(ctx),
  ),
);

post("/leagues/:id/actions/ready", async (ctx) => {
  const a = await actor(ctx);
  const res = await readyUp(
    a.leagueId,
    a.gmId,
    optional<boolean>(ctx, "ready") ?? true,
    optional<string>(ctx, "stage"),
  );

  // In season, "everybody is ready" means *play the week* — there is nothing
  // else for a stage gate to do, because a week advances by being simulated
  // rather than by a transition. Nothing did this: `advanceStage` returns
  // early for an in-season stage, the client never called simulate-week, and
  // so a league readied up and then sat on week one forever.
  //
  // A separate call rather than part of the same transaction, deliberately:
  // `simulateWeekForLeague` takes the league's row lock itself, and it
  // refuses when the week's games are already on file, so two GMs clicking
  // ready at the same moment still produce exactly one week.
  if (isInSeason(res.stage as LeagueState["stage"])) {
    const week = await simulateWeekForLeague(a.leagueId);
    if (week.played) return { ...res, week };
  }
  return res;
});

post("/leagues/:id/actions/simulate-week", async (ctx) => {
  const a = await actor(ctx);
  return simulateWeekForLeague(a.leagueId);
});

/* ---- commissioner ---------------------------------------------------- */

/** "The commissioner set talent impact to Extreme and the draft to snake." */
function describeConfigChange(patch: Record<string, unknown>): string {
  const cap = (v: unknown) => String(v).replace(/^./, (c) => c.toUpperCase());
  const parts = Object.entries(patch).map(([k, v]) => {
    switch (k) {
      case "fantasyDraft":
        return `the fantasy draft ${v ? "on" : "off"}`;
      case "draftOrder":
        return `draft order to ${v === "inOrder" ? "in order" : "randomized"}`;
      case "draftType":
        return `the draft to ${String(v)}`;
      case "fantasyDraftRounds":
        return `the fantasy draft to ${String(v)} rounds`;
      case "draftSimulateAfterPicks":
        return v == null ? "every pick by hand" : `${String(v)} manual pick${v === 1 ? "" : "s"} each`;
      case "talentImpact":
        return `talent impact to ${cap(v)}`;
      case "difficulty":
        return `AI difficulty to ${cap(v)}`;
      case "leagueFormat":
        return `the format to ${v === "humansOnly" ? "human GMs only" : "the full NFL"}`;
      default:
        return k;
    }
  });
  if (parts.length === 0) return "The commissioner changed the league settings.";
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
  return `The commissioner set ${list}.`;
}

// League settings before kickoff: the commissioner's call, saved on the
// league. The settings screen used to change only the viewer's local copy —
// any GM could "change" them, and nobody's change reached the league.
post("/leagues/:id/admin/config", async (ctx) => {
  const user = requireUser(ctx);
  if (!(await isCommissioner(ctx.params.id!, user.id))) {
    throw new ActionError("Only the commissioner can change league settings.", 403);
  }
  const patch = (ctx.body as { patch?: Record<string, unknown> } | undefined)?.patch ?? {};
  const { result } = await withLeague(ctx.params.id!, async ({ state }) => {
    const clean = cleanConfigPatch(state, patch);
    if (!clean.ok) throw new ActionError(clean.reason);
    state.config = { ...state.config, ...clean.patch };
    return {
      result: { ok: true as const },
      state,
      // say what changed — the other GMs are agreeing to play under it
      events: [{ kind: "config.changed", summary: describeConfigChange(clean.patch) }],
    };
  });
  return result;
});

// Leaving: your seat opens for someone else, and the CPU runs the team.
post("/leagues/:id/leave", async (ctx) => {
  const user = requireUser(ctx);
  const out = await leaveLeague(ctx.params.id!, user.id);
  await pruneWatchers(ctx.params.id!).catch(() => 0);
  return out;
});

// The commissioner retires a league from everyone's lobby.
post("/leagues/:id/admin/archive", async (ctx) => {
  const user = requireUser(ctx);
  const out = await archiveLeague(ctx.params.id!, user.id);
  await pruneWatchers(ctx.params.id!).catch(() => 0);
  return out;
});

// A GM who forgot their password: accounts have no email, so the commissioner
// issues a one-time code (24 hours) and passes it on however the league talks.
post("/leagues/:id/admin/reset-code", async (ctx) => {
  const user = requireUser(ctx);
  if (!(await isCommissioner(ctx.params.id!, user.id))) {
    throw new ActionError("Only the commissioner can do that.", 403);
  }
  const teamCode = field<string>(ctx, "teamCode", "string");
  const rows = await pool.query<{ user_id: string; name: string }>(
    `SELECT f.user_id, u.name FROM franchises f JOIN users u ON u.id = f.user_id
      WHERE f.league_id = $1 AND f.team_code = $2`,
    [ctx.params.id!, teamCode],
  );
  const gm = rows.rows[0];
  if (!gm) throw new ActionError("Nobody holds that team.");
  return { name: gm.name, code: await issueResetCode(gm.user_id, user.id) };
});

// Who holds which seat, for the commissioner's controls in the lobby — they
// lived only in the check-in panel, which a draft or a free-agency market
// doesn't have.
get("/leagues/:id/gms", async (ctx) => {
  const user = requireUser(ctx);
  if (!(await isCommissioner(ctx.params.id!, user.id))) {
    throw new ActionError("Only the commissioner can do that.", 403);
  }
  const rows = await pool.query<{ team_code: string; name: string; user_id: string }>(
    `SELECT f.team_code, u.name, f.user_id FROM franchises f JOIN users u ON u.id = f.user_id
      WHERE f.league_id = $1 AND f.user_id IS NOT NULL ORDER BY f.team_code`,
    [ctx.params.id!],
  );
  return { gms: rows.rows.map((r) => ({ teamCode: r.team_code, name: r.name, you: r.user_id === user.id })) };
});

// The commissioner hands the role on (they can't leave while they hold it).
post("/leagues/:id/admin/commissioner", async (ctx) => {
  const user = requireUser(ctx);
  return transferCommissioner(ctx.params.id!, user.id, field(ctx, "teamCode", "string"));
});

// A GM who quit: the CPU takes the team and the seat opens for a newcomer.
post("/leagues/:id/admin/vacate", async (ctx) => {
  const user = requireUser(ctx);
  if (!(await isCommissioner(ctx.params.id!, user.id))) {
    throw new ActionError("Only the commissioner can do that.", 403);
  }
  const out = await vacateSeat(ctx.params.id!, user.id, field(ctx, "teamCode", "string"));
  await pruneWatchers(ctx.params.id!).catch(() => 0);
  return out;
});

post("/leagues/:id/admin/advance", async (ctx) => {
  const user = requireUser(ctx);
  if (!(await isCommissioner(ctx.params.id!, user.id))) {
    throw new ActionError("Only the commissioner can do that.", 403);
  }
  return forceAdvance(ctx.params.id!);
});

/* ---- lifecycle ------------------------------------------------------- */

const PORT = Number(process.env.PORT ?? 8788);

export const server = createServer((req, res) => void handle(req, res));
// Hold idle connections open longer than the load balancer in front of us
// does. Node's default closes them after 5 seconds, so a proxy (or a client)
// reusing one at that moment gets a reset: a 502 for a GM, ECONNRESET in the
// e2e harness. The headers timeout has to sit above it.
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;

if (process.env.NODE_ENV !== "test") {
  // blocks of games play on a worker thread, not the event loop (blockJobs.ts)
  deferBlockJobs(true);
  // Listen first, unconditionally. This used to await `migrate()`, so a
  // database that refused the connection took the process down with it —
  // Render marked the deploy failed and served nothing at all, which looks
  // from the outside exactly like the server having vanished. It is far more
  // useful to be up and able to say what is wrong.
  server.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`online league server on :${PORT}`);
  });

  // The schema still has to exist before anything works, so this is not
  // optional — but it is recoverable. It retries with backoff rather than
  // trying once: a free-tier Postgres that is waking up refuses the first
  // connection, and a single failed attempt left the server up but unable
  // to serve a single league until someone restarted it.
  const migrateWithRetry = (attempt: number): void => {
    migrate()
      .then(() => {
        // eslint-disable-next-line no-console
        console.log("schema ready");
        // A server woken from sleep has deadlines that passed while it was
        // down; resolve them now rather than a minute after the GM arrived.
        sweep().catch((err: unknown) => {
          // eslint-disable-next-line no-console
          console.error("start-up sweep failed; the minute sweep will retry", err);
        });
      })
      .catch((err: unknown) => {
        const wait = Math.min(60_000, 2_000 * 2 ** attempt);
        // eslint-disable-next-line no-console
        console.error(`could not reach the database — retrying in ${wait / 1000}s`, err);
        setTimeout(() => migrateWithRetry(attempt + 1), wait).unref();
      });
  };
  migrateWithRetry(0);

  // A failed sweep is logged and retried next minute. It used to be a
  // fire-and-forget promise, so one dropped database connection (a managed
  // Postgres restarting, a network blip) was an unhandled rejection that took
  // the whole league server down.
  setInterval(() => {
    sweep().catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error("deadline sweep failed; retrying next minute", err);
    });
  }, 60_000).unref();
}
