# Multiplayer reliability, fairness and commissioner recovery (Agent 7)

Base: `master` at `fc20945`. PR #73 was **not merged** when this was written, so Task 6 (CPU roster repair) is assessed
from `master`'s code only and must be re-run after #73 lands (see "Not verified").

## What changed (small, no schema change)

| Change | Where |
|---|---|
| **Commissioner pause / resume** (`POST /leagues/:id/admin/pause`, `/admin/resume`). Stored in the league document as `state.pause`, so no migration. Pause freezes the phase clock (remaining time restored on resume). | `online/src/leagues.ts`, `index.ts`, `ui-source/src/domain/league.ts` |
| **Default-deny gate**: while paused, `withLeague` refuses (HTTP 423) every request that does not declare `allowWhilePaused`: GM decisions, check-ins, week sims, forced advance, staff-takes-turn, the clock sweep, league-setting changes. Recovery controls declare it: pause/resume, vacate/leave, claim a seat, hand over / claim the commissioner role, turn-clock hours. | `online/src/db.ts` |
| A vacate **while paused does not advance** the league (no CPU turns, no check-in cascade); resume does that work once. | `leagues.ts` |
| **Audit**: vacate, hand-over, turn-hours and settings changes now record *who* pressed them (`events.actor_user`); they previously recorded `null`. Pause and resume write `league.paused` / `league.resumed`. | `leagues.ts`, `index.ts` |
| Lobby "Manage GMs" panel: pause and resume buttons. Thin client methods. | `OnlineLobby.tsx`, `OnlineLeagueClient.ts` |
| Test: `online/test/commissioner-recovery.test.ts` (5 tests). | |
| Tooling (no production path): `online/dev/multiplayer-browser-journey.mjs`, `multiplayer-restart-check.mjs`, `multiplayer-perf-probe.mjs`. All refuse a non-loopback URL / non-test database. | |

**Not changed:** simulation, draft AI, contracts, styling, schema, CI.

## Task 5 — commissioner recovery assessment

| Need | Status on master | After this PR |
|---|---|---|
| Pause a league | **absent** | `pause` / `resume` |
| See who is blocking | present: `waitingOn` is in every `GET /leagues/:id` | unchanged |
| Abandoned human slot | present: `admin/vacate` (CPU runs it, seat reopens) | now audited with actor; safe while paused |
| Transfer team to CPU | present (vacate) | — |
| Restore human control | present: anyone with the invite claims the open seat, team "as it stands" (incl. the original user) | works while paused |
| Resume a stalled phase without duplication | present: `admin/advance` (needs `expectedStage`; stale presses 409), `admin/take-turn` (audited, names what staff did) | refused while paused |
| Commissioner cannot see hidden choices / results | `GET /leagues/:id` redacts per the *caller's* seat; the commissioner's `/gms` lists names and teams only | unchanged |

Authorisation is re-checked **inside the transaction under the row lock** (`assertCommissionerLocked`), so a role
handed over between request and lock cannot be used. Two simultaneous resumes apply once (200 + 409, tested).

**Design decision for approval:** `take-turn` for an absent GM is the existing, audited, disclosed staff action; I did
not extend it. Pausing is the non-invasive alternative. A "freeze one GM's seat without a CPU takeover" control would be a
rules change and was not implemented.

## Real-server browser journey (Task 1, 8)

Script: `online/dev/multiplayer-browser-journey.mjs` — three independent Chromium contexts (three accounts / cookie
jars) against the real server and a real database. **25/25 checks pass**, on two consecutive runs:

1. three GMs register through the UI; Alice creates a 3-GM league; invite code issued;
2. Bob and Cara join with the code and claim different teams in the UI; Alice claims hers; after a page reload each sees
   their own team; all three resolve the same league id, stage and three distinct teams;
3. over HTTP from each GM's own cookie jar: non-commissioner pause → 403; pause → every GM sees it; check-in while paused
   → 423; forced advance while paused → 423; refused requests wrote nothing (version unchanged); non-commissioner resume
   → 403; two simultaneous resumes → 200 + 409; stale-stage check-in → 409; double-clicked check-in harmless; pause/resume
   in the feed; all three check in → exactly one transition `setup → fantasyDraft`; all GMs see the same version/stage;
   no uncaught page errors in any context.

`multiplayer-restart-check.mjs` (run after killing and restarting the server on the same database, 5/5 checks): accounts,
league version (9) and stage (`fantasyDraft`) survive; a stale version token on a guarded action → 409; a GM not on the clock
cannot pick for the on-clock team (409); **three simultaneous identical picks → exactly one applied** (200, 409, 409); the
player exists once and appears once in the draft results.

**Honest limit:** the browser journey covers lobby → join → team selection → check-in → the start of the fantasy draft.
The remaining phases (draft to completion, coaching draft, free agency, deadline, playoffs, offseason, second season) were
**not driven through a browser**; they are covered at server level by the existing whole-season walkthroughs
(`full-circuit`, `humans-only-circuit`, `annual-circuit`, `league-dna-online`), which passed on PostgreSQL 16 (below). A
full browser season needs many minutes of UI automation and is the largest remaining gap.

Finding while writing the check: **draft picks carry no version token by design** (`actions.ts` comment: turn-based moves
are gated by whose turn it is and whether the player is still there). A stale pick is refused by the turn gate, not a
version. Trades, bids and standing signings are version-guarded (tested above).

## Concurrency, visibility, persistence (Tasks 2–4)

Run on **PostgreSQL 16.15** (a disposable local cluster, `wentz_test`), the engine CI uses, not PGlite: the full online suite
passed **641 tests, 4 skipped, 0 failed (80 files, 205 s)** including `concurrency`, `reliability-audit/-mp1/-mp2/-mp3/-pool`
(true concurrent connections; on PGlite these skip or fail for environmental reasons), `result-visibility`,
`vacate-*`, `commissioner-*`, `transaction-windows`, `fault-injection`, `version`. These already cover double clicks,
stale clients, seat revocation under a waiting request (D5), duplicate trade offers (D6), stale stage (D4/D7), the
per-league writer queue, and a database going away mid-request.

Visibility (read, not just run): `GET /leagues/:id` redacts games, standings, stats, injuries, broadcast and the archive by
the *requesting GM's* reveal markers (`visibleGames`, `redactedGames`, `rewindSeasonStats`); strangers and signed-out callers
are refused; `result-visibility.test.ts` asserts one GM's reveal does not change another's view and that archived games
cannot be pulled by naming a game, GM id or query parameter. Feed events (`season.week`, `season.advanced`, etc.) contain
no scores. Sealed free-agency bids and other GMs' draft targets are stripped per caller.

## Performance (Task 7) — local PG16, NFL-format league, 3 GMs

`online/dev/multiplayer-perf-probe.mjs`; numbers are one run on a shared sandbox, indicative only.

| Measure | Result |
|---|---|
| Full league payload | **1.59 MB** raw, **160 KB** gzip (`accept-encoding: identity` in the probe) |
| Unchanged poll (`?have=<version>`) | **46 bytes**, 4 ms; 60 concurrent polls p95 59 ms, one 1-row query each |
| 30 concurrent *full* reads | p50 655 ms, p95 975 ms (server parses the document each time) |
| Stored document | 1.79 MB text, **235 KB** stored (TOAST-compressed), **rewritten in full on every write** |
| Single write (pause / resume) | 74 / 69 ms |
| 20 simultaneous writes, 3 GMs, one league | 5×200, 12×409 (league had already moved on), 3×503 (the per-league queue cap of 16, by design) |
| Server RSS after the above | ~395 MB (idle ~150 MB) |

Neon-egress implications: reads are cheap when clients poll with `have`; **every write moves ~235 KB (compressed) of row
data**, so write count, not read count, is the cost driver. Not measured: multi-season memory growth and large-scale
soak (the `league-dna-longrun` test was excluded for time); RSS near 400 MB under a read storm is worth checking
against the hosting plan's memory limit.

## Task 6 — roster repair (master only)

`POST /leagues/:id/actions/staff-fix` is a **human-invoked** route on master: own team only, no player id, only at the two
free-agency summary stages, idempotent (`unchanged` when legal), authorised through the branded
`authorizeRosterRepair` capability. A GM cannot name the player: staff pick by policy. But it contradicts
`rosterRepair.ts`'s own header ("no HTTP route here and none may be added", "a human GM neither starts that") and #73's
design (automatic, entering preseason / regular season / mid-season depth chart). Indirect influence: a GM can choose
*when* to run it and which surplus players to release first, which shapes who the staff then signs. #73 owns that
behaviour; **re-run Task 6 after #73 merges**. #73 itself notes that #71's `decideCpuRepairSigning` is unused.

## Remaining multiplayer launch blockers / risks

1. **No browser-driven full season** (see limit above). Server-level season walkthroughs pass; screens past the draft start
   are untested in a real multi-browser run.
2. **Task 6 unverified** until #73 merges; `staff-fix` route contradicts the stated design.
3. **Whole-document rewrite per action** (~235 KB compressed): Neon egress/WAL and latency scale with action count. Needs a
   decision (e.g. patch-style writes or splitting hot parts out) — not attempted (architecture).
4. **Memory**: ~395 MB RSS under a 30× full-read storm; confirm against the production plan's limit.
5. **No UI indicator for a paused league** beyond the commissioner buttons and the 423 message; GMs see the server's
   message when they act. A banner is a small follow-up.
6. A **commissioner who is also the blocking GM** can only be replaced after `COMMISSIONER_AWAY_DAYS` of absence
   (existing rule); pause does not help if nobody can press it. Left as is.
7. Session cookie secrets: a server restarted without a fixed `SESSION_SECRET` logs everyone out (production requires it).
8. One unreproduced observation: during an early draft-race run a single request returned HTTP 401 once; it did not recur
   in 3 later runs (all consistent). Logged, not explained.

## Reproduce

```bash
# disposable PostgreSQL 16 (matches CI) — local only
/usr/lib/postgresql/16/bin/initdb -D /var/tmp/wentz-pg16/data -A trust
/usr/lib/postgresql/16/bin/pg_ctl -D /var/tmp/wentz-pg16/data -o '-p 5440 -k /tmp' -l /var/tmp/wentz-pg16/log start
createdb -h /tmp -p 5440 -U postgres wentz_test
DATABASE_URL=postgres://postgres@127.0.0.1:5440/wentz_test CI=true npx vitest run --root online --exclude "test/_*.test.ts"
```

```bash
# browser journey: server on a disposable DB, UI served from the same origin
cd ui-source && VITE_LEAGUE_API="" npx vite build --configLoader runner --outDir /tmp/ui-dist --emptyOutDir && cd ..
DATABASE_URL=postgres://postgres@127.0.0.1:5440/wentz_test PORT=8790 SERVE_UI=/tmp/ui-dist/index.html \
  CLIENT_ORIGIN=http://127.0.0.1:8790 npx tsx --tsconfig online/tsconfig.json online/src/index.ts &
BASE_URL=http://127.0.0.1:8790 CHROMIUM=/opt/pw-browsers/chromium JOURNEY_STATE=/tmp/j.json node online/dev/multiplayer-browser-journey.mjs
# stop and restart the server, then:
BASE_URL=http://127.0.0.1:8790 JOURNEY_STATE=/tmp/j.json node online/dev/multiplayer-restart-check.mjs
```

The journey above ran on PGlite (`npm run online:db` on `:5434`) in this session; the same scripts work on any
disposable database.

## Not verified

PR #73 interaction; browser run past the draft start; multi-season soak and memory growth; production hosting limits;
CI (no PR run yet).
