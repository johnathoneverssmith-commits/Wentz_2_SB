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
import { createServer } from "node:http";

import {
  actorFor,
  contractMove,
  hireCoach,
  makeDraftPick,
  placeBid,
  proposeTrade,
  releasePlayer,
  respondToTrade,
  setDepthOrder,
  signFreeAgent,
} from "./actions.js";
import { franchiseOf, isCommissioner, login, register, signSession } from "./auth.js";
import { ActionError, migrate, readLeague } from "./db.js";
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
  openTeams,
  repairUnclaimedGms,
} from "./leagues.js";
import { forceAdvance, readyUp, sweep, timeLeft, waitingOn } from "./phases.js";
import { clearAttempts, retryAfterSeconds, tooManyAttempts } from "./throttle.js";
import { simulateWeekForLeague } from "./simulate.js";
import type { LeagueState } from "@/domain";
import { isInSeason } from "@/state/rules.ts";
import { openStream } from "./stream.js";

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
  const loaded = await readLeague(ctx.params.id!);
  if (!loaded) throw new ActionError("No such league.", 404);
  const franchise = await franchiseOf(ctx.params.id!, user.id);

  const state = structuredClone(loaded.state);
  // A live window's bids are sealed until the day resolves; showing another
  // team's offer would turn an auction into a staring contest.
  for (const fa of [state.freeAgency, state.coachingHire]) {
    if (!fa) continue;
    for (const [id, bids] of Object.entries(fa.bids)) {
      fa.bids[id] = bids.filter((b) => b.teamCode === franchise?.teamCode);
    }
  }

  const commissioner = await isCommissioner(ctx.params.id!, user.id);
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

get("/leagues/:id/feed", async (ctx) => {
  requireUser(ctx);
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
  const res = await readyUp(a.leagueId, a.gmId, optional<boolean>(ctx, "ready") ?? true);

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

if (process.env.NODE_ENV !== "test") {
  await migrate();
  // leagues made before unclaimed slots stopped counting as people are still
  // blocked on GMs who don't exist; this unblocks them in place
  const repaired = await repairUnclaimedGms();
  if (repaired > 0) {
    // eslint-disable-next-line no-console
    console.log(`unblocked ${repaired} league(s) waiting on unclaimed GM slots`);
  }
  server.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`online league server on :${PORT}`);
  });
  // The deadline sweeper. A minute is far finer than the hours-long phases it
  // polices; it's cheap because it only touches leagues whose clock has run.
  setInterval(() => void sweep(), 60_000).unref();
}
