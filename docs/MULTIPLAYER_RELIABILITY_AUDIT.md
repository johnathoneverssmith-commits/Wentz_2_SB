# Multiplayer reliability audit

Branch `claude/kind-johnson-iwj1n9`, cut from `master` at `b292228`. Scope: `online/` (league server,
Postgres persistence, stage machine, sweeper, SSE). **Audit only: no server, UI, engine or rules code
was changed.** Everything added is a test or an isolated dev script, listed at the end.

All results below are **local**, on a throwaway PostgreSQL 16.15 (the version CI runs), never PGlite
for the concurrency work and never a deployed database. CI on a pull request remains the authority.

## 1. What is already adequate

| Concern | Mechanism | Evidence |
|---|---|---|
| Two writers to one league | `withLeague`: `SELECT … FOR UPDATE OF s`, decide re-runs against the *current* state, `UPDATE … WHERE version = $n` as a second guard | `concurrency.test.ts`; drill step 1 (two browsers, same pick → one 200, one 409) |
| Partial writes / crashes | Whole action (state, events, seat table) is one transaction; block sims run *inside* it, so a crash loses the click, not half a stage | `reliability-audit` "throws after moving the stage"; drill step 4 (SIGKILL mid-transaction: version, draft and events unchanged; retry applies once) |
| Stale browser, money-moving actions | `expectedVersion` → 409 on sign, bid, propose, respond, choose-job | `reliability-audit` "expectedVersion from before…"; `concurrency.test.ts` |
| Stale browser, turn actions | Deliberately unversioned; the decide layer refuses by turn / ownership / "already answered" | `fault-injection.test.ts` (pure); drill step 2 |
| Repeated / racing readies | `already` short-circuit rolls back (no version bump); `seenStage` ignores a ready for a stage the league left | `concurrency.test.ts`, `poll-unchanged.test.ts`; `reliability-audit` (10 parallel readies = +1 version; last two GMs at once = one advance) |
| Reconnect / refresh | Sessions are signed cookies (any number per user); `GET /leagues/:id?have=` answers `unchanged`; SSE sends `hello` with the current version on reconnect | drill step 3 |
| Server restart | Nothing in memory is authoritative: the version-keyed text cache and SSE watchers are rebuilt; the start-up sweep resolves deadlines that passed while down | drill step 4; `sweep()` |
| Authorization | Identity from the signed cookie, seat read from `franchises`, never from the body; non-members get 403 on read, feed, stream, broadcast; commissioner routes re-check | `lobby.test.ts`, `result-visibility.test.ts`, `commissioner-*.test.ts` |
| Seat races | `claimTeam` runs under the league lock with a unique key as backstop; vacating a seat clears readiness and advances a league that was waiting on it | `lobby.test.ts`, `vacate-*.test.ts` |
| Game determinism | Seeds are a function of the fixture, so a replay or a regenerated broadcast is identical | `preseason-block.test.ts`, `playoff-block.test.ts` |

## 2. Confirmed defects, ranked

Each has a test that asserts the *wanted* behaviour wrapped in `it.fails`. They are green while the
defect exists and go red the day it is fixed (flip them to plain `it` then).

### D1 — HIGH — A database connection lost mid-transaction kills the whole server

`withLeague` checks a client out of the pool; `pg-pool` removes its error listener on checkout and
`withLeague` adds none. A dropped connection (managed Postgres restart or failover, an
idle-in-transaction kill while a block sim holds the lock, a network blip) emits `error` on a client
nobody listens to, which is an uncaught exception. Measured: the process exits with code 1. Every
league on the server goes down, not only the one in flight, and every SSE stream drops.
`pool.on("error")` in `db.ts` only covers *idle* clients, so the existing comment about "one blip took
the whole server down" describes a fix for the other half of the same problem.
- Repro: `reliability-audit.test.ts` › "a database connection lost mid-transaction takes the whole server process down" (spawns `test/helpers/connection-loss-child.ts`, which exits 1 without printing `SURVIVED`).
- Same bug in `createOnlineLeague`'s own `pool.connect()` (`leagues.ts:96`).

### D2 — MEDIUM — One league's long transaction can starve the whole connection pool

`withLeague` takes a pool connection first and blocks on the row lock second, and a stage that opens
a block of games plays it inside the transaction, holding the lock for the whole simulation. Each GM
action for that league meanwhile parks on a connection of its own. When parked writers reach
`DB_POOL_MAX` (default 8, the size of a full league), every other query in the process waits:
polls, another league's actions, logins, the sweep. Measured with a pool of 4 and 3 parked writers:
an unrelated league's one-row read waited 2.2 s for a 2.5 s simulation. There is no `lock_timeout`,
`statement_timeout` or `idle_in_transaction_session_timeout` anywhere.
- Repro: `reliability-pool.test.ts`.

### D3 — MEDIUM — Overlapping sweeps take the *next* GM's turn

`sweep()` lists expired leagues before taking the lock and never re-checks `phase_ends_at` inside it,
contrary to its doc comment ("a second sweeper finds nothing to do"). Overlap is realistic: the
`setInterval` has no in-flight guard and a sweep that plays block sims can outlast 60 s; the start-up
sweep also races the first interval; a Render deploy runs two instances for a while. Measured: with
GB's clock expired, two overlapping sweeps made two picks, the second being KC's, whose clock had just
restarted. A GM loses a draft pick, free-agency turn or deadline turn without their clock running out.
- Repro: `reliability-audit.test.ts` › "two overlapping sweeps also take the NEXT GM's pick".

### D4 — MEDIUM — Commissioner "force advance" has no stage or version, so a double press skips a stage

`POST /admin/advance` sends `{}`; `forceAdvance` advances whatever is current. Measured over HTTP: two
presses at once moved `fantasyDraft → fantasyDraftSummary → coachingDraft`; in the module test a second
press jumped from `coachingDraft` straight to `coachingDraftSummary`, skipping the whole coaching draft
for everyone (the autopilot plays the humans' picks). A retry after a dropped response or a
commissioner tab one stage behind does the same.
- Repro: `reliability-audit.test.ts` (force-advance) and `dev/reliability-drill.ts` step 5.

### D5 — LOW/MEDIUM — A request resolved before a seat changed hands is applied after

`actorFor` reads `franchises` outside the transaction and `run()` never re-checks inside it. A request
queued behind a long block sim (D2) can therefore execute after the commissioner vacated that GM, as
the CPU's team, or as the next GM who claims the seat (same `gmId`). Measured: a game plan was written
onto KC after KC's seat was vacated. The same gap exists in `leaveLeague`, which reads the seat before
`vacateSeat` and doesn't confirm the seat is still the leaver's.
- Repro: `reliability-audit.test.ts` › "an action resolved for a GM before their seat was vacated…".

### D6 — LOW — A double-submitted trade offer creates two live offers

`tradeId = trade_${Date.now()}_${team}` and nothing compares a new offer with an identical open one,
so a retry or double click puts two copies in the partner's inbox. Harmless to the ledger (accepting
one makes the other fail its asset check) but noisy and confusing. CPU partners are unaffected: they
answer deterministically on the spot.
- Repro: `reliability-audit.test.ts` › "a double-submitted trade offer…".

### D7 — LOW (hardening) — `ready` without `stage` is accepted

The shipped client always sends `stage`, but the route treats it as optional, so a cached old bundle
or script gets the stale-ready bug the parameter was added to fix (commits a GM to a stage they have
not seen).
- Repro: `reliability-audit.test.ts` › "a ready that omits `stage`…".

### Observations, not confirmed defects

- **Single-instance assumptions.** Commit notification, the SSE watcher set and the sweeper's overlap
  protection are per process. SSE has a 30 s cross-process poll as a net, so correctness survives two
  instances, but D3 gets worse with them. If Render runs one instance, say so in `DEPLOY.md`.
- **`/actions/ready` is two transactions in season** (`readyUp`, then `simulateWeekForLeague`). Today
  the second does nothing in the block model (readiness is cleared on advance), and a crash between
  them is recovered by the next ready or sweep. Worth deleting when convenient; not urgent.
- **Unversioned actions that accept `version` and drop it** (`makeDraftPick`, `settleRookie`,
  `contractMove`, `releasePlayer`, `hireCoach`, …) are safe only as far as each `decide*` guard is.
  `contractMove` and `hireCoach` are the two worth a second look when the finances redesign lands.
- **Not tested:** real multi-instance behaviour, Neon/Render-specific connection limits, and a
  scale-to-zero database waking mid-request. PGlite cannot reproduce locks or true concurrency.

## 3. Scenario coverage

| Requested scenario | Existing test | Added here | Result |
|---|---|---|---|
| Two users deciding at once | `concurrency`, `fault-injection` C/H | audit (simultaneous readies), drill 1 | holds |
| Duplicate submission | `fault-injection` A/B/F (pure) | audit (10× ready), drill 1, trade double-submit | holds except D6 |
| Reconnect during a draft/FA turn | none at the HTTP level | drill 3 | holds |
| Server stop/restart mid-stage | none | audit (throw), drill 4 (SIGKILL) | holds; D1 for lost connection |
| Stale browser | `fault-injection` G/I, `concurrency` | audit (stale ready, version 409), drill 2 | holds except D7 |
| Repeated stage advance | `vacate-advances` | audit, drill 5 | **D4** |
| Several sessions, one league | none | drill 1 and 3 (two cookies per user) | holds; D5 on seat change |
| Sweeper vs actions / itself | none | audit sweeps | **D3** |
| Pool under a long transaction | none | `reliability-pool` | **D2** |

## 4. Recommended minimum-scope fixes

1. **D1** In `withLeague` (and `createOnlineLeague`), `client.on("error", log)` right after
   `pool.connect()` and `removeListener` in `finally`; the failed query already rejects, so the request
   returns a 500 and rolls back. Optional belt: a logged `process.on("uncaughtException")` is *not*
   recommended, it hides real faults.
2. **D2** (a) A per-league in-process queue ahead of `pool.connect()` so waiting writers don't hold
   connections; (b) `SET LOCAL lock_timeout = '20s'` after `BEGIN`, mapped to a 503 "try again";
   (c) `idle_in_transaction_session_timeout` above the longest sim. Do (a) and (b); leave the pool
   size alone.
3. **D3** Inside the sweep's lock: `if (!loaded.phaseEndsAt || loaded.phaseEndsAt > new Date()) return { unchanged: true }`.
   And an `inFlight` guard on the `setInterval`.
4. **D4** `POST /admin/advance` takes an optional `stage`; under the lock, refuse with 409 if it
   differs from the current stage. Server-only change is backward compatible; sending `stage` needs a
   one-line change in `OnlineLeagueClient.forceAdvance` and its caller (UI, so out of this
   workstream's remit; coordinate).
5. **D5** In `run()`, inside the transaction, refuse unless `state.gms` has `actor.gmId` with
   `isHuman && teamCode === actor.teamCode`. Autopilot calls `decide*` directly, not `run`, so CPU
   turns are untouched. Re-check the seat in `vacateSeat` for `leaving`.
6. **D6** In `decideProposeTrade`, refuse when an `offered` trade with the same teams and asset sets
   already exists. No valuation logic involved.
7. **D7** Make `stage` mandatory on `/actions/ready` after D4's client change ships and old tabs age out.

## 5. Files likely to change

`online/src/db.ts` (D1, D2), `online/src/leagues.ts` (D1 in `createOnlineLeague`, D5 in `leaveLeague`),
`online/src/phases.ts` (D3, D4), `online/src/index.ts` (D3 interval guard, D4 route, D7),
`online/src/actions.ts` (D5), `online/src/decide.ts` (D6), `online/DEPLOY.md` (instance count).
Client, only for D4/D7: `ui-source/src/sim/OnlineLeagueClient.ts` and the commissioner control that calls it.

## 6. Conflicts with the other workstreams

- **Codex, UI-3 roster and finances.** No overlap in server files unless it changes the payloads of
  `contractMove`, `releasePlayer(s)`, `setDepthOrder(s)` (`actions.ts` / `decide.ts`). D5 touches the
  shared `run()` wrapper those go through, so land D5 after UI-3 or rebase over it. D4/D7 touch
  `OnlineLeagueClient.ts`, a file UI-3 may also edit.
- **Claude, franchise balance audit.** None in the code. Engine or ratings changes can move
  `passing-volume.test.ts`'s baseline, which is unrelated to these fixes.
- Nothing here touches gameplay calculations, CPU algorithms, trade valuation, the cap, Arcade or
  the cancelled C2 logic.

## 7. Proposed sequence

1. D1 (small, high value, no dependencies; do before any playtest).
2. D3 (small, server-only).
3. D2 (a)+(b) (the largest; needs a deploy-time check of connection limits on the chosen Postgres).
4. D4 server half, then client half with the UI owners, then D7.
5. D5 after UI-3 merges.
6. D6.
Flip each `it.fails` to `it` in the same commit as its fix.

## 8. What was added (tests and isolated infrastructure only)

- `online/test/reliability-audit.test.ts`: 7 passing safeguard tests and 6 `it.fails` defects (D1, D3, D4, D5, D6, D7). Needs real PostgreSQL.
- `online/test/reliability-pool.test.ts`: D2.
- `online/test/helpers/connection-loss-child.ts`: the child process D1's test spawns.
- `online/dev/reliability-drill.ts`: starts the real server as a child process, drives it over HTTP as several browsers, SIGKILLs it mid-transaction; refuses any non-local `DATABASE_URL`. Not in `online:test` (it applies the schema).

Run:

```bash
DATABASE_URL=postgres://postgres@127.0.0.1:5544/postgres CI=true npx vitest run --root online test/reliability-audit.test.ts test/reliability-pool.test.ts
```

```bash
DATABASE_URL=postgres://postgres@127.0.0.1:5544/postgres npx tsx --tsconfig online/tsconfig.json online/dev/reliability-drill.ts
```

Local verification: online typecheck clean; 12 online test files (these two plus `concurrency`,
`vacate-*`, `lobby`, `result-visibility`, `fault-injection`, `startgate`, `commissioner-transfer`,
`poll-unchanged`, `no-schema-in-suites`) → 134 passed, 7 expected-fail, 1 skipped; drill → 17 of 18
checks pass, the one failure being D4. The full online suite was not run.
