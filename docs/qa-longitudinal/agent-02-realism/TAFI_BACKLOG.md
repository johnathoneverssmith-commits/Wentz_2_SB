# Agent 02 — Simulation Realism TAFI backlog

**Baseline for every TAFI:** commit `3abcfff0f58d7117bbcd265f9cea9e7f1bcc829b` (master after PR #87, branch `claude/lucid-newton-ldy9aj`, no gameplay edits).
**Common configuration:** fictional-DNA league (default), `humanGmCount: 1`, difficulty `standard`, 32 teams, 17-game schedule, injuries/weather/staff on.
Accelerated runs: seeds **7001** (Amplified), **7002** (Amplified), **7003** (Realistic), 20 seasons each = 60 league-seasons, 16,320 regular-season games.
Forensic samples (traced engine games, random pairings): seeds 7001/7002 year-1 rosters (4,000 games each, Amplified and Realistic), plus "warm" samples after 8 simulated seasons (6,000 games, 7001 Amplified and 7003 Realistic).
Reproduce: `harness/README`-style steps in `README.md`. Benchmarks: nflverse 2021-24 regular season (`data/nfl_benchmarks*.json`).
Labels: **[C]** confirmed in engine output, **[H]** hypothetical cause. Severity: S1 (breaks rules/trust) – S4 (cosmetic).
Seasons marked "burn-in" (the first harness season) are excluded from steady-state numbers; see TAFI-REAL-009.

## A. Confirmed defects / rules deviations

### TAFI-REAL-001 — Safeties 1.2–2.7× the NFL rate  (S2, scoring / field position)
- **Expected:** 0.049 safeties/game (nflverse 2021-24, 1,087 games; 0.22% of drives).
- **Observed:** 0.133 and 0.113 per game (seeds 7001/7002, 4,000 games each, year-1 rosters), 0.121 (Realistic); after an 8-season warm-up 0.061 (Amplified) and 0.098 (Realistic, 6,000 games). 11.6% of year-1 games contain a safety vs ~4.8% real.
- **Mechanism evidence [C]:** drives that start inside the offense's own 5 end in a safety **10.9%** of the time vs **4.1%** in the NFL; own 5-10: 1.9% vs 1.2%; own 10-20: 0.45% vs 0.13%. Sim starts 4.0% of drives inside the 5 (NFL 2.8%). A safety is `newYl >= 100` on any scrimmage play (`src/engine/sim.ts:1974`).
- **Cause [H]:** play calling / sack / loss-of-yards model is not conservative enough in the shadow of the own end zone; plus slightly too many deep starts.
- **Repro:** `A02F=1 A02_GAMES=4000 A02_TALENT=amplified npx vitest run --root online test/_agent02_forensics.test.ts`; `analysis/analyze_forensics.py`.
- **Solution:** measure sack and negative-play rate by `yardline_100 >= 90` against nflverse; add a shadow-zone term to the loss tail (calibration only). **Benefit:** fewer cheap points; **tradeoff:** a re-fit of the drive baseline.
- **Acceptance:** safeties 0.04–0.06 per game over 6,000 warm games; P(safety | start inside own 5) 3–6%.
- **Complexity / priority:** M / P2.

### TAFI-REAL-002 — A defensive score in the first overtime possession does not end the game  (S2, overtime rules)
- **Expected:** a pick-six / fumble-return TD in OT is a walk-off.
- **Observed [C]:** `nflOvertime()` forces the second possession after a first-possession defensive score (`sim.ts` ~2085-2100) and then plays on. Traced examples (seed 7002 sample): BAL–IND final 17–31 (IND: pick-six + XP, then a **second** TD + XP in OT); SEA–TB 31–17 (14 OT points, both TDs by SEA, the second a pick-six); KC–MIN 3–13 (pick-six + XP + FG in OT). An XP is also kicked after a game-ending OT score in these cases while ordinary OT TDs end 26–20 with no XP. Roughly 2-4 of 160 OT games in each 4,000-game sample.
- **Also:** OT rate 5.0–5.5% of regular-season games vs 6.3% (nflverse 2021-24; 16,320 games, ≈3σ low); ties 0.18–0.20% vs 0.28%.
- **Solution:** end sudden death on a defensive TD/safety in possession 1; skip the XP after a walk-off. **Acceptance:** zero OT games with scoring after a walk-off; verify against the rulebook before changing. **Complexity / priority:** S / P3 (rare).

### TAFI-REAL-003 — Two-point conversions are never attempted with the default plan  (S2, scoring / decisions; feature gap with a confirmed cause)
- **Observed [C]:** 0 `two_point` events in 12,000 traced games. `twoPointProb` returns 0 when `plan.twoPoint === 0` (`src/engine/gameplan.ts:219`), the standard plan. NFL 2021-24: 0.49 attempts/game, 47.9% conversion; late-game and chart-driven attempts are a normal part of scoring.
- **Effect:** impossible scores like 8, 11, 14-point drives built from 2-pt conversions never occur; final-minute catch-up strategy is absent for the CPU.
- **Solution:** let the default CPU plan use the chart (`twoPointChart`) when trailing late; keep the dial for the human. **Acceptance:** 0.3-0.6 attempts/game, 40-55% conversion; margin distribution unchanged. **Complexity / priority:** S / P2.

### TAFI-REAL-004 — Kicker extra-point stats never recorded  (S3, statistics)
- **Observed [C]:** `xpa` summed over every kicker in 20 seasons × 3 runs = 0 while 2.0+ XPs per team-game are scored (`analysis/analyze_longrun.py`, `K.xpa_total`). Field goals are recorded and plausible (FG% 83.8–85.3 vs 84.5; 30.1–30.7 attempts vs 29.5).
- **Solution:** credit XP/2-pt to the kicker line. **Acceptance:** season XPA ≈ team TDs. **S / P4**.

### TAFI-REAL-005 — WITHDRAWN (harness artifact)
Earlier in the session "Pass this turn" at the trade deadline (and "Continue to Rookie Signings" at the rookie draft summary) appeared to do nothing in Playwright. The cause was the harness: the UI uses a confirm dialog and Playwright auto-cancels dialogs. The driver now accepts them. "Pass this turn" was not re-tested after the fix, so it is **not** a finding.

### TAFI-REAL-017 — Engine logs non-finite rating shifts and ignores them  (S3, engine robustness)
- **Observed [C]:** the engine adapter printed `engine: non-finite M04 shift on SACK; ignoring it` and `non-finite M09 shift on COMPLETE; ignoring it` (4 of each) during one solo season of real games (`/tmp` adapter log, UI run, seed unknown to the UI). A NaN reaching a sack or completion model is silently dropped, so affected plays use no rating effect.
- **Cause [H]:** a division by zero or an empty lineup slot in a rating-layer feature (likely a short or placeholder roster). **Solution:** find the NaN source (log team, play and feature), fix it, and assert on it in `test/engine-realism.test.ts`. **Acceptance:** zero such warnings over 1,000 franchise games. **S / P3.**

## B. Realism concerns (systematic, statistically supported)

### TAFI-REAL-006 — Touchdown mix: too few passing TDs, too many rushing TDs and RB workload  (S2, play calling / red zone / usage)
| Metric | Sim steady state (3 runs) | NFL |
|---|---|---|
| Pass TD / team-game | 1.10–1.16 | 1.45 (2021-24) |
| Rush TD / team-game | 1.19–1.26 | 0.91 |
| QB TD% (200+ att) | 3.7–3.8% | 4.5% |
| QB seasons with 40+ TD | 0 in 60 seasons (max 35–37) | 10 in 7 seasons |
| QB pass attempts / game | 29.4–29.9 | 32.5 |
| RB TD per RB (50+ carries) | 8.0–8.5 | 4.7 |
| Max RB rushing TDs | 30–33 | 16–18 per season |
| RBs with 10+ rush TD / season | 20–24 | 7.9 |
| RBs with 300+ carries / season | 5.8–6.0 | 2.3 |
| RBs with 1,000+ yds / season | 21–24 | 11.7 |
| RB ypc (50+ carries) | 4.83–4.98 | 4.39 (100+ carries) |
| Rush yards / team-game (player sums) | 136–141 | 117 |
Season-level: rushing yards drift from ~94-102 (season 1) to 125-132 (seasons 4-20) while passing yards fall 228 → 217-222 (slope −0.8 yds/season, A1). Total points stay near the NFL (22.0 vs 22.4), so the mix, not the level, is wrong. Plays per team-game 57.5 vs NFL's 63 (pass+rush attempts) — with yards per play 6.0 (NFL ~5.4) the sim compensates for fewer snaps.
- **Cause [H]:** the rush channel and goal-line tables (`rz_yac`, `rzRush`, `rushTail`, `CLOCK_SCALE` calibration per `docs/v16_points_gap_plan.md`) were fitted to hold points on real rosters; on a league whose starter ratings rise (TAFI-REAL-009) the run channel absorbs the scoring.
- **Solution:** re-fit the run/pass split on steady-state franchise leagues (`analysis/40_channel_calibration.ts` against `rush_td`, `pass_td`, RB carries); cap RB usage. **Acceptance:** pass TD 1.35–1.55, rush TD 0.8–1.0, 300-carry RBs ≤3/season, QB 40-TD seasons ≥0.5/season. **Tradeoff:** moves every offense number; re-run §22. **M / P1.**

### TAFI-REAL-007 — Quarterback rating barely changes passing efficiency  (S2, player ↔ outcome link)
- **Observed [C]** (qualified QBs, ≥200 att; n≈650/run): corr(overall, yards/attempt) = 0.02–0.10; corr(overall, TD%) = 0.04–0.07; elite (85+) vs <65 QBs: YPA 7.52 vs 7.46 (A1), 7.51 vs 7.30 (A2), 7.39 vs 7.38 (R1); TD% 3.86 vs 3.65. Only INT% separates (1.2–1.6% vs 3.4–3.6%; corr −0.59…−0.67) and completion% weakly (65.3 vs 63.6). NFL between-QB YPA sd 0.75, TD% sd 1.41 pts; sim 0.46–0.59 and 0.90–1.05.
- **Cause [H]:** QB value enters mostly through sacks/INT/team-strength (`analysis/44-46_qb_*`), not through yardage per throw; team-strength channel is shared.
- **Solution:** add QB-driven air-yard and TD-conversion terms (calibrated to nflverse EPA/att spread); **acceptance:** YPA sd 0.65–0.80, corr(ovr, YPA) ≥ 0.3. Coordinate with Agent 1 (game-feel) since it changes how QB trades feel. **M / P1.**

### TAFI-REAL-008 — Turnovers 25–30% below the NFL in the steady state  (S2)
- **Observed:** turnovers per team-game 0.90–0.97 (seasons 2-20) vs 1.29 (INT 0.77 + lost fumbles 0.52). Season 1 is 1.40–1.47, then falls to ~0.9 within three seasons (A1: 1.44, 1.00, 0.96, 0.90…). QB INT% 1.8–2.0% vs 2.25% (QB-level; the team gap is mostly fumbles: `ffum` 0.29/team-game vs 0.52 lost).
- **Cause [H]:** fumble hazard fitted on reference rosters does not scale with the higher-rated league; INT falls as QB ratings climb.
- **Solution:** re-fit fumble rate against steady-state ratings; **acceptance:** 1.15–1.40 turnovers/team-game for seasons 3-20. **S / P2.**

### TAFI-REAL-009 — League talent: start-up transient and slow structural drift  (S2, development / long run)
- **Start-up:** the first season of an unplayed start (harness; the real UI flow differs, see UI report) has starter means of ~61 (QB top-32) vs ~84 one offseason later; n(85+) 11 → 129 → 199 by year 5; league mean 61 → 68 → 72. Scoring 19.3/18.9/18.6 in season 1 vs 22 later; rushing yards 94 → 130.
- **Drift [C]:** 90+ players peak at 80-116 in seasons 3-6 then decay to 58 (A1) and 45-53 (R1) by season 20; 85+ falls 232 → 156 (A1) and 264 → 152 (R1); 75+ stays flat at ~690-700. Mean age 26.2 → 27.7, share ≥32 years 5-7% → 14-17%; ~25 players ≥36 each year (K/P/QB/OL). Starting-QB mean overall 83-85 (p10 74-76): about half of qualified QBs are "85+", so tier labels lose meaning.
- **Verdict:** equilibrium reached by year ~15 and no runaway; the elite tail halves relative to the early peak. Treat as design-calibration issue (rookie supply/ceilings vs aging), not a crash.
- **Solution:** set the DNA balance target to the equilibrium instead of the initial pool, or seed the pool at equilibrium; track n90 as a regression metric. **Acceptance:** n90 within ±20% of its year-10 value for years 5-20. **M / P2.**

### TAFI-REAL-010 — League parity: thin tails and weak persistence  (S3)
- **Observed:** wins sd 2.68/2.79 (Amplified), 2.31 (Realistic) vs 3.10; teams with ≤4 wins 2.4/1.45 per season vs 4.5; ≥13 wins 2.45/1.0 vs 3.25; year-to-year win correlation 0.21/0.22/0.16 vs 0.31 (nflverse 2021-24, 4 seasons — small sample); margin sd 13.3/13.3/12.7 vs 14.2; points sd 9.1/9.1/8.8 vs 9.9. Single extremes still occur (one 17–0 and two ≤1-win teams across 60 seasons).
- **Not problems:** no dynasty (13-17 distinct champions in 20 years; max 3 titles); bottom-8 teams average 7.8-8.0 wins next season (top-8: 8.8-9.2), so rebuilds recover quickly; 1-seed wins the title 55% (A1) / 20% (A2) / 30% (R1) of the time.
- **Solution:** the standing finding from `docs/engine_spec`: Realistic is under-dispersed by design (§23). If a more NFL-like spread is wanted, raise `TEAM_STRENGTH_SCALE` or default to Amplified for CPU-only leagues. **Acceptance:** wins sd 2.9–3.3 and ≤4-win teams 3.5–5.5/season. **S / P3.**

### TAFI-REAL-011 — Home-field advantage is essentially absent  (S3; known, `docs/decisions.md` OQ-10)
- **Observed:** home win% 0.511/0.513/0.501 (16,320 games, SE 0.004) vs 0.541 and +2.06 points (nflverse 2021-24). Forensics: 0.52-0.55 (4,000 games, SE 0.008).
- **Status:** documented design decision; flagged only because it is a visible gap. **Solution:** optional small additive HFA in the score model (≈ +1.5 pts). **S / P4.**

### TAFI-REAL-012 — Defensive statistic attribution: sacks and tackles leak to the wrong positions  (S3)
- CB 0.78–0.82 sacks per season (NFL 0.32), S 0.72–0.85 (DB mean 0.37), ILB 2.3–2.4 (NFL ILB 1.6). Defensive-line share of credited sacks 73% / LB 16% / DB 10.5%; NFL DL 58 / LB 34 (includes OLB) / DB 8, so edge and OLB credit is merged in the sim (OLB is not a lineup slot).
- Tackles: leader 211–244 vs 145–178; top-10 mean 173–175 vs 126–147; ILB mean 102–104 vs 86; credited tackles per team-game 44.7 vs 56.6 (so *concentration*, not total, is too high).
- 10+ sack players 22–24 per season vs 18; 15+ sacks 3 per season. EDGE sacks scale strongly with rating (elite 10.0 vs low-rated 5.6–6.8) — good.
- **Solution:** re-weight the credit draw by role and snaps; **acceptance:** CB/S sacks ≤0.45; top-10 tackles ≤165. **S / P3.**

### TAFI-REAL-013 — Defensive-back interceptions are non-monotonic in rating  (S3)
- DB (CB+S, ≥12 games) INT per season by overall tier: <65: 2.74–2.94 (n=103–116), 65-74: 1.31–1.46, 75-84: 1.49–1.75, 85+: 2.59–2.64. Low-rated starters out-intercept good ones across all three runs.
- **Cause [H]:** low-rated DBs who still start are asked to cover more targets; the credit draw is by target share, not by cover quality. **Solution:** check by position (CB vs S) and by snaps; pin a monotone test. **S / P3.**

### TAFI-REAL-014 — Receiving distribution: no true WR1 seasons, RBs under-targeted  (S3)
- Yards share WR 68.5% / TE 20.0% / RB 11.4% vs NFL 64.1 / 21.2 / 14.7. 1,500-yard WRs 0.05–0.45 per season vs 2.3; best WR 1,594–1,641 yds vs leaders 1,677–1,947 (2018-24); TE 1,000-yd 1.05–1.75 vs 2.3. 1,000-yd WRs 22.6–25.2 vs 21.6 (fine). Receptions leader 104–117 vs 125-149.
- **Solution:** concentrate targets toward the top WR (target-share variance); more RB checkdowns. **S / P4.**

## C. Verified OK (no TAFI)
- **Scoring decomposition:** in 12,000 traced games every final score equals the sum of its recorded scoring events (0 mismatches). No score of 1 or 4 occurs in 16k+ games; 2, 5, 8, 11 occur only from safeties / FG+safety, all traceable. Max team score 59–70 (NFL max in the window is far lower, but those tails are 1 in 10,000).
- League scoring **22.0 vs 22.4** points (−1.8%), FG% 84-85, XP rate 95.6-95.9% of TDs (NFL 94.9%), penalties 5.9 (5.9) and 50.4–51.1 yards (49.0), sacks allowed 2.21-2.26 (2.42), completion% 65.4-65.7, 4th-down behaviour (go rate 20-23% vs 19.8%; 4th-and-1 in FG range 84% vs 80%; own-territory long 6% vs 4.7%), pick-six 0.09-0.11 per team-game vs 0.07 (slightly high), punt-return TD 0.035 vs 0.016 (high x2, tiny), kick-return TD 0.011 vs 0.0005 (x20, tiny).
- Weather/venue: strings present on every game; no analysis of weather effect size performed (not enough isolated samples).
- Ageing curve shape is plausible: mean change +2.1 at 21 → +0.03 at 27 → −1.9 at 32 → −2.1 at 33; integrated peaks QB 29-30, RB 25, WR/TE 27, OL 28-29, DL 27-28, DB 27; RBs 30+ retire 55-57%/yr, QB 15-17%, K 6-7%; high-rated (80+) players retire at 4-5%/yr; rookies enter at mean age 23.4, ovr 61-62 (p90 78, max 95-99), ~340 per year; first-year +1.6, year-two +2.5, year-four +3.2 cumulative from entry; hidden potential correlates 0.94 with the 5-year peak (mean peak 3.6–3.7 below potential; 12% exceed it); late-round breakouts (entry ≤62 to ≥78 within 4 years) 0 and 1 of ~2,300 — essentially never (see TAFI-REAL-015).

### TAFI-REAL-015 — Almost no late-round breakouts; development is nearly deterministic  (S3, feature gap)
- 2,234–2,382 rookies entering at ≤62 overall: 0–1 reached ≥78 within four seasons. Year-to-year |Δ| ≥ 8 for players under 30 in 0.08–0.13% of player-years (sd 1.6–1.7). Potential predicts the peak at r = 0.94. Real football has genuine breakouts and busts.
- **Solution (optional feature):** a small heavy-tailed development shock per player-year. **Acceptance:** 1–3% of ≤62 rookies reach ≥78; under-30 |Δ|≥8 in 1–2% of player-years. **M / P3.**

## D. Injury findings (modeled system; no sourced benchmark loaded)
### TAFI-REAL-016 — Injury exposure by position is inverted for running backs and quarterbacks  (S3)
- 0.50–0.51 injury events per team-game (≈8.6 per team-season, 5,270 events in 19 seasons per run). Severity mix: minor 63%, moderate 29%, significant 7%, severe+season-ending 1%. Mean projected weeks: 1.4 / 3.6 / 7.4 / 17 / 18.
- Events per 100 player-seasons: ILB 31–33, DT 27–28, CB 27–28, S 27–29, EDGE 26–27, WR 25–26, TE 21–25, RB **19**, QB **12**. RBs with 100+ carries average 16.7 of 17 games; 6% of qualified QBs miss ≥4 games. Football intuition (and the injury literature, not loaded here) says RBs miss the most games. OL are 31% of events by share (OG 12-13%, OT 12%, C 6%) — high.
- Consistency check: of 30 players injured through week 9 with projected minimum ≥8 weeks, 15 played more games than a straight "out for minimum" would allow (`long_injury_gamesPlayed_check`); the check is crude (healing, byes) — **needs a direct audit of sidelined lists** (not captured by this run). No evidence of injured players playing was established; no evidence they do not.
- Season transitions: not verifiable from this dataset (injury state is not in the snapshots).
- **Solution:** position-specific contact exposure; **acceptance:** RB per-player rate ≥ WR rate. **S / P3.**
