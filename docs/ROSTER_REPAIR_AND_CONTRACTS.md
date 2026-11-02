# Draft assessment, contract structures and emergency roster repair

Agent 1 scope: UI-PT-09A, UI-PT-15, UI-PT-18. Numbers marked **(measured)** come from
`ui-source/src/state/_evidence` runs described under "Evidence" and are reproducible with the seeds named.

## 1. Fantasy draft assessment (UI-PT-09A)

### What the audit found

The draft summary grades a team by `ratings.overallRank` (`FantasyDraftSummary.tsx`), which came from
`recomputeTeamRatings` (`seed.ts`). That function:

1. **Ignored holes.** It averaged the starters a team *has*. A missing quarterback was left out of both the
   numerator and the denominator, so an empty starting spot never lowered a rating and could raise it.
2. **Had no weak-link term.** Unit grades, the hub and the Master evaluator all pull a unit toward its weakest
   starter (the engine's synergy layer does the same); the draft grade did not, so two screens answered "how good
   is this offense" differently.
3. **Rounded before ranking.** Overall, offense and defense were integers. After a fantasy draft all 32 teams
   fell on 3-5 distinct integers, so ranks inside a tie were decided by team-code order, and the letter grade
   (a function of rank) was partly alphabetical.
4. Used a different starter count/weighting table (`STARTER_WEIGHT`) from the one in `unitValue.ts` that the
   simulation-facing screens use.

It did use the same player `overall` as the downstream sim; the problem was how it was aggregated, not which
attribute.

### What changed

- `unitReport.ts` gains `projectedStrengths(state)`: one unrounded reading (units, weak links, replacement-level
  vacancies, measured unit weights, OLB excluded as in the engine). `recomputeTeamRatings` now writes
  `overall/offense/defense` from it (rounded to whole OVR, as before, so every screen and the e2e specs that read OVR are unchanged; the unrounded values are kept in `ratings.exact`) and **ranks on the unrounded value**. `sideRatings` (the hub) and
  the draft summary now agree by construction (`draftAssessment.test.ts`).
- Depth does not enter projected strength; it remains `rosterOverall`. An excellent starting group with no depth is
  graded on its starters.
- `draftValue.ts` (`draftValueByTeam`) is the separate *draft value* measure: pick *n* vs the *n*-th best overall
  taken in the draft. It is intentionally position-blind. A team can have the best value and the weaker
  lineup; the two are never blended (test: "can disagree with strength"). The summary UI is Agent 3's; this module
  is the data it can show.

Not changed: the CPU drafting AI (see below) and the engine. The mock sim reads `ratings.overall` differences for
win probability; the rating's scale shifts by about one point (weak links), a uniform shift that cancels in
differences. The full UI suite is the check on that.

### Is the "similar rosters" observation an evaluation or an AI problem?

Both, in different proportions. **(measured)** See Evidence. In short: the *evaluation* made it look worse than it is
(integer ties), and the *drafting* is genuinely compressed, but mostly because a snake draft of one shared pool
is a compressing mechanism — the AI adds a little on top via need-weighting. I did not retune the AI: that moves
simulation balance, which needs explicit approval (CLAUDE.md). Recommendation recorded under "Remaining".

## 2. Contract structures (UI-PT-15)

### Model

`ui-source/src/state/contractStructure.ts`, documented at the top of the file. In brief:

- Three structures: `even`, `backloaded`, `frontloaded`. **Same total for the same yearly salary** — shaping never
  creates money.
- Year weights run linearly from `1 − 0.25` to `1 + 0.25` (reverse for frontloaded). 15% of the total is a signing bonus,
  prorated evenly. Persisted per contract: `structure`, `salary_by_year`, `guaranteed_by_year`
  (the bonus proration in each year) alongside the existing `cap_hit_by_year`.
- **Anti-exploit.** Release cost for a shaped deal is `max(unamortized bonus, 22% × years left × average remaining hit)`.
  The average (not year one) is what makes a backloaded first year *not* a cheap exit. A shape must also fit the cap
  in every season of the deal (CPU choice and `extendContract`).
- **Where it applies.** Free-agency offers (`Offer.structure`, human and CPU), extensions (human and CPU re-signs),
  and `restructureContract` (keeps the split valid). The league wire accepts `structure` on the free-agency turn and the
  `extend` contract move. Rookie scale deals, tags, fifth-year options and camp bodies are unchanged (options drop the split).
- **CPU rule** (`chooseStructure`, deterministic): frontload a veteran (31+) or when next season is crowded and this one has
  room; backload a young player (≤29) when this year is tight and later years are clear; otherwise even; never a shape that
  would overrun the cap in a later season.
- **Compatibility.** All three fields are optional; `scheduleOf` returns null unless the split still adds up to the hits,
  and then everything reads the contract as the flat legacy deal. `releasePenalty` is byte-identical for legacy contracts
  (pinned by a test). `expireContracts` steps the split forward with the hits.
- **Player choice** between rival offers still compares average annual salary; structure does not change who wins a bid.

### Example (4 years, $20M a year, `ui-source/src/state/contractStructure.test.ts`)

See Evidence for the printed schedule and release cost by structure.

## 3. Emergency roster repair (UI-PT-18)

`ui-source/src/state/rosterRepair.ts`.

- **When:** entering `preseason`, `regularSeason` and `midseasonDepthChart`, for every team, human or CPU
  (single-player: `applyStageEntry`; online: `onStageEntered`). It never runs while a free-agency window or
  event is open, so scheduled simultaneous rounds are untouched; a player with a live offer is excluded.
- **What:** for each position below its minimum, the staff signs the best affordable player from the unsigned pool
  (score = overall + a small strategy age term; ties by id), highest-value positions first, **exactly the shortfall**.
  Teams act weakest-first (waiver order). No randomness.
- **Money:** one-year deal at half the player's market ask, never below the league minimum, through
  `offerToContract`. A player the team cannot afford is skipped for the best one it can; if none, the hole is reported
  (`unresolved`) and the game plays its placeholder as before. A full roster releases its cheapest surplus
  player (existing `nextReconcileCut`/`applyRelease`, which charge dead money) and says so.
- **Human cannot choose:** no exported function takes a player id (pinned by a test); the human team gets the same result as a CPU
  team in the same position. The GM is told afterwards: `state.rosterRepairs` (shown by `RosterRepairNotice` on the hub) and, online,
  a `roster.repair` note to that GM only.
- **Not an FA loophole:** price is half the ask (a star is not a bargain), only a below-minimum position is filled, only
  unsigned players, only at checkpoints, never in a market.
- Existing behavior kept: CPU reconciliation at FA summaries, the preseason roster fill, and the GM's "let my staff fix it" button.

## Integration notes for Agent 2 (transaction phases)

- One call site per environment: `runRepairCheckpoint(state, enteringStage)` — `ui-source/src/state/store.ts` (`applyStageEntry`)
  and `online/src/phases.ts` (`onStageEntered`). It decides itself whether `enteringStage` is a checkpoint and whether a market is
  open; it needs no phase table from you. If you add or rename stages, only `REPAIR_CHECKPOINTS` and `MARKET_STAGES` in
  `rosterRepair.ts` need to follow.
- It is not an endpoint and takes no player. If you add an authorization layer, there is nothing to authorize.
- Contract structure is a pure field on the offer/move (`structure?: "even"|"backloaded"|"frontloaded"`); phase checks do not need to know it.
  Cap checks for a shaped signing use year-one hit, which can be lower (backloaded) or higher (frontloaded) than the flat salary.
- I did not change FA phase ordering, trade windows or GM ownership checks.

## Evidence (measured; fantasy draft, 12 leagues: seeds 1-6, fictional and legacy pools)

Old rule (weighted mean of existing starters, rounded, ranked) vs the new projected strength:

| | old | new |
|---|---|---|
| distinct team overalls out of 32 | 4-5 | 19-25 (tenths) |
| adjacent rank pairs decided by a tie | 27-28 of 31 | ~0 |
| sd across teams | 0.74-1.07 | 0.83-1.15 |
| Spearman rank agreement old vs new | | 0.74-0.94 |
| teams that change letter-grade band (4-team bands) | | 16-25 of 32 |

Spread of projected strength, seed 1 (sd): AI draft 0.83 (fictional) / 1.15 (legacy); position-blind best-available snake
1.30; random redistribution of the same players 1.57 / 1.82. So the CPU draft is *tighter* than a plain snake draft, by
roughly a third in the fictional pool, which points at the AI's need-balancing on top of the snake format. The old
display exaggerated it (4 values for 32 teams). Retuning the AI is a balance change and is left for approval.

Contract example, 4 years at $20M a year (cap hits by year; release cost if cut before year one):

| structure | year 1 / 2 / 3 / 4 | total | bonus | dead money on release |
|---|---|---|---|---|
| even | 20 / 20 / 20 / 20 | 80 | 12 | 15 |
| backloaded | 15.8 / 18.6 / 21.4 / 24.2 | 80 | 12 | 15 |
| frontloaded | 24.3 / 21.4 / 18.6 / 15.7 | 80 | 12 | 15 |

Backloading saves $4.2M of year-one cap but cutting him costs the same as the flat deal, and year four costs $4.2M more.

## Integration with PR #71 (Agent 2): the repair authorization

PR #71 adds `decideCpuRepairSigning(state, { kind: "cpu-roster-repair", teamCode }, playerId, offer)` in `online/src/decide.ts`,
which **rejects any team with a human GM seated**, and removes voluntary instant signing (`decideSignFreeAgent` now refuses).
The agreed requirement is the opposite for repair: the *staff* repairs human franchises too; what is forbidden is a person
choosing or signing a player outside the rounds.

How the two fit, without merging either into the other (trial merge of #71 into this branch: no conflicts; engine, online and
UI typechecks pass except one unused variable in #71's own `transactionWindows.test.ts`, line 128; this branch's repair tests and
#71's `transaction-windows.test.ts` pass together, 30 tests):

- **Roster repair here does not call `decideCpuRepairSigning` or `decideSignFreeAgent`.** `rosterRepair.ts` is server-side
  state code run by the stage-entry hook; there is no request, route or player id for a person to supply. So #71's refusal of
  the voluntary endpoint does not affect it, and it keeps repairing human franchises.
- **What Agent 2 should do with `decideCpuRepairSigning`:** either leave it unused (nothing here needs it), or, if it is meant to be
  the one audited signing boundary, change its guard from "no human GM seated" to "the *caller* is staff code": add a
  `kind: "staff-roster-repair"` authorization that is constructed only by server code (as the existing one is) and is allowed for
  human and CPU teams alike. The guard that matters is *who chooses the player* (the staff rule in `rosterRepair.ts`), not *whose team it
  is*. Do not route any request-supplied player id through it.
- **What stays forbidden for people:** voluntary signings outside the rounds (#71), and choosing a repair player (here: no
  exported function takes a player id; pinned by `rosterRepair.test.ts`).
- **Phase boundary:** `repairBlockedBy` already refuses while a free-agency event or window is open or in a market stage, so a
  repair cannot interleave with simultaneous rounds. If #71 introduces new market stage names, add them to `MARKET_STAGES`.
- Both PRs edit `online/src/decide.ts`, `store.ts`, `WeeklyTeamHub.tsx`, `howItWorks.ts`; git merges them cleanly today.

## Verification run (this branch, head noted in the PR)

See the PR description for the exact head and results.
