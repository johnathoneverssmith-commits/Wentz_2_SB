# Realism audit, phase 4: correctness, calibration, mature leagues, replay record

Fourth document after `REPORT.md`, `FOLLOWUP.md` and `CALIBRATION_AND_REPLAY.md`. Local runs, not CI, except where a CI result is named.

## Deliverables

| | Item | Where | Head SHA | CI on that exact head |
|---|---|---|---|---|
| A | Halftime possession fix (#53) | PR #58, branch `fix/halftime-kickoff-53` | `d422bb72ce2ea1385e8d33c022d3f04d7ccfa19c` | `test` success, Chromium advisory success, `deploy` skipped (run 40787727949). The PR is now "behind" master (mergeable, not conflicting). |
| B | Scaled quarterback effect, experimental, off by default | draft PR #60, branch `calib/qb-effect-experimental`, stacked on #58 | `a9637f01a1585bf6aefb3dfdbc3d906660cb5cfd` | **None yet.** The workflow only runs for pull requests into `master`, and #60's base is the #58 branch. It will run when #60 is retargeted after #58 merges. Local results only. |
| C | Mature-league validation | this document | | |
| D | Replay record and renderer contract | this document, section D | | |

No Codex review was requested. Nothing was merged or deployed.

## A. Halftime possession (#53)

Cause confirmed and broader than the issue states: every post-resolution runoff (`advanceClock` in scrimmage, punt, field goal, interception and fumble returns) rolled the quarter before the play's result was applied. Fix: hold the roll until `play()` has resolved the snap (`holdRoll`, about 25 lines in `src/engine/sim.ts`). Pre-snap runoffs (`burn`) still roll at once; the end-of-half field-goal path and the touchdown/safety paths are unchanged.

Verification that the fix does what is claimed:
- **Kickoff team, possession, down, field position, clock.** `test/engine-half-kickoff.test.ts` builds the situation "this snap spends Q2" in seven situations (3rd down, two punts, a field goal, 1st down, goal line, interception) x 250 seeds x both openers x both offences and asserts the half receiver has the ball, 1st and 10, a kickoff spot (>= 45), the new half's clocks (900/1800/1800) and timeouts (3/3), and that the open drive is the kickoff's. 8 of 10 tests fail on master (344-960 of 586-964 constructed runs wrong), all pass on the branch.
- **Determinism.** Same seed and situation give the same state (test). Whole-game results are unchanged until the first half ends in a way that triggers the case.
- **PBP-1 event log.** 120 games: scoring events sum to the final score per side and the last `scoreAfter` equals the final score. `pbp-scoring-events` passes with two overtime pins re-recorded.
- **Expected scoring change, 2,906 paired games, same seeds:** first-half points per game 21.34 -> 21.35 (unchanged, the control); second half 23.94 -> 22.73; points per team-game 22.78 -> 22.18 (-2.6%); drives per team-game 10.66 -> 10.50; half-kickoff receiver win rate 51.4% -> 50.2%; first second-half snap 54 -> 71 yards from the end zone it attacks.
- **Out of scope, left as it is:** points are now 1-3% under the NFL's, and the second half still outscores the first (1.065x; NFL 2023-24 is 0.97x: 22.57 first half, 21.86 second, 544 games) while the first half runs 5% light. These belong to a calibration pass.
- **Other tests touched** (each with a comment): the pool-free fingerprint in `team-strength.test.ts`; two overtime pins in `pbp-scoring-events.test.ts`; the passing-volume baseline re-measured on its own seeds (it had drifted before this change: points 23.84/sd 12.56 recorded vs 21.82/sd 9.67 on master; the fix moves 21.82 -> 21.25); one return-fumble comparison in `engine-gameplan-levers` now counts return fumbles directly.
- **Suites, local:** engine 1051/1052, UI 759, online 541 passing. Failing identically on `master`: `verify-safety` (process tree, sandbox), `local-launcher`, and `reliability-pool` D2 (no database). The database suites were not run locally; CI covers them.
- `analysis/engine/sim.py` (the Python mirror) was not given the fix.

## B. Quarterback calibration

Implemented as an experimental, off-by-default setting (`setQbEffect`), with the refit, envelope and value scripts. The full table is in PR #60 and `docs/decisions.md`. Headlines for the approved 0.50 completion / 0.45 interception / 0.25 arm:

- **Spread (talent 1.0, starters with 300+ attempts):** completion sd 5.66 -> 3.95 on the fixed rosters and 4.46 -> 3.19 on mature rosters (NFL 3.09); interception sd 1.18 / 0.99 -> 0.74 (NFL 0.71); interception maximum per 560 attempts 28-29 -> 22.5-25 (NFL 21).
- **League means after the refit:** completion within 0.4 points, interception within 0.1, yards per attempt within 0.1, points within the noise.
- **QB margin value:** 3.14 -> 2.94 points per QB standard deviation at 1.0 (target about 2.5; arm 0 gives 2.25, 0.1 gives 2.79, +-0.3 noise), 4.83 -> 3.82 at 1.5. Competitive balance is unchanged.
- **Weak points:** the interception maximum at Amplified is still 24-27; yards-per-attempt spread falls to 0.56-0.72 (NFL 0.76).
- **Refit offsets** (`QB_REFIT`): talent 1 complete -0.051, interception +0.128; 1.5: -0.069 / +0.224; 2: -0.092 / +0.368.
- **Passing touchdowns:** mean per 560 attempts 23.8 -> 23.3 (fixed) and 18.9 -> 19.7 (mature) against an NFL mean of 21.0; spread unchanged by design.

## C. Mature-league validation, and a correction

**The earlier mature-league conclusion was wrong because of a harness defect.** `CALIBRATION_AND_REPLAY.md` §3 reported that, from season 4, CPU-only leagues polarised (margin sd 17.3 at season 5, 20.4 at season 10) and attributed it to the roster pipeline. The other agent's finding applies to my harness: with no human GM, `onStageEntered` closes the offseason market on the spot, the league lands on the summary stage inside that call, and the guarded block that signs the draft class (`state.stage === "freeAgency"`) never runs, so about 320 rookies a season were never created. My harness (`mature_league.test.ts.txt`, all GMs CPU) went through exactly that path. Its stage log shows `offseasonDraftSummary -> freeAgencySummary` with no `freeAgency` stage.

Re-run: the same harness on `master` (edd0f24) and on `fix/zero-human-rookie-signing` (a1c91aa), 4 leagues each, Realistic 1.0, 10 seasons, same league seeds. Supply (means over the 4 leagues):

| Season | Rookies on rosters | Players >= 80 | Starter mean | Starter-quality sd | League players |
|---|---|---|---|---|---|
| | master / fix | master / fix | master / fix | master / fix | master / fix |
| 2 | 14 / 195 | 346 / 380 | 78.9 / 79.6 | 1.51 / 1.30 | 1737 / 1774 |
| 3 | 54 / 247 | 344 / 415 | 78.0 / 79.9 | 1.94 / 1.25 | 1702 / 1731 |
| 5 | 62 / 298 | 323 / 436 | 74.3 / 79.8 | 4.31 / 1.48 | 1702 / 1772 |
| 10 | 78 / 281 | 138 / 428 | 65.9 / 79.6 | 6.76 / 1.28 | 1696 / 1779 |

Game outcomes, Realistic 1.0 (the league's own regular seasons, 1,088 games per season index):

| | NFL | master, seasons 1-10 | with the fix, seasons 1-10 | with the fix, season 10 |
|---|---:|---:|---:|---:|
| Margin sd | 14.3 | 17.7 (season 10: 20.1) | **13.8** | 13.8 |
| One-score % | 53.3 | 40.7 | 49.9 | 51.2 |
| >= 21 points % | 16.5 | 25.7 | **14.3** | 14.1 |
| 14+ win teams per season | 1.4 | 3.1 | **1.45** | 2.25 |
| Perfect / winless (of 1,280) | ~0.2% | 9 / 3 | 2 / 0 | 1 / 0 |
| True team-strength sd | 5.0 | 7.6 | 4.3 | 4.6 |
| Best / worst pd per game | +11.7 / -11.5 | +18.4 / -17.1 | +11.5 / -11.0 | +11.4 / -11.9 |

Amplified 1.5 with the fix (4 leagues, 10 seasons): margin sd 15.1, >= 21 points 18.1%, 14+ win teams 2.4, perfect/winless 6 / 2 of 1,280, true sd 5.9, best/worst +14.7 / -14.8.

**Conclusions.**
- The deterioration was the missing rookie signing, not the roster dynamics the audit blamed. With the fix, league talent is stable for ten years (starter mean 79.6-79.9, players >= 80 about 430, 280 rookies a season).
- With the fix, Realistic 1.0 is NFL-like across all ten seasons: margin sd 13.3-14.5, extreme-record counts and best/worst margin on the NFL's. It is slightly tight (true sd 4.3 against 5.0, one-score 50% against 53%, starter-quality sd 1.1-2.0 against 1.86 for the real rosters). Amplified is a little wide in true sd (5.9) and has a few perfect/winless seasons.
- **No team-strength or player-supply recalibration is indicated.** What is left is a small tightness at Realistic, the same size as the first drafted-league measurement (see `FOLLOWUP.md`), and it should be judged after the progression path has been validated, as instructed.
- **The fix is not on `master` yet** (branch `fix/zero-human-rookie-signing`). Until it is, any zero-human league (including this audit's harness, the franchise stress runs and any CPU-only benchmark) shows a talent collapse that is not real. `CALIBRATION_AND_REPLAY.md` §3 and its "reading" bullets should be read with this correction; the numbers there are correct for what they measured, the cause is not.
- **Still unverified:** other CPU transactions in a zero-human league beyond rookie signing. I compared stage sequences and supply counters, not every CPU decision. A fuller check needs a human-league run of the same length for comparison.
- Season-3/5 snapshot rosters re-simulated outside the league (the QB envelope runs) score 19-20 points a team-game, not the league's own 22-23: the league's `offenseAdjust` and coach staffs are missing from the re-simulation. Use them for off-versus-on comparisons only.

The harness (`mature_league.test.ts.txt`, now with per-season supply counters) and `mature_leagues.py` are the ones to reference; the franchise audit can run them on any branch.

## D. Replay record and renderer contract (design, nothing implemented)

Unchanged from `CALIBRATION_AND_REPLAY.md` §5 (`game_events` table, write inside `withLeague`, three display tiers, content-hash `engineRevision`), with this contract for the pure renderer so PBP-2 can build to it. I could not message PBP-2 (no reachable agent sessions and no PBP-2 branch on `origin` yet), so this is for relay.

```ts
// everything the renderer needs, nothing it must recompute
interface GameRecordV1 {
  schema: 1;
  engineRevision: string;
  game: { id: string; season: number; week: number; phase: string; home: string; away: string; seed: number;
          finalScore: [number, number]; neutralSite: boolean; overtimePeriods: number; weather?: string };
  plays: PlayRec[];        // verbatim engine trace, including scoreBefore and the attribution as shown
  events: GameEvent[];     // PBP-1's log, in the order the engine wrote it
  drives: DriveRecord[];
  injuries: InjuryEvent[]; // with playIndex
  players: Record<string, { id: string; position: string }>; // every name the trace uses -> id, as of the game
}
declare function renderBroadcast(r: GameRecordV1): GameBroadcast;   // pure: no engine import, no RNG, no clock
declare function validateRecord(r: GameRecordV1): string[];          // [] when sound
```

- **Score validation:** scoring events sum to `finalScore` per side; the last `scoreAfter` equals it; `scoreAfter` is non-decreasing; every `playIndex` and `beforePlayIndex` is in range; drive plays concatenate to `plays`; quarters never decrease; a non-overtime clock never increases within a quarter. `validateRecord` is the write-time gate and the read-time check.
- **Chronology:** the event array order is the engine's order. Events that share an index (a touchdown and its extra point, a penalty and the score on the same snap) are only ordered by that array, so storage must preserve it; PBP-2 should add an explicit `seq` so a consumer need not rely on it.
- **Player attribution:** the trace carries names, which are not unique across a league or stable across years. `players` maps each name appearing in the record to an id and position at the time of the game, so a later rename, trade or retirement cannot change who a historical play is credited to.
- **Stable presentation:** the renderer must accept every earlier `schema` value; new fields are optional and a bump is reserved for incompatible changes. A record is rendered, never re-simulated.
- **Open items for PBP-2:** expose the render half of `broadcastGame` (today it simulates), add `seq`, and confirm the narration they are building reads only the record.
- **Persistence stays on hold:** no table, no migration, no change to `withLeague` until MP-3 and the schema review are complete.

## Dependencies still open

1. #58 needs a decision to merge (CI green on its head; it is behind master).
2. #60 needs retargeting to `master` after #58 for CI, and a decision on the QB value target and the `arm` coefficient.
3. `fix/zero-human-rookie-signing` is unmerged; the franchise audit owns it.
4. Calibration after #58 (points 1-3% under the NFL, second half over first) is not started and no global team-strength change is authorised.
5. PBP-2 renderer contract and MP-3 schema review for section D.
