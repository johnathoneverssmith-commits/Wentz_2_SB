# Online leagues

One league, one team per human GM, played asynchronously over months. Sessions
are short, the gaps between them are days, and no two GMs are ever online
together. The league lives here, not in anybody's browser.

**This is not deployed and not reachable from the internet.** It runs locally
against a local Postgres. Deployment is the last step and hasn't been taken.

## Running it

```bash
createdb nfl_franchise
export DATABASE_URL=postgres://localhost:5432/nfl_franchise
npm run online:migrate      # once
npm run online              # :8788
```

Two environment variables matter in production and neither has a safe default:

| | |
|---|---|
| `SESSION_SECRET` | Signs session cookies. The server refuses to start in production without it. Changing it logs everyone out. |
| `CLIENT_ORIGIN` | The exact origin the UI is served from. Sessions are cookies, so CORS can't use `*`. |

## What is different from `server/`

`server/index.ts` stays exactly what it was: a stateless dev adapter that
exposes the engine as pure functions, with permissive CORS and no auth, for a
single-player client on the same machine. It is still the right thing for
local play and the standalone build.

This server owns leagues. It has a database, accounts, and the authority to
say no.

## The three decisions worth knowing

**The league is a document; everything else is a table.** `league_state.state`
holds the whole `LeagueState` as JSONB. The rules that govern a league
(`ui-source/src/state/rules.ts`) are pure functions over that entire object —
shredding it across thirty tables would mean rewriting every one of them
against rows, and those functions *are* the game. Users, franchises, invites
and the event log are ordinary tables, because finding a league, knowing who
owns a team and answering "what's waiting on me" are things a database should
do.

**One set of rules governs both sides.** The client greys out a button using
`checkTrade`; the server refuses the request using the same `checkTrade`,
re-run against the league as it is at commit time rather than as the client
last saw it. That's why the rules were lifted out of `store.ts` into
`rules.ts` — importing them used to drag in zustand and `localStorage`, which
is fine in a tab and fatal in Node. `rulesPortable.test.ts` keeps it that way.

**Concurrency is `SELECT … FOR UPDATE` and a version column, and nothing
cleverer.** Every mutating action goes through `withLeague`, which locks the
league's row, hands the handler the state as it is *now*, and asserts the
version it read when it writes. Two GMs bidding on the same free agent seconds
apart is the case this exists for: the second one's cap check runs after the
first one's signing has committed, sees the money gone, and is refused —
rather than both succeeding and leaving a team $30M over.

## Async play

Nobody can be allowed to stall a league by not logging in, and nobody should
be punished for going on holiday. So every phase carries a real-world
deadline (`phase_timeout_hours`, default 48; the draft uses
`pick_timeout_hours`, default 12, because one pick shouldn't get two days
while the room waits). A GM who shows up acts for themselves. A GM who
doesn't gets played by the same AI that runs the unclaimed teams.

`sweep()` runs every minute, finds leagues whose clock has run out, takes the
absent GMs' turns and moves on. It's idempotent and takes the same row lock
an action would, so running it twice or during somebody's action is safe.

The commissioner — whoever created the league — can force a phase on early,
for the cases a timeout handles badly.

## Layout

```
schema.sql          the tables, with the reasoning for the document/table split
src/db.ts           the pool, and `withLeague` — the one transaction shape
src/auth.ts         scrypt passwords, signed-cookie sessions, ownership checks
src/http.ts         a router over node:http; no framework, matching server/
src/decide.ts       what each action *decides* — pure, no database
src/actions.ts      the same actions as endpoints: lock, decide, persist, log
src/phases.ts       readiness, deadlines, and the AI taking an absent GM's turn
src/simulate.ts     running a week once every human GM is ready
src/inbox.ts        "what's waiting on me", and the league's event feed
src/stream.ts       server-sent events: telling an open tab the league moved
src/leagues.ts      create, invite, claim
test/               decisions and phases run without a database; concurrency
                    needs one and says so in the test name when it's missing
```

`ui-source/src/sim/OnlineLeagueClient.ts` is the client half.

## Tests

```bash
npm run online:test
```

47 pass without a database. The five concurrency tests need one — set
`DATABASE_URL` and they'll run; without it they report themselves as skipped
in the test name rather than passing quietly.

**An in-memory Postgres won't do.** `pg-mem` was tried, so that the database
half could run in CI without one. It applies `schema.sql` cleanly and handles
the inserts, the versioned update, `BIGSERIAL` and the joins — and then fails
on the two things that matter. `SELECT … FOR UPDATE OF s` doesn't parse,
which is the row lock the whole concurrency design rests on. Worse,
`WHERE league_id = ANY(ARRAY[…])` — the stream's poll — returns no rows
rather than an error, which is a wrong answer rather than a missing feature.
A suite that passes against a database behaving differently from the one this
server requires is worse than a suite that says it was skipped. Run a real
Postgres.

## The client seam

`ui-source/src/sim/OnlineLeagueClient.ts` is the transport.
`ui-source/src/state/online.ts` holds the session — which league, which team,
and the version token that goes out with anything that spends money.
`ui-source/src/state/useLeagueActions.ts` is the interface a screen uses: one
set of async verbs that either mutate the local store or call the server,
depending on which kind of league you're in.

Every verb is async, and that's the design problem in one word. Locally a cap
check fails instantly; online it fails after a round trip, against a league
that may have moved since the page loaded. A screen that assumes the first
can never work online, so the shared interface takes the slower shape and the
local implementation resolves immediately.

The store's own actions keep their synchronous signatures on purpose.
Single-player is finished and working; converting twenty screens to `await`
for a mode that isn't switched on would risk a working game for no gain
today. Screens move onto the hook one at a time, and the ones that haven't go
on calling the store directly.

## Hearing about it

A GM with the app open should not have to refresh to find out they've been
offered a trade, and should not have to poll to avoid it — eight clients each
re-downloading a multi-megabyte league every few seconds to learn that
nothing happened is worse than the problem.

So `GET /leagues/:id/stream` holds a server-sent-events connection open and
pushes a small frame when the league changes: the new version, and the
one-line summaries of what happened. The client compares versions and only
pulls the league when the frame says something it doesn't already have —
which means its own actions, which it has already applied, cost nothing.

Two things deliver a change. An in-process hook fires the instant a
`withLeague` transaction commits, which is the path that actually runs and is
immediate. A slow poll of `league_state.version` covers what that hook can't
see — a second server process — and costs one indexed query every few
seconds, only while somebody is watching. `LISTEN`/`NOTIFY` would replace the
second and is more elegant, but it wants a dedicated connection with its own
reconnect story; for a league whose interesting events are hours apart, a
five-second floor on cross-process news buys nothing worth that.

`EventSource` reconnects on its own, and a browser without it falls back to
the polling the caller already does rather than failing to join.

## The way in

`ui-source/src/screens/OnlineLobby.tsx`, at `#/online`. Sign in or create an
account, see the leagues you're in and what each one is waiting on you for,
join one with an invite code, or start your own and get a code to hand out.

It is the only screen that talks to this server directly rather than through
the store, and that's deliberate: signing in, creating a league and claiming a
team all happen *before* there is a league to put in the store.

With nothing listening on :8788 it says so — plainly, with the two commands
that would start it — rather than spinning. A single-player dynasty is
untouched either way.

## Still to do

- Move the screens onto `useLeagueActions` — Free Agency and Trade Proposal
  first, since they're the ones where a stale view actually costs something.
- Deploy: a host, a managed Postgres, and a check that the engine's
  `artifacts/**/portable/*.json` reads work from the deployed filesystem.
