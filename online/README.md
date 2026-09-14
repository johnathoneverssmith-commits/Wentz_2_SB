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
src/leagues.ts      create, invite, claim
test/               decisions and phases run without a database; concurrency
                    needs one and says so in the test name when it's missing
```

`ui-source/src/sim/OnlineLeagueClient.ts` is the client half.

## Tests

```bash
npm run online:test
```

35 pass without a database. The five concurrency tests need one — set
`DATABASE_URL` and they'll run; without it they report themselves as skipped
in the test name rather than passing quietly.

## Still to do

- Wire the client's store to `OnlineLeagueClient` behind a mode switch, so
  the same screens drive either a local league or an online one.
- An SSE endpoint so an open tab hears about a trade offer without polling.
- Deploy: a host, a managed Postgres, and a check that the engine's
  `artifacts/**/portable/*.json` reads work from the deployed filesystem.
