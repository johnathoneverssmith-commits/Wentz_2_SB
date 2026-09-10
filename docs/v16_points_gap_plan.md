# V1.6 — the points gap: diagnosis and plan

Status: **points/team-game −11.8% → −2.0%, §22 16/20 within 10%.** Fixes, in
order of impact: `CLOCK_SCALE = 0.958` (M24 snap gaps ran ~1 s/play long →
drives/team-game −3.3% → +1.2%; the big one); the `rz_yac` table (RZ
completions caught short now score at the empirical goal-line-reach rate);
two punt bugs (field position); RZ `air_yards` split into gl1..gl4 (goal-line
throws track the end zone); `PICK_SIX_RATE`/`SCOOP_SIX_RATE` were ~5× too low.
Also fixed the §22 `plays_per_team_game` definition (scrimmage-only vs the
engine's all-plays; empirical 62.0 → 67.8). The 4 remaining §22 fails are all
expected: `points_sd` (rating layer OFF, no team spread) + the 3 deliberate
penalty-volume metrics. Deferred (each small): RZ pass-TD still ~10 pp short
at yl 5–20 (M05 depth mix); `end_of_half` 7.9 v 6.85% (2-min-drill clock mgmt added); `opp_touchdown` 0.77 v 1.11% (exotic
return TDs).
Tools: `analysis/29_drive_baseline.py` (empirical), `analysis/lib_py/drives.py`
(shared summariser), drive metrics in `analysis/23_full_sim_validation.py`,
opt-in `Game.play_trace` (Python engine only) for per-scrimmage-play probes.

The engine scores ~19.9 pts/team-game against an empirical 22.6 (−11.9%). Prior
work (`docs/decisions.md`, "Diffuse points gap") concluded the gap was emergent
from compounding 2–7% misses with no single lever, and that a fix would need
"drive-level EPA modelling". This pass tested that framing. Two findings change
it materially.

---

## 1. Within-drive persistence is NOT the mechanism (hypothesis refuted)

The most attractive explanation for "every per-play marginal is correct but
drives under-produce" is that the engine samples plays **independently** given
state, while real football has drive-level momentum. Independent draws with
correct marginals systematically under-produce the tail of *cumulative*
outcomes, which would explain low first-downs/drive, high plays/series, more
3-and-outs and fewer points — all at once.

Tested directly on 2023–25 pbp (98,194 plays, 16,942 drives): residual =
success − P(success | down, distance, field-position band), grouped by drive.

| drives with ≥ n plays | mean n | observed / independent variance | implied intra-drive ρ |
| --- | ---: | ---: | ---: |
| ≥3 | 6.13 | 1.216 | +0.042 |
| ≥4 | 7.44 | 0.946 | −0.008 |
| ≥5 | 7.99 | 0.931 | −0.010 |

Lag-1 residual correlation: **+0.031**. Mean residual after a successful play
+0.009 vs after a failure −0.024 (gap 0.033 on a 0.445 base).

The ≥3 row's apparent overdispersion is a length-selection artifact — drive
length is endogenous to success, so including 3-play drives (all-failure
3-and-outs) inflates the variance of drive means. The clean ≥4 / ≥5 rows say
**ρ ≈ 0**. Real plays are, to a very good approximation, conditionally
independent given state.

**Consequence: do not build a drive-level latent-efficiency / momentum layer.**
It would be modelling something that isn't there.

---

## 2. The diagnostic baseline itself is wrong (measurement bug)

`docs/decisions.md` records "**drives that never cross midfield are 37% v 18%**"
as the headline discrepancy. Measured directly from 2023–25 pbp:

> **never crossed midfield = 42.76%**

The engine's 37% is *better* than empirical, not 2× worse. The prior comparison
was between inconsistent definitions. Related: empirical plays/drive is **6.75**
(all plays) or **5.80** (run/pass only) depending on definition, and
plays/series is **2.632** — the prior note has empirical 5.69 and the engine
"grinding" at 6.27 plays/drive, which under the all-plays definition is *low*,
not high.

This is the fourth measurement-definition bug in this engine's history (3rd-down
conversion, RZ TD rate, the §23 hash seed, now this). **The prior "no single
lever, compounding 2–7% misses" conclusion rests on at least one badly wrong
number and should not be treated as settled.**

---

## 3. Where the points actually are

Empirical drive table, 2023–25 (18,387 drives, 10.75/team-game):

| outcome | share |
| --- | ---: |
| Punt | 35.20% |
| Touchdown | 22.15% |
| Field goal | 15.82% |
| Turnover | 10.03% |
| End of half | 6.85% |
| Turnover on downs | 5.87% |
| Missed field goal | 2.71% |
| Opp touchdown | 1.11% |
| Safety | 0.26% |

Offensive **points/drive = 1.94**; × 10.75 drives = 20.87 pts/team-game. The
remaining ~1.7 of the 22.56 empirical total is non-drive scoring (defensive and
return TDs, XP/2-pt accounting). So the offensive-drive gap is **smaller than
−11.9%** — a chunk of the headline gap lives in scoring the engine may already
model but that §22 attributes differently.

**Points/drive by starting field position** — the curve the engine must reproduce:

| start (own yds to goal) | share of drives | pts/drive | TD% |
| --- | ---: | ---: | ---: |
| 0–9 (opp 9 in) | 0.5% | **5.60** | 72.9% |
| 10–19 | 1.0% | 4.29 | 48.1% |
| 20–29 | 1.6% | 4.23 | 45.7% |
| 30–39 | 2.5% | 3.21 | 32.8% |
| 40–49 | 4.1% | 2.46 | 25.2% |
| 50–59 | 6.7% | 2.49 | 27.0% |
| 60–69 | 17.6% | 2.17 | 24.7% |
| 70–79 | 41.5% | 1.79 | 20.6% |
| 80–89 | 16.4% | 1.44 | 17.0% |
| 90–99 | 8.1% | 1.17 | 15.4% |

Start FP: mean 70.14, median 72, p10 **50**, p25 65, p75 79, p90 88.

**The 9.7% of drives that start in opponent territory (≤49) carry ~16.5% of all
offensive points.** A drive starting at the opponent 45 is worth 2.46 pts; one
starting at your own 25 is worth 1.79. Under-producing short fields costs points
fast *while every per-play metric stays correct* — which is precisely the
observed signature.

---

## 4. The hypothesis to test next

**The engine under-produces opponent-territory drive starts.** Nothing in §22
measures drive start field position, and `engine/sim.py` records no
`drive_start_yardline` stat at all — this has never been checked.

Specific suspects in `analysis/engine/sim.py`:

- **Fumble recoveries return 0 yards.** `_turnover(spot=...)` is called with no
  `return_yards` on a lost fumble, and the spot is the ball-carrier's position —
  no return at all.
- **INT returns average 6 yards** (`rng.normal(6, 8)`); check against the
  empirical INT-return distribution, which has a long tail.
- **Missed FG spot** — verify the defense takes over at the correct spot (the
  snap, not the line of scrimmage).
- **Punt net / return** — `sample_punt_return` and the touchback/downed mix.
- **Kickoff spot**: touchback → own 30 (`yardline_100 = 70.0`), return →
  `25 + N(3,6)` ≈ own 28. Sane, but confirm against 2023–25, which spans the
  2024 dynamic-kickoff rule change.
- **`End of half` is 6.85% of empirical drives** and the engine has no such
  outcome (noted in the prior diagnostic and still true).

---

## 5. Build plan (implementation — hand to Sonnet)

1. **Instrument the engine.** Add per-drive records to `engine/sim.py`:
   `drive_start_yardline`, `drive_result` (TD/FG/punt/downs/turnover/missed
   FG/end-of-half/safety), plays, and whether it crossed midfield. Mirror in
   `src/engine/sim.ts`.
2. **Promote `analysis/_v16_probe.py`** to a numbered script that emits the
   empirical drive baseline to `artifacts/validation/drive_baseline.json`
   (outcome mix, start-FP distribution, pts/drive by FP band, series stats).
3. **Add drive metrics to §22** (`23_full_sim_validation.py`) on *identical*
   definitions to the empirical side — this is where the prior bugs came from,
   so build one shared helper and have both sides call it.
4. **Compare the two curves.** Decisive split:
   - start-FP distribution shifted back, pts/drive-by-FP curve overlays →
     **field-position bug** (fix turnovers/returns/kickoffs; likely cheap).
   - start-FP matches, pts/drive-by-FP curve sits below at every band →
     **drive conversion** (then, and only then, consider drive-level modelling).
   - curves match near the goal line, diverge mid-field → look at 4th-down
     policy (M01) and FG-attempt range.
5. **Add the `End of half` drive outcome** (6.85% of drives) regardless — the
   engine forcing every drive to a real result is a known structural gap.

Do **not** start with a drive-level EPA model. §1 says the per-play independence
assumption is sound, and §3–4 say there is a cheaper, more likely explanation
that has never been measured.

---

## Step-4 results (2026-09-09) — the hypothesis was right; two mechanical bugs

Instrumented `engine/sim.py` with a per-drive log and compared to the empirical
baseline through `lib_py.drives.drive_table` (the one shared summariser). Two
straight bugs in the punt path in `_fourth_down`:

1. **Touchback:** `self._flip_field(1 - 20)` → `clip(-19, 1, 99)` = **1**, i.e.
   the receiving team started at the *opponent's* 1-yard line after every punt
   touchback. Fixed to `_flip_field(80.0)` (own 20).
2. **Return sign:** `self._flip_field(100 - landing + ret)` — a punt return
   *added* `ret` to the receiving team's `yardline_100`, moving them **backward**
   ~10 yд on every returned punt. Fixed to `100 - landing - ret`.

Effect (n=200, rating layer off), before → after:

| | before | after | empirical |
| --- | ---: | ---: | ---: |
| points / drive | 1.81 (−6.8%) | **1.86 (−4.2%)** | 1.942 |
| start_yl mean | 71.9 | **71.1** | 70.1 |
| start_yl p10 | 56 | **54** | 50 |
| drive start "opp 0–9" share | 2.5% | **0.4%** | 0.5% |
| drive start "own 90–99" share | 14.5% | **10.3%** | 8.2% |
| TD-drive share | 19.9% | **20.4%** | 22.2% |
| punt-drive share | 38.6% | **36.5%** | 35.2% |
| `never crossed midfield` | 44.4% | 43.8% | 42.8% |
| points / **team-game** | 19.6 (−13.1%) | **19.9 (−11.8%)** | 22.56 |

Field position is now close. `never crossed midfield` confirms §2 — the old
"37% v 18%" was a measurement bug, the engine matches. Bugs mirrored to
`src/engine/sim.ts`.

### What's left (the −11.8% team-game gap decomposes as)

- **≈ −4% drive conversion, and it is NOT uniform — it lives entirely in
  long-field drives.** Added `first_downs` to the per-drive record and split
  every metric by starting field-position band:

  | start band (own yds to goal) | share | FD/drive sim / emp | plays/drive sim / emp | pts/drive sim / emp |
  | --- | ---: | ---: | ---: | ---: |
  | ≤ opp 49 (bands 0–49) | 12% | ≥ emp | ≈ emp | ≈ emp |
  | own 40–49 (band 50–59) | 6% | 1.68 / 1.64 | 6.24 / 6.27 | 2.52 / 2.49 |
  | own 31–40 (band 60–69) | 18% | 1.79 / 1.83 | 6.71 / 6.78 | 2.07 / 2.17 |
  | **own 21–30 (band 70–79)** | **46%** | **1.70 / 1.89** | **6.58 / 7.00** | 1.79 / 1.79 |
  | **own 11–20 (band 80–89)** | **15%** | **1.70 / 1.90** | **6.75 / 7.17** | **1.27 / 1.44** |
  | **own 1–10 (band 90–99)** | **8%** | **1.66 / 1.93** | **6.57 / 7.21** | **1.04 / 1.17** |

  Drives that start past midfield convert fine. Drives that start at the own 30
  or deeper — **69% of all drives** — run ~5–9% fewer plays and convert
  **~10–14% fewer first downs**. Globally: FD/drive 1.69 v 1.79 (−5.6%),
  plays/drive 6.63 v 6.75, 3-and-out 26.5% v 25.7% (both fine). So the engine's
  *opening* set of downs from deep is fine (3-and-out rate matches) but the
  drives that DO get moving stall around midfield instead of pushing into
  scoring range — they get 1–2 first downs and punt, where real long-field
  drives get 2–3 and reach FG/TD range.

  §1 rules out momentum (ρ≈0).

  **Long-field-drive probe (2026-09-10) — the per-play football is all correct.**
  Added an opt-in per-scrimmage-play trace (`Game.play_trace`); compared to
  2023–25 pbp, restricted to drives starting ≥ own 30:

  | check | verdict |
  | --- | --- |
  | A. down/distance state mix over plays | **matches** (±0.6pp every cell) |
  | B. dropback rate by field-position band | **matches** (≤1.6pp; backed-up −3pp) |
  | C. designed-run yards by `gl`/`opp`/`own` bucket | **matches** (−0.13 to −0.20 yд) |
  | D. first-down conversion by (down, distance) | **matches** (±2.5pp; two `<<` are n≈150 / noise) |
  | E. turnover rate per play by field-position band | **matches** (±0.4pp) |

  So the deficit is **not** per-play. Sizing the drive-level gap directly:
  empirical long-field drives get **1.913 first downs/drive**, of which
  **rush+pass = 1.742 and PENALTY = 0.171**. The engine gets **1.70** ≈ the
  empirical rush+pass-only figure. **The entire FD/drive gap is the ~0.17
  penalty first downs per drive** the engine doesn't produce — it runs penalties
  at **−25% volume** (§22: −27% count, −23% yards) and, until now, didn't even
  count the ones it *did* throw (`auto_first_pen`, not `first_down`). Same for
  plays/drive: empirical `down≠null` rows/drive 7.07 vs run/pass 6.00 — the
  ~1.0 difference is penalty no-play rows + the terminal punt/FG, and the engine
  wasn't counting the penalty rows in `_dplays`.

  **Conclusion: the long-field "conversion deficit" is the penalty-volume gap.**
  Defensive fouls (~0.25/drive empirically) hand the offense a first down and an
  extra ~1 play → more scoring chances. `docs/decisions.md` records that scaling
  `PENALTY_HAZARD_SCALE` up previously pushed points −10%→−16%, but that was
  *before* the punt fixes (field position was broken) and before this decompo-
  sition. **Re-test `PENALTY_HAZARD_SCALE` now** — with field position correct,
  more defensive fouls should be net-positive on points, not net-negative.

  Fixed two stat-counting mismatches so the drive metrics read correctly:
  `auto_first_pen` now also increments `first_down`; a dead-ball foul now counts
  a play in `_dplays` (matches nflverse's no-play row).
- **≈ −3% fewer drives/team-game** (10.31 v 10.75) — the clock runs hot
  (plays/team-game +7%), so drives are longer and more get caught by the half
  (`end_of_half` 9.3% v 6.85%). Raising the drive-end clock multiplier was tried
  before and made points *worse*; needs the per-play elapsed model (M24), a
  separate item.
- **≈ 1pp too few `opp_touchdown` drives** (0.12% v 1.11%) — return-TD rate off
  turnovers is ~10× low; near points-neutral leaguewide but part of the 22.56.

### `PENALTY_HAZARD_SCALE` sweep (2026-09-10) — NOT the points lever

Swept the scale via `NFLSIM_PEN_SCALE`, n=160/point, field position fixed:

| scale | pen/tg | penyd/tg | pts/tg | Δ pts | ppd | long-field FD/drive |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1.00 | 4.58 | 40 | 19.76 | −12.4% | 1.846 | 1.79 |
| **1.30** | **6.17** | 53 | 19.66 | −12.9% | 1.866 | **1.86** |
| 1.60 | 8.01 | 69 | 19.68 | −12.8% | 1.819 | 1.83 |
| 2.00 | 9.90 | 86 | 19.26 | −14.7% | 1.76 | 1.81 |

Scale **1.30 hits the empirical penalty count exactly** (6.17 v 6.16) and the
defensive-penalty first downs **do** materialize — long-field FD/drive 1.79 →
1.86 (toward 1.91), ppd 1.846 → 1.866. **But points/team-game does not improve**
(−12.4% → −12.9%): the extra *offensive* fouls (false start, holding, OL/DL) that
come with the scale-up cancel the drive-extending defensive fouls. Above 1.3,
offensive fouls dominate and both points and penalty *yards* (target 50) run
away. So the earlier "scaling → −16% points" finding **still holds after the
punt fixes** — penalty volume is a fidelity metric, not a points lever. Left at
1.0; `NFLSIM_PEN_SCALE` stays as a dev override (defaults to 1.0).

### Where the residual points actually are (revised)

points/team-game −12.4% ≈ points/drive −5% × drives/team-game −3.4%.

**Red-zone probe (2026-09-10) — `_v16_rz.py`, `play_trace` + `td` field.** The
engine's TD-per-play is 25–35% low on *every* red-zone yardline band, while
yards-per-play is *higher*:

| yardline | sim TD/play | emp TD/play | Δ | sim yд/play | emp yд/play |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1–4 | 0.349 | 0.446 | −9.7pp | **1.12** | **0.84** |
| 5–9 | 0.142 | 0.220 | −7.8pp | 2.76 | 2.40 |
| 10–14 | 0.079 | 0.117 | −3.8pp | 3.83 | 3.54 |
| 15–20 | 0.052 | 0.076 | −2.4pp | 4.61 | 4.43 |

**Localised (2026-09-10, `_v16_rz2.py`, `play_trace.outcome`/`depth`):**

1. **M13 / M14 rushing at the goal line is correct.** Fed the M14 class model +
   exact-yard PMF real empirical goal-line contexts (no sim): P(rush TD) matches
   within 1–2pp at *every* band — yl 1–2 .536 v .525, yl 3–4 .273 v .298, yl
   5–10 .114 v .131. M13 run-location mix also matches. Rushing is not it.

2. **It's the red-zone PASSING game — completed passes don't reach the end
   zone.** TD rate *on a completed pass*, sim vs empirical:

   | yardline | sim | emp |
   | ---: | ---: | ---: |
   | 1–2 | 0.77 | 0.94 |
   | 3–4 | **0.56** | **0.86** |
   | 5–9 | **0.32** | **0.60** |
   | 10–14 | 0.22 | 0.30 |

   A real completed pass from the 3–4 scores 86% of the time; the engine's
   scores 56%. Cause is the air-yards handling: `ay = int(min(ay,
   yardline_100 + 3))` caps the top, and the depth mix inside the 10 comes out
   **DEEP 0.000 sim v 0.068 emp** (the cap makes a 20+ air-yard throw
   impossible), SHORT 0.85 v 0.77. The engine throws shorter, easier passes —
   **comp% inside the 10 is 0.575 sim v 0.485 emp** — but a 1–2 air-yard
   completion from the 3 gains 1–2 yд of YAC and stops short of the goal line,
   where a real goal-line throw goes *into the end zone* (air yards ≈
   yardline_100) and the completion IS the TD.

This is the **largest remaining points lever** (RZ pass TD −25 to −30pp on
completions). The fix targets red-zone air yards — make goal-line throws aim at
the end zone rather than a generic SHORT distribution, and stop the cap from
zeroing out DEEP. Touches `sample_air_yards` / the `air_yards` `opp_rz` table /
the cap in `sim.py`.

- **drives/team-game −3.4%** (`end_of_half` +2.4pp) — M24 per-play elapsed
  refit, separate item.
- return-TD rate off turnovers (~10× low, ~1pp of drives) — separate, small.

### RZ air-yards fix (2026-09-10, DONE — partial)

`06_pass_depth.write_exact_air_yards` now splits the RZ into `gl1` (≤2), `gl2`
(3–4), `gl3` (5–7), `gl4` (8–12), `rz` (13–20); `loaders.sample_air_yards`
(both engines) walks a widening fallback chain. Confirmed the old pooled
`opp_rz` bucket was wrong: empirical RZ air-yards spike at the exact yardline
(from the 3 you throw it ~3), while the engine's was a flat 0–9 SHORT draw.

**Effect (n=200–250):** `pass_comp TD/pl` yl 3–4 0.56 → 0.63; points/drive
−4.2% → ~−3.5%; `never_crossed_mid` now exact (42.9 v 42.8); drive outcome mix
all within ~1.7pp. **Tradeoff:** `explosive_pass_rate` +9.2% → +10.3%
(borderline — RZ throws into the end zone from the 15–20 legitimately count as
20-yд explosives; within n-noise of where it was). Kept.

**Not closed:** yl 5–20 `pass_comp TD/pl` still ~−20pp. The engine's RZ
completions still skew to low-air-yards / behind-LOS throws (they complete
easier) so `caughtEZ` at yl 5–9 is 0.25 v emp 0.49. Root is a diffuse
M05-depth / M09-completion-by-depth / M10-RZ-YAC interaction — a multi-resolver
RZ recalibration, deferred as its own effort (small marginal points return).

### M24 clock — DONE (2026-09-10)

The "+7% plays" that motivated this was a **§22 definition mismatch** (5th one):
`plays_per_team_game` compared the engine's all-plays counter to a
scrimmage-only empirical filter. On a like-for-like count the engine was
*low* (65.8 v 68.1 plays/team-game) — the M24 snap gaps run ~1 s/play long
(sec/play 27.4 v 26.4), so drives ate ~8 s more wall clock and ~0.5 fewer fit
per half → drives/team-game −3.3%.

Fix: `CLOCK_SCALE = 0.958` multiplies `sample_runoff` in `advance_clock` (both
engines). Swept 0.955–0.968; 0.955–0.958 lands plays *and* drives on empirical
and gives the best points. Kept 0.958.

**Result (n=250):** drives/team-game +1.2%, plays/team-game +2.4% (fixed
definition), points/drive −2.5%, points/team-game **−6.2%** (from −11.8%),
`rz_td_rate` −2.3%, `explosive_pass_rate` +5.3% (the RZ air-yards tradeoff
resolved once drives were right). §22: **16/20 within 10%**.

TS parity test: N 120 → 220 (int_rate is a rare-event metric, noisy at n=120);
`int_rate_per_att` given its own 0.18 band (sfc32 vs PCG64 diverges most there;
Python §22 keeps it within 10%).

### Next

1. **Return-TD rate off turnovers — DONE (2026-09-10).** `PICK_SIX_RATE` and
   `SCOOP_SIX_RATE` were ~5× too low (0.018/0.012 vs empirical 0.088/0.064).
   Fixed → `opp_touchdown` drive share 0.17% → 0.65% (emp 1.11%; the rest is
   fumble-return TDs on non-turnover plays + muffed-punt/blocked-kick TDs the
   engine doesn't model). **points/team-game −6.2% → −4.9%** (the +7s go to the
   defense). 16/20 §22 holds.
2. **End-of-half clock management — DONE (2026-09-10; needed for play-by-play
   mode).** Added a running-clock state (`Game.clock_stopped`: reset on any
   possession change, on an incompletion, and on an OOB play; running after an
   in-bounds gain). In a 2-minute drill (`_hurry_up`: trailing / tied / within
   one score, ≤ 2:00 of Q2 or Q4) the offense now spends a timeout after a
   fresh set of downs, spikes the ball once the timeouts are gone, and sends
   the kick unit on (`_end_half_fg` → `_kick_fg(end_of_half=True)`) when time
   will expire and it's in FG range (≤ opp 40). `_kick_fg` extracted from
   `_fourth_down` so both paths share it. Also dropped the OT phantom drive
   (a 0-play `end_of_half` record left by the kickoff after a walk-off score).
   Effect (n=250): `end_of_half` 8.8% → 7.9% (emp 6.85%); `field_goal` 15.3%
   → 16.6% (emp 15.8%); spikes 0.31/team-game (emp ~0.3); drives/team-game
   +1.9%; **points/team-game −2.6% → −2.0%.** §22 16/20.
3. **RZ passing recalibration — DONE (2026-09-10).** Added a `rz_yac` table:
   the empirical YAC PMF for a RZ completion caught *short* of the goal, keyed
   by catch position (`catch_yl` = yardline_100 − air_yards). M10 regresses
   goal-line YAC toward the league mean and misses the reach/dive — a
   completion at the opp 3 scored ~25% in the engine vs ~48% empirically. The
   engine now draws from `rz_yac` instead when `yardline_100 ≤ 20` and the ball
   is caught short. `pass_comp TD/pl`: yl 3–4 0.63 → **0.77** (emp 0.86), yl
   5–9 0.40 → **0.50** (emp 0.60), yl 15–20 0.11 → **0.15** (emp 0.18).
   **points/team-game −4.9% → −2.6%.** `11_yac.write_rz_yac` → `rz_yac.parquet`
   → JSON; `sample_rz_yac` in both engines. Residual (~10 pp short at yl 5–20)
   is the engine's RZ completions still skewing to lower air yards / behind-LOS
   — an M05 depth-mix effect, small now.
4. `opp_touchdown` still 0.65 v 1.11% — the gap is fumble-return TDs on
   non-turnover plays (strip-sack scoop-and-score) + blocked-kick / muffed-punt
   TDs, none of which the engine models. Small.
