# Audit brief: the last stretch of work (hand-off for a review and optimization pass)

Read this first, then `CLAUDE.md` (project guide) and the three newest sections of
`docs/decisions.md` ("Franchise quarterbacks and the game plan", "Game plan, second pass",
"GM identity, CPU GMs and the staff"). Everything below is on `master` locally; only
the first block is deployed.

## Starting point

| Ref | What | State |
|---|---|---|
| `f24a33b` | motion-design release | what the site served before this stretch |
| `1fa745a` ... `5243d40` | compare tab, real rosters, playoff parity, drought, franchise QB, game plan, game-plan second pass | on `origin/master`, **deployed** when CI passes (verify with `node scripts/verify-deployment.mjs`) |
| `0aaa36d`, `4ec4b43` (+ whatever is committed after the brief) | GM identity, CPU GMs, firing block, staff-sign, identity map | on `origin/tafi-backup` only. **Not on master, not deployed.** |

The standing rules the owner set: push to master only when told; commit to `tafi-backup`
about every ten changes; stage files explicitly and never commit scratch (`_*` files,
`online/dev/_*`, `tafi_*.tsv`); keep AI GMs' differing philosophies (do not "fix"
strategy-caused roster differences); test credentials only on localhost; report a
substantive-vs-polish verdict per cycle.

## What was built (in the order it landed)

1. **Franchise QBs are prohibitive to trade** (`MockSimulationService.franchiseQbPremium`,
   `evaluateTrade` refuses outright; `TradeProposal` shows the refusal). A 94 QB was
   priced at two firsts, two seconds and a third.
2. **Game plan** (`src/engine/gameplan.ts`, `GamePlanScreen`): per-team dials, every one a
   *delta from the validated engine*; the default plan is byte-identical to no plan
   (`test/engine-gameplan.test.ts`). Dials: pass rate, fourth down by zone / short / long,
   blitz, 11/12/13 personnel, RB committee, QB runs, two-point tries, kickoff, returns,
   rookie playing time. Effects are priced against roster quality (`personnelQuality`,
   `leanDelta`, `blitzEffect`, `qbRunEffect`, `kickoffEffect`, `returnEffect`).
3. **Decision guard** (`fourthSane`, `FIELD_GOAL_LIMIT`, `twoPointProb`, `nonsense()` and
   `test/engine-gameplan-levers.test.ts`): no plan can talk a team into fourth-and-15, a
   66-yard field goal, kicking down two with a minute left; the last two minutes belong to
   the clock. `nonsense()` is a *separate statement* of the rules so a bug in either shows.
4. **Strategy tuning**: `analysis/42_strategy_tournament.ts` (32 rosters x plan vs
   standard plan on identical seeds) and `analysis/43_lever_audit.ts`. Last numbers are in
   `docs/decisions.md`. Open: `trenches_first` and `high_floor` do not win on rosters built
   for them (about -0.2 on best-fit); the tournament measures mean margin, so it cannot see
   a "floor" (variance) effect. Noise on an overall figure is about +-0.3.
5. **GM identity** (`ui-source/src/state/aiGms.ts`): strategy belongs to a GM, not a team.
   `LeagueState.aiGms` = named CPU GMs (strategy, skill z, team or pool, history), always
   more GMs than CPU teams. Skill is a bell curve around the difficulty level
   (`effectiveLevel`, `difficultyProfileAt`). `runAiFirings` applies the hot-seat score to
   CPU GMs once a season (inside `ensureHotSeat`); a fired GM joins the pool, the team hires
   a different strategy from whoever has been out of work longest. People pick an identity at
   team select and may change it at the hot-seat screen once a year (`chooseGmStrategy`);
   it steers their auto-picks (`planAutopicks`) and staff; other people cannot see it and the
   online pull strips it (`online/src/index.ts`).
6. **Staff sign**: `chooseFaMove` (free agency; CPU turn = choose then apply) and
   `staffDeadlineMove` (trade deadline); UI shows the plan, acts on yes through the same
   action a person would send.
7. **Fantasy-draft summary** replaced its bars with `IdentityMap` (offense/defense scatter
   coloured by identity, teams ranked inside each identity; `state/draftIdentity.ts`).
8. Earlier in the stretch: hot seat for human GMs, motion system (Framer Motion), the
   passing-collapse fix (`softCap`), draft-off real rosters, playoff engine parity,
   "How they compare" sub-stats.

## How to verify

```bash
npx tsc -p tsconfig.json && npx tsc --noEmit -p online/tsconfig.json && (cd ui-source && npx tsc -b --noEmit)
npx vitest run                                   # root: engine, ~2.5 min
(cd ui-source && npx vitest run)                 # UI/state: ~1.5 min
(cd online && DATABASE_URL=postgres://postgres@localhost:5434/postgres DB_POOL_MAX=1 npx vitest run --exclude "test/_*")   # ~2 min, needs the local postgres on 5434
npx tsx analysis/42_strategy_tournament.ts --games 60   # ~12 min
npx tsx analysis/43_lever_audit.ts --games 40           # ~15 min
```

Last full results: root 412 pass; UI 518 pass; online 303 pass (the one failure, the
coaching-draft "best available" test, assumed an Expert CPU GM never errs; fixed by pinning
the GM's skill and identity). A 12-season dynasty under online rules (`online/test/_plan-dynasty.test.ts`,
scratch, uncommitted; `ENGAGED=1 NOPLAN=1 AUDIT_YEARS=10`) found no violation of the CPU-GM
invariants (one GM per CPU team, pool larger than the teams, replacement never the same
strategy) and 36/36 replays matching.

## Where to look hardest (suspected weak spots)

- **Engine/determinism**: `src/engine/sim.ts` now has plan branches in `kickoff`, `fourthDown`,
  `tryAfterTouchdown`, punt returns, M04 shift. Check every branch is gated so the *default
  plan consumes the same RNG draws as before* (the byte-identical test only covers a few
  seeds). `withRookiePlaytime` copies rosters per game: check cost and that online replays
  (`regenerateBroadcast`) apply it the same way.
- **Plan effect sizes**: constants in `gameplan.ts` were tuned by tournament, not derived.
  `fourthShort +100` is +0.48 points/game (a real edge: is it too large?); `rookies +100`
  costs -0.49 now for a development bonus (`rookieDevelopment`) that has only a unit test, no
  multi-season measurement; `high_ceiling`'s AI plan is +0.49 overall (close to a free lunch).
- **CPU GMs**: `syncAiGms` is called from many places (`createLeague`, store `pickTeam`,
  `applyStageEntry`, online `onStageEntered`, claim/vacate in `leagues.ts`, `takeNewJob`);
  look for a path that changes `controlledBy` without syncing. Check firing cadence over a
  long league (too many or too few firings per offseason; the pool being drained). Skill
  currently affects only the decision sites that call `difficultyFor`; confirm none still
  reads `config.difficulty` directly.
- **Behaviour changes to CPU play**: identity now tilts free agency and CPU deadline buyers;
  a CPU free-agency turn is `chooseFaMove` + apply. `test/ai-master` style benchmarks were not
  re-run: confirm Master still beats Expert-built rosters.
- **Online/privacy**: the pull redaction (other people's `Gm.strategy` and `gamePlans`);
  `/actions/strategy` stage check; hosted leagues created before CPU GMs existed are not
  migrated (owner decision: ignore old saves).
- **UI**: `GmLine`/`GmCard` read the store with selectors; check re-render cost on the
  bracket and matchup board; `IdentityMap` label overlap at 32 teams; the staff buttons use
  `confirm()` (same pattern as the roster fix); phone width was not checked for the new screens.
- **Test hygiene**: some tests are statistical (`engine-gameplan.test.ts` personnel test
  needed a 400-game sample); look for flakiness. The scratch harness and the tournament take
  minutes; nothing in CI runs them.

## Audit results

Done: see "Audit of the game-plan / GM-identity stretch" in `docs/decisions.md`
(the extension cap defect, staff re-sign and holdouts, position-weighted team
ratings, snake default, trenches-first retune, smaller fixes).

## Known gaps (not bugs, decisions pending)

- A human GM that only advances decays to a 0-17 team in a few seasons (cap, expiring deals);
  the staff-sign features were never measured against an engaged human until the harness
  gained re-signing (see the latest run noted in `decisions.md` if added).
- `trenches_first` / `high_floor` plan tuning (above).
- The strategy tournament and lever audit do not measure variance; the "floor" idea is untested.

## What to deliver

A prioritized list of defects and cheap optimizations, each with evidence (a failing test or a
measurement), fixes for the clear ones, and a note on anything you would change about the
design. Do not push to `master`; commit to `tafi-backup` and report.
