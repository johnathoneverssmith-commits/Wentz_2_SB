# Realism audit — focused follow-up (read-only)

Builds on `REPORT.md`. Nothing in the engine, UI, saved data, schema or services was changed. Scratch vitest files used to dump leagues and test replays were deleted after use (copies are kept as `*.test.ts.txt`). All figures are local runs, not CI.

## Headline

1. **The first audit's "too much separation" finding does not survive contact with a drafted league. It was a property of the fixed 2026 reference rosters, not of the engine.** A fantasy-drafted league is *too tight* at both settings: at Realistic 1.0 the margin sd is 12.9 (NFL 14.3), 21+ point games are 11.7% (16.5%), 14-win teams occur 0.4 times a season (1.4), and true team-strength sd is 2.5 (5.0). The draft leaves starter quality across teams almost flat (sd 0.41 overall points vs 1.86 for the real rosters), and no engine gain closes that without distorting everything else.
2. **The QB finding does survive.** Starting-QB completion % and interception % vary about 1.8× and 2.4× more than the NFL's (estimated true spread, sampling noise removed), at 1.0 in a drafted league as well as on fixed rosters. Three separate layers each add the QB's rating on top of one another.
3. **Reducing the QB effect does not fix competitive balance in a drafted league** (it makes the league tighter) but it does fix the blowout shape on the fixed rosters. So the two problems are separate, as you suspected.
4. **Replay fidelity is already fragile without any engine change.** Replays are rebuilt from the *current* league state; a one-line calibration nudge breaks 83% of replayed scores, and a trade breaks 4 of 6 affected games. A version stamp alone fixes none of that.

---

## 1. Fixed-roster vs fantasy-drafted-league comparison

**Method.** `createLeague(seed)` → fantasy draft by CPU GMs (`onStageEntered`) → `openStandingMarketFromUndrafted` → `fitDraftedPayrolls` → `fillRosterGaps`, i.e. the order `online/src/phases.ts` uses, **stopping before year-one free agency** (that period is the CPU-economy agent's and was not simulated). 16 leagues (seeds 1–16, standard CPUs) + 8 (Master CPUs), two 17-game seasons each, franchise configuration (trace, injuries, weather, staff, NFL overtime). Fixed-roster baseline uses the same 16 game-seed bases. 32 seasons / 8,704 games per cell (16 / 4,352 for Master). The drafted-league dump is deterministic (the same seed produced a byte-identical league on re-run).

| | NFL 2018–25 | Fixed 1.0 | Drafted 1.0 | Fixed 1.5 | Drafted 1.5 |
|---|---:|---:|---:|---:|---:|
| Margin sd | 14.31 | 15.51 | **12.87** | 17.48 | **13.01** |
| One-score (≤ 8) % | 53.3 | 44.8 | **52.6** | 40.2 | 53.5 |
| \|margin\| ≥ 21 % | 16.5 | 19.7 | **11.7** | 25.5 | 12.3 |
| \|margin\| ≥ 28 % | 6.8 | 8.2 | 3.5 | 12.0 | 3.9 |
| Teams ≥ 14 wins / season | 1.4 | 2.6 | **0.41** | 3.8 | 1.0 |
| Perfect / winless (of 1,024) | ≈ 0.2% *(recalled)* | 3 / 7 | 0 / 1 | 16 / 8 | 0 / 0 |
| Win-total sd | 3.15 | 3.53 | 2.47 | 4.13 | 2.81 |
| True team-strength sd¹ | 5.0 | 6.4 | **2.5** | 8.8 | 3.5 |
| Best / worst team pd per game | +11.7 / −11.5 | +16.9 / −17.3 | +8.8 / −10.7 | +21.4 / −21.5 | +9.8 / −11.8 |
| Best / worst record (mean) | 13.8 / 2.5 | 16.1 / 1.0 | 14.0 / 2.7 | 16.8 / 0.5 | 14.3 / 2.4 |

¹ √(pd/game sd² − (margin sd/√17)²): the spread that is not luck.

Master CPUs behave the same as standard ones (margin sd 12.8, true sd 2.4 at 1.0).

**Why.** Starting-lineup mean overall, sd across teams: **real rosters 1.86, drafted 0.41** (best-to-worst 1.7 points). QB1 sd is unchanged (6.7), so the draft balances other positions against the QB it happened to land. A drafted league's 12.9 margin sd is essentially the engine's within-game noise floor (even-matchup real games run 13.0; the sim's 12.4).

**Consequences**

- The Amplified default does *not* produce blowouts in a drafted league: 12.3% at 1.5 (NFL 16.5%). The numbers in `REPORT.md` §3 apply to a league that starts from real rosters, which is not how a new league starts.
- "Realistic 1.0 with NFL-like distributions" cannot be reached by an engine gain: extrapolating the 1.0 → 1.5 slope (true sd 2.5 → 3.5), 5.0 needs a scale near 2.3, and with the QB compression below the slope halves. That would also inflate every stat extreme.
- The missing separation has to come from roster dispersion over time (cap, contracts, development, the CPU spread of quality). That is the long-term franchise agent's question. **Not measured:** drafted leagues after free agency or after several seasons. **Dependency:** I need one or two of their multi-season runs (starter-quality sd by season, plus rosters or a seed I can replay) to finish this; I did not run multi-season leagues myself, to avoid duplicating them.

**Working target for a *mature* league** at Realistic 1.0 (all from nflverse 2018–25 unless noted): margin sd 14.3 ± 0.5; one-score 53 ± 2%; ≥ 21-pt 16.5 ± 2%; 1.4 ± 0.5 teams of 14+ wins per season; perfect or winless < 0.5% of team-seasons; true sd 5.0 ± 0.5; best/worst pd ≈ ±11–12. Starting-quality sd consistent with that, from the fixed pool, is about 1.4–1.9.

## 2. Realistic 1.0 vs Amplified 1.5

| | Fixed → Drafted at 1.0 | Fixed → Drafted at 1.5 |
|---|---|---|
| Margin sd | 15.5 → 12.9 | 17.5 → 13.0 |
| Teams ≥ 14 wins | 2.6 → 0.41 | 3.8 → 1.0 |
| True sd | 6.4 → 2.5 | 8.8 → 3.5 |

Going from 1.0 to 1.5 raises true sd by ×1.4 (drafted) / ×1.37 (fixed) and margin sd by only 1% in a drafted league, because per-game noise dominates when teams are close. Amplified is therefore the closer of the two to the NFL on a fresh drafted league (blowouts 12.3% vs 11.7%, 14-win teams 1.0 vs 0.4), but it carries the worse QB tails (§3). **The design you stated (Realistic default, Amplified optional) holds up. What changes is the validation target for Realistic: it has to be a mature league, and it will likely need roster dispersion, not a bigger gain, to get there.**

## 3. Quarterback sensitivity (isolated)

**Method** (`qb_sensitivity.ts`). Baseline Seattle (QB 80, roster otherwise untouched, backups removed so a weak QB stays the starter). The QB is replaced by copies with every attribute shifted by a fixed amount; overall moves with it. Each cell is 186 games (every other team, home and away, three seeds). Standard error ≈ 0.5 pt on completion %, 1.0 on margin.

| QB overall | 54 | 62 | 70 | 76 | **80** | 84 | 90 | 96 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Talent 1.0: cmp % | 55.7 | 57.1 | 59.4 | 63.9 | 68.6 | 71.9 | 76.3 | 77.6 |
| Y/A | 6.23 | 6.35 | 6.62 | 7.20 | 7.73 | 8.00 | 8.76 | 8.84 |
| INT % | 4.69 | 4.36 | 4.19 | 2.79 | 1.94 | 1.43 | 0.86 | 0.70 |
| Sack % | 9.2 | 9.0 | 8.4 | 7.4 | 6.9 | 6.5 | 6.0 | 5.6 |
| Margin / game | −4.8 | −3.9 | −3.0 | +2.0 | +5.9 | +7.5 | +8.9 | +10.5 |
| Talent 1.5: cmp % | 51.9 | 51.8 | 55.0 | 62.8 | 70.4 | 75.0 | 80.8 | 82.4 |
| INT % | 5.48 | 5.52 | 4.94 | 3.06 | 1.70 | 0.82 | 0.68 | 0.35 |
| Margin / game | −5.7 | −5.7 | −2.4 | +3.5 | +7.5 | +9.6 | +12.5 | +14.1 |

NFL starters, 2023–25 (n=81, 300+ attempts): cmp 58.1–72.9, INT 0.6–4.0%, Y/A 5.5–9.6.

**Where it comes from** (pre-limit logit shifts for +10 overall above the reference, mean over all 31 opposing defenses):

| Channel | Rating layer (`ratings.ts`) | Team-strength (`team-strength.ts`) | Synergy (`synergy.ts`) | Total |
|---|---:|---:|---:|---:|
| Completion | +0.183 (37%) | +0.180 (37%) | +0.129 (26%) | +0.492 |
| Interception | −0.434 (67%) | −0.216 (33%) | 0 | −0.650 |
| Sack | — | −0.079 | 0 | |

1. **Triple counting.** The QB is read by the rating layer (`qb_accuracy`, `qb_ball_security` families), by the team-strength index (QB is 40% of the completion index and 72% of the interception index, × `PER_POINT` 0.045 / −0.03), and by synergy (QB × each receiver). All three add. Per overall point: 0.049 logit on completion and 0.065 on interception.
2. **The cap bounds the sum, not the QB.** `SHIFT_LIMIT` (`complete` knee 0.35 / cap 0.55, `interception` 0.35 / 0.55) clamps the combined roster shift, so a good QB on a good team saturates it and the QB's own term stops mattering at 94–96, while a weak QB on a weak team sits on the cap in the other direction. Nothing limits the QB alone.
3. **`talentScale` multiplies after the cap.** The ceiling is 0.55 × talent, so 0.83 logit at 1.5: that is the 82% completion and 0.35% interception in the table.
4. **The interception offset was fitted for symmetry.** `CALIB_BY_TALENT.interception` is −0.21 / −0.37 / −0.54 at 1.0 / 1.5 / 2.0. It re-centres the league average, which pushes the weak-QB side of the channel up to 4.2–5.5%.
5. **Synergy is a minor contributor:** switching it off moves completion by about 1–2 points at the extremes and the margin by less than the noise.

Margin effect: about **0.36 points per game per overall point** at 1.0 (0.50 at 1.5), i.e. roughly 2.5 per QB standard deviation (6.8 overall) in the isolated test.

**Stat envelope in drafted leagues** (starters with 300+ attempts):

| | NFL | Drafted 1.0 | Drafted 1.0, QB ×0.5² | Drafted 1.5 | Drafted 1.5, QB ×0.5² |
|---|---:|---:|---:|---:|---:|
| Completion % sd (min–max) | 3.09 (58–73) | 4.80 (52–78) | **3.26** (56–75) | 6.46 (48–81) | 4.02 (55–78) |
| INT % sd (min–max) | 0.71 (0.6–4.0) | 1.07 (0.2–6.1) | **0.78** (0.0–5.5) | 1.30 (0–6.9) | 0.81 (0–5.2) |
| Y/A sd | 0.76 | 0.70 | 0.50 | 0.90 | 0.65 |
| Completion points per +10 overall | — | 5.5 | 2.5 | 7.6 | 3.5 |

² Prototype only: every starting QB's attributes and overall shrunk halfway toward the league starting-QB mean, applied to the roster files by the harness. **No engine file was touched.** Y/A becomes too tight, so a uniform 0.5 over-corrects that channel.

Sampling noise removed (≈ 550 attempts): NFL true spread is about 2.4 completion points and 0.36 INT points; the sim's is 4.4 and 0.88. Ratios 0.55 and 0.41.

### Does reducing the QB effect also improve competitive balance?

QB ×0.5 prototype, 24 seasons each (same game seeds):

| | NFL | Fixed 1.0 | Fixed 1.0, QB ×0.5 | Drafted 1.0 | Drafted 1.0, QB ×0.5 |
|---|---:|---:|---:|---:|---:|
| Margin sd | 14.31 | 15.58 | **14.55** | 12.93 | 12.53 |
| ≥ 21-pt % | 16.5 | 19.8 | **16.5** | 11.9 | 10.7 |
| One-score % | 53.3 | 44.7 | 47.8 | 52.6 | 53.9 |
| ≥ 14 wins / season | 1.4 | 2.62 | 2.62 | 0.42 | 0.46 |
| Perfect / winless | ≈ 0.2% | 2 / 6 | 1 / 1 | 0 / 0 | 0 / 0 |
| True sd | 5.0 | 6.5 | 5.6 | 2.5 | 1.4 |

- **On the real-roster pool**, halving the QB term takes margin sd and blowout share to the NFL's and removes most perfect/winless seasons, but does not fix 14-win teams (their cause is roster quality, not the QB) or one-score share.
- **In a drafted league it moves the wrong way** (true sd 2.5 → 1.4). So **do not use the QB change to solve the spread problem, and do not add a separate team-strength gain until mature-league data exist.**
- **A tension to resolve before choosing a number.** The prototype shows QB1 accounts for roughly a third of team-strength variance on the fixed pool (≈ 3.7 points per QB standard deviation, not the 2.5 above; the isolated test holds the rest of the roster fixed). The stat envelope wants a multiplier near 0.5–0.55 (completion) and 0.4–0.45 (interception); preserving a QB worth ~2.5 points per standard deviation wants ≈ 0.7. The reconciliation, which I have not tested, is to compress only what shows up in completion % and interception % and leave the QB's value in channels that do not (sacks, explosive passes, scrambles). That needs a per-channel experiment on the engine itself.

## 4. Proposed minimum-scope calibration changes

All behind `ratingsOn` (the pool-free validated path stays byte-identical, pinned by `engine-parity` and `engine-talent`).

1. **QB term multipliers.** One constant per channel (`QB_EFFECT.complete ≈ 0.55`, `.interception ≈ 0.45`, `.sack = 1`) applied to the QB's contribution in all three layers (rating-layer family term, strength-index QB weight, synergy QB pair terms) so the three stay consistent. Not applied to mobility/scramble. Files: `ratings.ts`, `team-strength.ts`, `synergy.ts`, small touch in `sim.ts`. Expected: starter completion sd ≈ 3.2–3.6, INT sd ≈ 0.7–0.9, range ≈ 56–75% / 0.3–5%.
2. **Refit `CALIB_BY_TALENT`** (`analysis/40_channel_calibration.ts`) so league means stay put: completion 66.8%, INT 2.2%, sack 6.6%, points 22.6.
3. **Optionally bound the QB's own term** inside the cap (keep it from saturating the channel), once (1) is measured.
4. **No change to `TEAM_STRENGTH_SCALE`, `PER_POINT`, the soft limits or the talent mapping yet.** Wait for the mature-league measurement.
5. **No default change** and no migration: `LeagueConfig.talentImpact` is stored per league, saves without it already play Realistic.

Items that need your decision, not mine: the QB value target (2.5 vs 3.7 points per standard deviation) and whether the CPU's QB valuation (`ui-source/src/state/unitValue.ts`, `analysis/38_unit_links.ts`) is re-derived after (1).

## 5. Replay-versioning options

**What a replay actually depends on today.** `regenerateBroadcast` re-simulates from the game seed using the *current* `state.players`, `depthChart`, staff, `config.talentImpact` and `offenseAdjust`, the stored `sidelined` list and the stored `plans`, plus the engine code and `artifacts/models` loaded at that moment. Games are cleared at each season rollover (`rollOverSeason`: `state.games = []`), so replay is within one season only.

**Measured fragility** (48 preseason games from a fresh league; replay = rebuilt final score vs saved score):

| Change after the block was played | Games whose replayed score no longer matches |
|---|---|
| none | 0 / 48 |
| Starting QB re-rated −8 (progression proxy) | 0 / 3 (scores happened to hold; the plays differ) |
| Starting QB traded to the other team | 4 / 6 affected games |
| Engine calibration nudged by 0.03 completion logit | **40 / 48** |

Anything that moves a roster after the checkpoint (trade deadline, waivers, FA signings, depth-chart edits) already breaks replay of earlier-block games, with no engine change at all. Storing `sidelined` fixes injuries only.

Sizes (60 games measured): broadcast 41.9 KB JSON / **4.1 KB gzipped**; raw trace 37.6 KB / 3.9 KB; ~131 plays per game. A season is 285 games plus playoffs ≈ **1.2 MB gzipped** for every game, ≈ 0.4 MB if only games a human plays. Engine code is 392 KB; portable models 3.9 MB (`artifacts/models` is 12 MB).

| Option | Reproduces old behavior? | Cost | Verdict |
|---|---|---|---|
| **A. Versioned logic** (keep each old engine + artifacts) | Only if the *inputs* are also reproduced; they are not (rosters mutate, are not snapshotted). Needs a roster snapshot (~100 players × 2 per game, similar in size to the event log) on top of ~4.3 MB per frozen version, every shared module (`Roster`, schema, weather, staff) frozen with it, and old versions kept until every league rolls its season. | Highest: build complexity, no bug-fixing old versions, bundle size, a version per deploy that touches the engine. | **Not recommended.** Still incomplete without the snapshot. |
| **B. Persist authoritative events** (store the broadcast/trace at block time) | Yes, exactly, regardless of later roster, engine or calibration change. | ~4 KB gz per game, ~1.2 MB per league-season, purged at rollover. Must not go in the league document (it travels whole on every request): a side table or blob keyed `(league, season, gameId)`. The trace already exists at block time (`trace: true`); the broadcast needs one extra `broadcastGame` call, or store the compact trace and render from it. | **Recommended core.** |
| **C. Hybrid** = B + a stamp/verify/fallback | Yes for stored games; and an honest answer for the rest. | B plus a few bytes per game. | **Recommended.** |

**Minimum feasible approach (C), in order:**
1. *Verify and fall back.* On replay, compare the rebuilt final score and drive count to the saved result; on mismatch return "play-by-play unavailable for this game" with the box score instead of a different game. Tiny, touches `regenerateBroadcast` only, and is the safety net for everything below. **Do this before any engine calibration change.**
2. *Stamp.* `engineRevision` (hash of `sim.ts` + calibration tables + artifact versions) on each game record, for diagnosis and for deciding which old games are suspect.
3. *Persist the events* of every game a person can watch (the `visibleGames` set) at block time, in the same transaction as the block's state save (idempotent by game id: `simulateBlock` already skips played ids). Replay reads the stored blob first and regenerates only if absent (e.g. leagues created before this).
4. Local single-player already keeps `GameResult.broadcast` for the viewer's game; extend the same field rather than a new mechanism.

Tradeoffs: storage grows by ~1.2 MB per active league and is bounded by rollover; online reconstruction becomes a read instead of a re-simulation; save compatibility is preserved (field is optional, old saves fall back to regeneration); the multiplayer reliability work cares about atomicity of block writes (their `blocks.ts`/`phases.ts`/`leagues.ts` changes), so the write must sit inside the existing block transaction and the schema addition needs your approval. Nothing here was implemented.

## 6. Retained findings (not touched; coordination required)

`REPORT.md` items stay open and unchanged: team box scores omit QB scramble yards and plays; QB1 availability ≈ 99% and short injuries never sit; QB hits independent of line strength (flat 9.1%); no TE2/WR4/RB3 and over-targeted TE1/WR; DBs credited with 3× the real share of sacks, INT concentrated in a few CBs, PD under-credited; total-points variance −11%; FG attempts −11% with 4th-down go-rate inside the 5 at 65% (NFL 50%); fumbled completions dropped from player lines; pass rate −5%.

**Coordination.** I cannot reach the play-by-play agent: I found no branch for them on `origin` (the active branches are the CPU-economy, UI, multiplayer-reliability and arcade lines; none touches `src/engine`, `server/` or `online/src/{blocks,simulate}.ts`). Anything in the list that changes `PlayRec`, `tracePlay`, `attribution`, `playerLinesFrom` or the box score should wait for their schema. **Please route that.**

Incidental, for the CPU agent: the sequence in `online/test/ai-master.test.ts` (draft → `openStandingMarketFromUndrafted` → `fillRosterGaps`) omits `fitDraftedPayrolls`. When I ran that same sequence the cap-cut in `fillRosterGaps` removed the stars (starter mean overall 73.7 → 62.0, best QB 96 → 63). I did not run that test, so I cannot say whether its Master-vs-Expert result is affected; it is worth a look.

## 7. Likely file conflicts

| Work | Files | Active-agent overlap |
|---|---|---|
| QB multipliers + recalibration | `src/engine/{ratings,team-strength,synergy,sim}.ts`, `CALIB_BY_TALENT`, `analysis/40_channel_calibration.ts`, `test/engine-{realism,talent,synergy,parity}.test.ts`, `test/team-strength.test.ts`, `ui-source/src/state/howItWorks.ts` | None on the engine today. **CPU-economy**: `unitValue.ts` / `analysis/38_unit_links.ts` / Master AI constants are derived from the current QB value. **UI**: `howItWorks.ts` text. |
| Replay verify/stamp/persist | `online/src/{blocks,index}.ts`, new table in `online/src/schema.sql` + migration (needs approval), `ui-source/src/domain/game.ts` | **Multiplayer reliability** (`mp1` branch edits `online/src/{leagues,phases}.ts` and adds reliability tests; `blocks.ts` untouched so far): medium. Sequence after their block-write changes land. |
| Event/trace/box-score fixes (retained items) | `src/engine/{sim,boxscore,broadcast}.ts`, `server/boxscore-map.ts`, `online/src/boxscore.ts` | **Play-by-play agent** (not visible). Hold. Event persistence (above) depends on their `PlayRec` shape. |
| Injury availability | `ui-source/src/state/injuries.ts`, `src/engine/injury.ts` | Roster/economy code reads availability. |
| Default flip to 1.0 | `ui-source/src/state/talentImpact.ts`, setup UI | UI agent. Last step, after validation. |

## 8. Prioritized implementation plan

| # | Step | Regression tests added | NFL benchmark gate |
|---|---|---|---|
| 0 | Decisions: QB value target; accept the mature-league validation approach; receive multi-season data from the long-term agent | — | Mature-league targets in §1 |
| 1 | Replay safety net: verify + fallback + `engineRevision` stamp | `replay-fidelity.test.ts` (rebuilt score = saved score; engine nudge ⇒ fallback, never a wrong game; trade ⇒ fallback) | 0 wrong-score replays |
| 2 | Persist events for watchable games, atomic with block save; backfill-free (old games fall back) | Round-trip test: stored blob = regenerated broadcast; purge at rollover; idempotent second block | Storage ≤ 1.5 MB gz / league-season |
| 3 | QB per-channel multipliers (spike on a branch first: per-channel, not uniform) + `CALIB_BY_TALENT` refit | `qb-envelope.test.ts` (≥ 300 traced starter-seasons: completion sd 2.8–3.8, INT sd 0.6–0.95, no starter above 4.5% INT or below 54% completion at 1.0); extend `engine-realism` league-mean bands; byte-identical pool-free check | Means: points 22.6 ± 0.4, completion unchanged from today's ~66.8 (NFL 64.7) ± 0.7, INT 2.2 ± 0.15, sack 6.6 ± 0.3; QB lever 2.2–3.0 pts/sd |
| 4 | Re-measure on mature drafted leagues at 1.0 and 1.5; decide gain/roster dispersion with the long-term agent | `spread-shape.test.ts` (≥ 600 real-schedule games on a committed or generated drafted league: margin sd 14.3 ± 0.8, ≥ 21-pt 16.5 ± 3, one-score 53 ± 3, total-points sd ≥ 13) | §1 targets |
| 5 | Flip default to Realistic 1.0 for *new* leagues only | New-league config test; existing-save test (field preserved, absent ⇒ Realistic) | — |
| 6 | Retained medium/low items, in the order of `REPORT.md` §7, after the play-by-play agent confirms the trace schema | Stat-reconciliation test (player sums = team box); credit-table envelope tests | Player envelopes in `REPORT.md` §4 |

**Stop point.** Awaiting your approval; nothing above has been implemented.
