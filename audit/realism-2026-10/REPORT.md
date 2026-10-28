# Game-simulation realism audit (read-only)

Branch `claude/blissful-goodall-tnerpv` (cut from `master` @ `b292228`). No production code, data, schema, CI or UI was changed. Everything under `audit/realism-2026-10/` is reproduction tooling for the numbers below (see `README.md`); delete the directory if you do not want it kept.

All numbers are **local runs**, not CI. Real-NFL benchmarks are nflverse (games 2018–2025, weekly player stats 2023–25, injury reports 2023–25, play-by-play 2023–24), downloaded by `download_real.sh`. Where a figure is general football knowledge and not re-derived from that data it is marked *(recalled)*.

---

## 1. Simulation architecture summary

**The game is a real play-by-play simulation, not aggregate generation.** `simulateGame(seed, home, away, opts)` (`src/engine/sim.ts`, a pure function of its inputs) runs a clock, downs, field position, drives, penalties, kickoffs, punts, field goals, two-point tries, overtime and timeouts. Each play is sampled from models fitted to nflverse play-by-play (M01 fourth-down decision, M02 play call, M04 dropback outcome, M05 depth, M09 pass result, M10 YAC, M13/M14 run location and result, M15 fumble, M21 punt, M24 clock, M25 penalties), exported as portable JSON and evaluated in TS.

**Players enter in four layers on top of those team-level models**, none of which is a player-vs-player contest:

| Layer | File | What it does |
|---|---|---|
| Rating layer | `ratings.ts` | Unit *means* of attributes → logit/yard shifts per channel (completion, sack, INT, rush yards, YAC, FG, punt). Centred on league-average starters, clipped at ±3 z. |
| Team-strength index | `team-strength.ts` | Per-channel index from the units that play in that channel; closes the between-team spread the rating layer lacked (V1.8). |
| Synergy | `synergy.ts` | Superadditive units, weak links, QB × receiver, rush × protection. tanh-capped per channel. |
| Coaching, weather, home field, game plan, rotation | `staff*.ts`, `weather.ts`, `home-field.ts`, `gameplan.ts` | Small bounded deltas. |

`talentScale` (`LeagueConfig.talentImpact`: Realistic 1.0, **Amplified 1.5 = new-league default**, Extreme 2.0) multiplies every roster-driven shift; `CALIB_BY_TALENT` re-centres nine channel offsets per talent level so league averages stay flat.

**Which systems are play-level vs not**

| Item | Play-level? | Notes |
|---|---|---|
| Scores, drives, clock, down/distance, field position, OT, 2-pt, kneel/spike/2-minute | Yes | OT = NFL rules; playoffs `mustDecide`. |
| Pass/rush attempts, yards, TD, INT, sacks, fumbles, FG, punts, returns, penalties | Yes | |
| Individual player stats | **No — attribution after the fact.** | `attribution()` picks passer/target/rusher/tackler/sacker by a deterministic hash of game state and **slot-weighted tables** (`creditWeight` tilts defense credit by skill; receiving and rushing credit are **not** skill-weighted). Costs no RNG, decides nothing. `server/boxscore-map.ts` then sums the trace into player lines. |
| QB hits / pressure | **No** — a flat per-throw coin flip by depth (`QB_HIT_BY_DEPTH`), independent of lines. |
| Tackles, passes defended, forced fumbles | Attribution only (no assists, TFL, hurries, recoveries, def. TDs by player). |
| Injuries | Per-snap hazard `0.0085`, victim drawn from the on-field lineup (backups never hurt); the game then plays "next man up". Franchise layer (`ui-source/src/state/injuries.ts`) carries it across weeks; only injuries whose rounded midpoint is **> 2 weeks** keep a player out. |
| Lineup | 11 offensive slots, **10** defensive slots (2 EDGE, 2 DT, 2 ILB, 2 CB, 2 S; CB3 in nickel). No TE2, WR4, FB, 3rd LB/OLB, dime. Positions cannot be cross-slotted; `Roster.nth` clamps to the last man at a thin position. |
| Home field | `HOME_FIELD_SCALE 1.11`, withheld at neutral sites (Super Bowl). |
| Randomness | Single seeded RNG stream; draw order is load-bearing (see §10). |

Single-player (`server/simGame.ts`, `playoffs.ts decide`) and multiplayer (`online/src/blocks.ts`, `simulate.ts`) pass the same option set (trace, injuries, talent, offenseAdjust, NFL overtime, weather, staff, plans). I found no option discrepancy between them.

---

## 2. Methodology and sample sizes

| Run | Config | Size |
|---|---|---|
| Season harness (`run_seasons.ts`) | Real 2026 17-game schedule, 32 reference rosters (`pool-2026.json`), staff on, weather, injuries, NFL OT, trace — exactly `server/simGame.ts` | **32 seasons / 8,704 games at talent 1.0; 24 seasons / 6,528 games at talent 1.5** (+16 seasons staff-off) |
| Franchise-path playoffs (`replay_playoffs.ts`, via `withPlayoffRosters`) | 5 bracket replays per stored season | 160 brackets / 2,080 games (1.0); 120 / 1,560 (1.5) |
| League metrics (`analysis/39_league_metrics.ts`, existing) | All ordered team pairs | 2,976 games |
| Play traces (`trace_sample.ts`) | Franchise config | 800 games per talent level, compared with 544 real games |
| Determinism | same seed ×2, trace on/off, server adapter vs direct | 1,000 games each, **0 differences** |
| Stat reconciliation (`stat_reconciliation.ts`) | player lines vs team box | 600 games / 1,200 team-games |

Caveats that matter for reading the results:

- Rosters are the **32 fixed authored 2026 rosters**, replayed for many seasons. That measures the engine plus the league's *starting* talent distribution. It does **not** measure a league after the fantasy draft, CPU management and ten seasons of turnover — the CPU-economy agent owns that, and §3-B1 depends on it. I did not measure it.
- Sim players never miss games between weeks in this harness (the franchise layer does that), so per-season totals are compared with real ones **and** per game.
- Existing repo claims (`docs/decisions.md`: margin sd +4%, favourite 68.7%) reproduce on the all-pairs harness; the franchise-schedule harness reads a little wider (margin sd 14.9–15.1 vs 14.4–14.7). Staff-on adds about +0.3 to margin sd (staff-off 14.86, n=4,352; staff-on 15.14, n=8,704; ≈1.4σ).

---

## 3. League-wide statistics and distributions vs the real NFL

### 3a. Game level (real = nflverse REG 2018–2025, 2,127 games)

| Metric | Real | Sim 1.0 | Sim **1.5** (default) |
|---|---:|---:|---:|
| Points / team-game | 22.92 | 22.64 (−1.2%) | 23.04 (+0.5%) |
| Points sd | 10.00 | 9.78 | 10.95 |
| Total-points sd | 13.89 | **12.33 (−11%)** | 12.78 (−8%) |
| Margin sd | 14.31 | 15.14 (+6%) | **17.71 (+24%)** |
| Home win % | 54.0 | 53.5 | 53.7 |
| OT rate / tie rate | 5.5% / 0.38% | 4.8% / 0.25% | 4.1% / 0.34% |
| \|margin\| ≥ 14 / 21 / 28 | 34.6 / 16.5 / 6.8% | 37.3 / 18.5 / 7.1% | 44.8 / **26.2 / 13.0%** |
| Decided by ≤ 3 | 24.7% | 18.7% | 16.3% |
| One-score (≤ 8) | 53.3% | 46.1% | **38.9%** |
| Team ≥ 40 / ≥ 50 pts | 5.8 / 0.56% | 4.8 / 0.38% | 7.4 / 0.96% |
| Total ≥ 60 | 15.8% | 12.4% | 14.1% |
| Max team score / max margin | 70 / 50 | 80 / 66 | 66 / 66 |
| corr(home pts, away pts) | −0.03 | −0.20 | −0.32 |

Score values 1/4/5/8/11 behave (none impossible; 11 is rare in the sim, 0.07% vs 0.38%, a kicker/2-pt-mix signature).

### 3b. Team seasons

| Metric | Real | Sim 1.0 | Sim 1.5 |
|---|---:|---:|---:|
| Win-total sd | 3.15 | 3.65 | **4.15** |
| Point-diff/game sd (team-season) | 6.11 | 7.34 | **9.98** |
| Mean margin sd of the fixed rosters ("true strength") | ≈ 5.0 *(derived: √(6.11² − 3.5² luck))* | 6.8 | 9.7 |
| Teams ≥ 14 wins per season | 1.4 | 3.2 | **3.8** |
| Best / worst record (mean) | 13.8 / 2.5 | 15.7 / 1.7 | 16.4 / 1.0 |
| Perfect or winless seasons | ≈ 0.2% *(recalled: 2007 NE, 2008 DET, 2017 CLE)* | 0.7% (7 / 1,024) | **2.6% (20 / 768)** |
| Favourite wins (leave-one-season-out strength) | 66.4% (market) | 71.8% | 77.1% |
| Underdog ≥ 7 pts wins | 19.7% | 18.2% | 13.9% |
| Residual sd of margin vs prediction | 12.8 | 12.3 | 12.4 |

The residual sd matching real (12.3–12.4 vs 12.8) while the *predicted* spread is far wider (sd 10.1 / 14.4 vs the market's 6.2) says the **per-game noise is about right and the team-strength spread is too wide.**

Rating→result determinism: unit ratings explain **96–97% of team mean margin** (ridge, 32 teams) at both talent levels.

Static-roster titles (franchise-path playoffs): three teams (BAL, PHI, DET) win ~78% (1.0) / ~92% (1.5) of titles; the #1 seed wins 52% / 59% *(real #1 seeds win roughly a third *(recalled)*)*.

### 3c. Team box stats (real = 2023–25 team-games, n=1,632)

| | Real | Sim 1.0 | Note |
|---|---:|---:|---|
| Pass att (mean / sd) | 32.8 / 7.8 | 31.1 / **6.2** | −5% volume, sd −21% |
| Completion % | 64.7 | 66.8 | +3% (documented price of the scoring fit) |
| Yards/attempt | 7.15 | 7.51 | +5% |
| Pass yds sd | 71 | 65 | |
| Sacks / team-game | 2.46 | 2.30 | rate 6.7% vs 6.6% ✓ |
| INT / fumbles lost | 0.73 / 0.43 | 0.66 / 0.40 | |
| Turnovers P(0) / P(≥4) | 32.8% / 3.6% | 37.1% / 3.3% | **turnovers −8%** |
| 3rd-down conversion | 39% | 40.4% | |
| Penalties / yards | 6.16 / 50.0 | 5.98 / 52.0 | ✓ |
| FG attempts / team-game | 2.00 | **1.78 (−11%)** | 50+ yd attempts −13%, make% 66.5 vs 69.4 |
| Red-zone TD rate | 56.0% | 59.5% | +6% |
| Dropback rate | 61.5% (2023–24) | 58.4% | run-heavier on 1st-and-10 (45.7 vs 50.0 pass) and 3rd-and-1–3 (45 vs 53) |
| 4th-down go rate, inside the 5 | 49.5% | **64.6%** | 4th & 1–2 in opp. territory 73% vs 74% ✓ |
| Go attempts / team-game | 1.43 | 1.47 | ✓ |
| KR+PR TDs / season | 14 / 19 / 27 | 23 | ✓ |

Game-script behaviour (trailing in Q4 passes more, leading runs more) has the right shape; every bucket runs 3–6 points run-heavy.

### 3d. Playoffs (franchise path)

Home win by round (1.0/1.5 vs real): WC 60.5/61.9 vs 56.8; DIV 67.8/75.8 vs 71.9; CON 62.5/66.2 vs 62.5; margin sd 12–14 vs 11–14; totals within 1–5 points except the Super Bowl at 1.5 (52.0 vs 46.8, n=120). No playoff ties (OT until decided). **Playoffs are structurally fine; the concentration of champions is inherited from the regular-season spread.**

---

## 4. Position-specific findings

Real = top-N by volume per season, 2023–25. Sim = 32 seasons at talent 1.0 (talent 1.5 deltas in brackets).

**Quarterback** — averages good, spread wrong.

| | Real | Sim 1.0 [1.5] |
|---|---:|---:|
| Starter completion % (mean / **sd across QBs**) | 65.5 / 3.2 | 66.8 / **5.8** [67.5 / **7.9**] |
| Y/A, TD%, INT% | 7.24, 4.73, 2.05 | 7.40, 4.39, 2.13 |
| Max single-season INT / mean | 21 / 9.1 | **33 / 11.2** [37] |
| Games with ≥ 4 INT per season | 3.0 | **5.3** [7.1] |
| Games ≥ 4 / ≥ 5 pass TD per season | 28.7 / 5.3 | **17.2 / 2.7** [24.8 / 5.2] |

Rating→result slope: **+10 QB overall = +7.1 completion points, +0.95 Y/A, −1.3 INT%** (1.5: +10.0, +1.44, −1.67). A 93-rated QB completes 76–80% at 8.8–9.9 Y/A every year (above any real season); a 72-rated one completes 52–57% with 4–4.8% INT (22–25 INT per 17 games). QB quality is counted in the rating layer, the team-strength passing channel and synergy (QB × each receiver), all multiplied by `talentScale`.

**Running back** — good: YPC 4.49 vs 4.37, sd 0.59 = 0.59, 1,000-yd backs 17.9 vs 15 (sim backs never miss games). Gaps: RB1 rush TDs **9.1 mean / max 27–29 vs 7.0 / 18**; RB receptions 47.7 vs 37.3 (+28%); **30-carry games 0.6 vs 5.3 per season** (no workhorse spikes). Rating barely moves YPC (+0.09 per +10 overall, corr 0.23, by design — `RUNNER_OWN_SHARE`).

**WR / TE** — target *volume* is slot-driven, not rating-driven (WR1 7.2/g, WR2 6.8, WR3 5.3 regardless of overall); ratings move efficiency (+0.9 yds/target per +10). With no WR4/TE2/RB3, the top slots absorb their targets:

| | Real | Sim |
|---|---:|---:|
| TE top-32 targets / yards (mean) | 79 / 595 | **108 / 780 (+36% / +31%)** |
| WR top-64 yards mean | 852 | 983 (+15%) |
| WR 1,400+ yd seasons per year / best-WR yards | 4.0 / 1,767 | **0.7 / 1,413** (1.5: 2.1 / 1,499) |
| Games with 10+ / 12+ receptions per season | 52 / 16 | **28 / 4** |
| Games QB 400+ pass yds | 6.3 | 4.0 (1.5: 6.2) |

Star receivers cannot separate, and TE1 is over-used.

**Defensive front** — sacks per team-game 2.30 credited vs 2.44; leaders match (rank1 19.9 vs 19.8). Gaps: **DB share of sacks 14.6% vs 4.6%**; 10+ sack players 23.7 vs 19 per season, 15+ **5.0 vs 3.0**, single-season max 27 [31] vs 23. QB-hit rate per attempt is 9.1% for every team (**sd across teams 0.002; corr with OL rating −0.13** vs sack-rate corr −0.86): pressure is not produced by the line.

**Secondary** — INT leaders rank1 8.7 vs 8.3, but players with **6+ INT per season 7.7 vs 3.0**, max 13 [12] vs 9 (record 14 *(recalled)*); half of all INT go to cornerbacks (49.7% vs 38.7% real) and the top six single-season totals are all CBs rated 80–93. **Passes defended credited 3.0/team-game vs 4.3 real (−30%)** while leaders run high (23.4 vs 20.3).

**Kicker** — FG% 84.8 vs 85.8, sd 6.9 vs 7.2 ✓; attempts per game −11% (above). Rating slope +4.0 FG% per +10 overall.

**Unit value** (team mean margin, 32 rosters, ridge, pts/game per +1 sd of unit rating at 1.0 [1.5]): QB +2.9 [4.2], then ILB/DT/CB/EDGE/S/WR/RB/OL each +0.9–1.4 [1.4–1.8], TE +0.4, P +0.1. Consistent with `docs/decisions.md` (elite-swap table: DL +14.0 and DB +10.5 margin at 1.5 are the largest single levers).

**Injuries** (starters only, 8.7 per team-season, 0.51 per team-game, 18.2 projected games missed): volume of 3+-week injuries is plausible (2.5 starters per team-season vs 4.3 *any-roster* players with 3+ "Out" reports in real data). Gaps: **QB1 sits ~1.1 times per league-season (99% availability)** while real primary QBs start 83% of team games (2.8 games/team-season by another QB, includes benching); 62% of injuries are "minor" and never miss a game; reports cannot measure season-ending injuries (IR players leave the weekly report), so season-ending frequency is **unverified**.

---

## 5. Gameplay exploits and unrealistic outcomes

1. **Depth-chart order is a free stat-steering tool.** Targets are drawn by slot (WR1 36% of deep, WR3 18%; TE1 22% of short) and carries by `rbCommittee`; the outcome uses the group mean, so reordering WRs changes *who gets credit* at zero cost to wins. Matters wherever awards, records or contracts read player stats.
2. **QB-first roster building is over-rewarded at the extremes** (§4): the compounding of rating layer, strength channel and synergy at `talentScale ≥ 1.5` produces record-breaking elite seasons and unplayable bad ones.
3. **Large per-unit levers at Amplified/Extreme** (DL +14, DB +10.5, OL +9, QB +8 margin for an elite unit, `analysis/38`) mean the best fixed roster already averages +14.3 (1.0) / +20.5 (1.5) points per game (worst −12.2 / −18.7); I did not test whether a human can reach that deliberately from a drafted league.
4. **Game-plan dials are not an exploit** (all inside ±1 pt: fourth-short +0.48, high-ceiling AI plan +0.49, deep kickoffs +0.98 with an elite leg).
5. **Thin-depth clone-fill**: `Roster.nth` returns the last player when a position is short, so one elite CB fills CB1, CB2 and nickel CB3. Not reachable in normal play (positional minimums are enforced at reconciliation) — verify it stays unreachable at the deliberately-illegal windows.
6. **Soft incentives**: a ≤ 2-week injury has no availability cost (doubtful players play at full strength), so there is no incentive to carry depth for short injuries.

---

## 6. Confirmed defects, ranked by severity

Classes: **A** confirmed bug · **B** distribution problem · **C** unrealistic interaction · **D** balance preference.

| # | Sev | Cls | Finding | Evidence |
|---|---|---|---|---|
| 1 | **High** | B/C/D | Team-strength spread too wide, worst at the **default** Amplified 1.5: margin sd 17.7 (real 14.3), ≥ 21-pt games 26% (16.5%), one-score games 39% (53%), 3.8 teams ≥ 14 wins/season (1.4), 2.6% perfect/winless seasons (≈0.2%). Scoring *levels* are flat, which is why the existing checks pass. At 1.0 the spread is already +30–35% too wide (true-strength sd 6.8 vs ≈5.0) on the starting rosters. | §3a/b |
| 2 | **High** | B/C | QB rating→production slope too steep and compounded three ways; completion sd across starters 5.8–7.9 vs 3.2; INT max 33–37 vs 21; 4+-INT games +77–137%. | §4 |
| 3 | **Med** | B | Within-game variance too low: total-points sd −11% (even matchups: 12.8 vs 14.2 — computed from near-even games only, so it is not the strength spread); pass-attempt sd −21%; QB 4/5-TD games −40/−50%; 12+ reception games −75%; team ≥ 50 pts −33%. | §3a, §4 |
| 4 | **Med** | B | QB1 availability ~99% vs ≈ 83% real starts; short injuries never cost a game. | §4 |
| 5 | **Med** | A | **QB hit / pressure is not a function of the lines** (flat 9.1%, between-team sd 0.002); the box-score "QB hits" and any pressure comparison is noise. | §4 |
| 6 | **Med** | B | FG attempts −11%, 4th-down go-rate inside the 5 **+15 pts**, red-zone TD rate +6%, turnovers −8%: a small TD-for-FG substitution that nets to flat points. | §3c |
| 7 | **Med** | A | Team box `rushYards`, `rushAtt`, `plays`, `totalYards` **exclude QB scrambles** while player lines include them (+14.7 yd, +2.2 att per team-game; 97% of team-games mismatch). | `stat_reconciliation.ts` |
| 8 | Low-Med | B | Credit tables: TE1/WR over-targeted (no TE2/WR4/RB3), RB goal-line TDs +30%, DB sacks 3×, INT concentrated in a few CBs, PDs −30%; star-WR ceiling compressed. | §4 |
| 9 | Low | A | A completion that is fumbled away is counted at team level but dropped from passer/receiver lines (149 of 1,200 team-games). | `stat_reconciliation.ts` |
| 10 | Low | B | Pass rate −5% (era: fitted over 2018–25, 2023–24 is higher). | §3c |
| 11 | Low | D | 10-man defense; no dime; OL as a group mean. | §1 |

Verified **not** defects: determinism (1,000 games, 0 diffs), sack/INT reconciliation (0 mismatches), possession counts (|home−away drives| ≤ 1 in 93.8%), time of possession ≤ regulation + OT, no pts < 6·TD + 3·FG, penalties, sack rate, home field, playoff totals and margins, FG% and kicker spread, sack and rank-1 INT leaders.

---

## 7. Recommended changes, ranked by impact

1. **Decide the target competitive spread, then re-fit it.** Make "Realistic 1.0 ⇒ true-strength sd ≈ 5, ≤ 1.5 teams ≥ 14 wins, margin sd ≈ 14.3" the validated anchor; then pick what Amplified means (e.g. margin sd ≈ 16, ≥ 21-pt games ≈ 21%) rather than inheriting 17.7. Levers: `TEAM_STRENGTH_SCALE`, `CHANNEL_UNITS` `PER_POINT`, synergy caps, `talentScale` mapping. Needs an owner decision on the Amplified default.
2. **Compress the QB mapping.** A soft cap on the combined QB contribution (rating + channel + synergy) per channel, so a 72–96 range gives roughly 60–72% completion, 1.0–3.3% INT.
3. **Add a shared per-game "environment" variance** (pace/tempo and shootout correlation) so totals sd rises ≈ 11% without moving means; calibrate to even-matchup totals sd 14.2 and corr(home, away) ≈ 0.
4. **QB and starter availability**: raise QB1 injury weight/severity or add benching/rest, and let doubtful (≤ 2-week) injuries sit a share of the time.
5. **Make pressure real**: derive `qb_hit` probability from rush vs protection; keep the draw count unchanged.
6. **Credit/attribution pass (RNG-free)**: scramble yards into the team box; fumbled completions into player lines; add TE2/WR4/RB3 targets; skill-tilt receiving/rushing credit lightly; cut DB sack weights; raise PD crediting; spread INT credit; soften RB1 goal-line share.
7. **Special teams / 4th-down**: audit M01 near the goal line and the `hcGoForItDelta` effect; recover FG attempts.
8. **Pass-rate era refresh** to 2023–25 (M02 shift), only if (1)–(3) land first.

---

## 8. Phase 4 — regression and determinism assessment

| Need | Covered today? |
|---|---|
| Statistically impossible results | Partly: `engine-realism` league-rate bands (points ±10%, completion ±7%, INT ±30%, sack ±20%, YPC ±8%, margin sd 14.33 ±20% ⇒ 11.5–17.2). The sd band **would not fail on finding #1 at 1.0 (15.1) and barely catches 1.5 (17.7)**. |
| Invalid scores / possessions | Not as invariants. |
| Unrealistic extremes | Not tested at the player level. |
| Player-stat aggregation | **Not reconciled** (findings #7, #9 passed unnoticed); sack/INT already correct. |
| Seed-dependent anomalies | Only the §22 parity set; my 1,000-game check is clean. |
| Single- vs multi-player | `full-circuit`, `verify-replay`, `engine-cache-isolation` cover wiring; option parity is by inspection only. |
| Distribution changes | `passing-volume` (24 leagues, online) pins pass volume; nothing pins margin/variance/blowout shape, win-total spread or QB spread. Existing realism tests run **talent 1.0 only, staff off**; no test touches the 1.5 default. |

Targeted additions (each only where a gap exists; none require engine changes):

1. **Reconciliation test** (cheap, no sim cost beyond ~100 games): player-sum = team box for pass att/cmp/yds/TD, rush att/yds, sacks, INT, FG; this is `stat_reconciliation.ts` turned into assertions.
2. **Spread/shape guard at 1.0 and 1.5** over ≥ 600 real-schedule games: margin sd, |margin| ≥ 21 share, one-score share, total-points sd, corr(home, away), each with a ±6–8% band around the *chosen* targets (not the current output).
3. **Season-shape guard** (analysis script gated like `STATS_SEEDS`, not in CI): team-season pd/g sd, teams ≥ 14 wins, perfect/winless rate over ≥ 12 seasons.
4. **Player plausibility invariants** over ~300 traced games: QB INT% and completion% inside the real envelope, no single-season total beyond the NFL record book that `ui-source` already carries.
5. **Replay-compatibility test** (see §10): a stored game must regenerate to the same broadcast after any engine change that is meant to preserve old games.

---

## 9. Proposed implementation sequence

0. **Owner decisions**: Amplified default and the target spread; whether old saved games must replay identically.
1. Measure #1 on a *drafted* league (CPU-economy agent's harness) so the spread target is set on real league states, not the starting rosters.
2. RNG-free credit/box fixes (§7-6) + reconciliation test. Smallest risk, immediate stat quality.
3. QB compression (§7-2) and strength-spread re-fit (§7-1) together — they interact; refit `CALIB_BY_TALENT` and `analysis/40` after.
4. Environment variance (§7-3) then availability (§7-4) and pressure (§7-5), each behind its own measurement.
5. 4th-down/FG audit; pass-rate refresh.
6. After each: update `howItWorks.ts`, re-measure `passing-volume` baseline (seeds 101–124), regenerate §22/§23 where touched.

## 10. Expected file scope and conflict risks

| Area | Files | Conflict risk |
|---|---|---|
| Engine | `src/engine/{sim,team-strength,synergy,ratings,injury}.ts`, `CALIB_BY_TALENT` | Low with the other agents (none edit the engine). **High determinism risk**: any new RNG draw or reorder changes every seed. Gate all new behaviour on `ratingsOn` (validated pool-free path stays byte-identical, pinned by `engine-parity`/`engine-talent`). |
| Replays | `online/src/blocks.ts regenerateBroadcast`, `ui-source` | **Play-by-play is rebuilt from seed, not stored** — an engine change alters the broadcast of games already played in saved/online leagues. Needs an engine-version stamp on game records or an explicit decision to accept it. Medium risk with the multiplayer agent. |
| Box score | `server/boxscore-map.ts`, `src/engine/boxscore.ts`, `ui-source/src/domain/game.ts` | Low; touches types the UI reads (frontend agent). |
| Franchise injuries | `ui-source/src/state/injuries.ts` (`statusFor`, `availableRoster`) | Medium — shared with roster/economy code. |
| Talent default | `ui-source/src/state/talentImpact.ts`, `LeagueConfig` | Medium (new-league setup UI). |
| Text/tests | `ui-source/src/state/howItWorks.ts`, `test/engine-realism.test.ts`, `online/test/passing-volume.test.ts` | Low; must change in the same commit as any mechanic. |
| Untouched by design | CPU draft/FA/contract/trade logic, UI screens/motion, multiplayer infra, arcade, C2 cash | — |

Not verified: CI (nothing here was run on GitHub), online database suites, a drafted-league spread, and season-ending injury frequency.
